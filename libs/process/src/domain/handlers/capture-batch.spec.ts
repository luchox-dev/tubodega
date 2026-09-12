import { unwrap } from '@app/common';
import { TrackingMode } from '@app/catalog';
import { ProcessContext } from '../context.js';
import { CaptureBatchHandler } from './capture-batch.js';
import { fakeHandlerDeps, unLote, unProducto } from '../../../test/doubles/fake-handler-deps.js';

const h = new CaptureBatchHandler();

const tornillo = unProducto({ sku: 'TOR-M8' });
const leche = unProducto({ sku: 'LECHE-1L', trackingMode: TrackingMode.LOT });
const taladro = unProducto({ sku: 'TAL-BOSCH', trackingMode: TrackingMode.SERIAL });
const loteViejo = unLote(leche, { lotCode: 'L-2026-08' });
const unidadVieja = unLote(taladro, { serial: 'BSH-000' });
const deps = fakeHandlerDeps({ productos: [tornillo, leche, taladro], lotes: [loteViejo, unidadVieja] });

const con = (p = tornillo) => ProcessContext.empty().withDraft({ productId: p.id });
const VENCE = new Date('2026-10-01T00:00:00.000Z');

/**
 * Las seis celdas de la tabla de [13 §5], más la séptima que la tabla deja
 * implícita: que el escaneo ya aportara el lote.
 */
describe('CAPTURE_BATCH · la tabla de seis celdas', () => {
  it('QUANTITY + omitido → correcto, y no aporta nada', async () => {
    const ctx = con();
    const r = await h.onOmit(ctx, deps, {});
    expect(r.ok).toBe(true);
    expect(unwrap(r).draft.batchId).toBeUndefined();
  });

  it('QUANTITY + con datos → batch-step-not-allowed', async () => {
    const r = await h.validate(unwrap(h.parse({ lotCode: 'L-1' })), con(), deps, {});
    expect(!r.ok && r.error.type).toBe('batch-step-not-allowed');
  });

  it('LOT + omitido → batch-step-required', async () => {
    const r = await h.onOmit(con(leche), deps, {});
    expect(!r.ok && r.error.type).toBe('batch-step-required');
    expect(!r.ok && r.error.message).toContain('lote');
  });

  it('LOT + lote que existe → el batchId de ese lote', async () => {
    const p = unwrap(await h.validate(unwrap(h.parse({ lotCode: 'L-2026-08' })), con(leche), deps, {}));
    expect(p.batchId).toBe(loteViejo.id);
    expect(p.newBatch).toBeUndefined();
    expect(h.apply(p, con(leche)).draft.batchId).toBe(loteViejo.id);
  });

  // El lote de leche que llegó hoy no está en el catálogo: sin este paso,
  // CONFIRM llegaría sin batchId y Movement.create fallaría I-8.
  it('LOT + lote que no existe → newBatch, con su vencimiento', async () => {
    const p = unwrap(await h.validate(unwrap(h.parse({ lotCode: 'L-2026-09', expiresAt: VENCE })), con(leche), deps, {}));
    expect(p.batchId).toBeUndefined();
    expect(p.newBatch).toEqual({ productId: leche.id, lotCode: 'L-2026-09', expiresAt: VENCE });
    expect(h.apply(p, con(leche)).draft.newBatch?.lotCode).toBe('L-2026-09');
  });

  it('LOT + con datos pero sin lotCode → invalid-step-payload en /lotCode', async () => {
    const r = await h.validate(unwrap(h.parse({ serial: 'X' })), con(leche), deps, {});
    expect(!r.ok && r.error.type).toBe('invalid-step-payload');
    expect(!r.ok && r.error.errors?.[0]?.pointer).toBe('/lotCode');
  });

  it('SERIAL + omitido → batch-step-required, y nombra la serie', async () => {
    const r = await h.onOmit(con(taladro), deps, {});
    expect(!r.ok && r.error.type).toBe('batch-step-required');
    expect(!r.ok && r.error.message).toContain('número de serie');
  });

  it('SERIAL + serie que existe → su batchId (I-9 se comprueba al confirmar)', async () => {
    const p = unwrap(await h.validate(unwrap(h.parse({ serial: 'BSH-000' })), con(taladro), deps, {}));
    expect(p.batchId).toBe(unidadVieja.id);
  });

  it('SERIAL + serie que no existe → newBatch', async () => {
    const p = unwrap(await h.validate(unwrap(h.parse({ serial: 'BSH-999' })), con(taladro), deps, {}));
    expect(p.newBatch).toEqual({ productId: taladro.id, serial: 'BSH-999' });
  });

  it('SERIAL + con datos pero sin serial → invalid-step-payload en /serial', async () => {
    const r = await h.validate(unwrap(h.parse({ lotCode: 'L-1' })), con(taladro), deps, {});
    expect(!r.ok && r.error.errors?.[0]?.pointer).toBe('/serial');
  });

  it('la séptima: si el escaneo ya aportó el lote, omitir es correcto', async () => {
    const ctx = con(taladro).withDraft({ batchId: unidadVieja.id });
    expect((await h.onOmit(ctx, deps, {})).ok).toBe(true);
  });
});

describe('CAPTURE_BATCH · el resto', () => {
  it('recorta lote y serie, y trata el vacío como ausente por los dos lados', () => {
    expect(unwrap(h.parse({ lotCode: '  L-1  ', serial: '   ' }))).toEqual({ lotCode: 'L-1' });
    expect(unwrap(h.parse({ lotCode: '   ', serial: '  BSH-1  ' }))).toEqual({ serial: 'BSH-1' });
  });

  it('acepta el vencimiento como ISO', () => {
    expect(unwrap(h.parse({ lotCode: 'L-1', expiresAt: VENCE.toISOString() })).expiresAt).toEqual(VENCE);
  });

  it('un vencimiento que no es fecha es invalid-step-payload en /expiresAt', () => {
    const r = h.parse({ lotCode: 'L-1', expiresAt: 'el martes' });
    expect(!r.ok && r.error.errors?.[0]?.pointer).toBe('/expiresAt');
  });

  it('un payload que no es objeto es invalid-step-payload', () => {
    for (const raw of ['L-1', 7, null]) {
      expect(h.parse(raw).ok).toBe(false);
    }
  });

  it('sin producto en el borrador no se puede decidir nada, ni al validar ni al omitir', async () => {
    const vacio = ProcessContext.empty();
    expect((await h.validate(unwrap(h.parse({ lotCode: 'L-1' })), vacio, deps, {})).ok).toBe(false);
    const r = await h.onOmit(vacio, deps, {});
    expect(!r.ok && r.error.type).toBe('incomplete-draft');
  });
});

describe('CAPTURE_BATCH · los bordes del parseo', () => {
  it('un vencimiento nulo es ausente, y uno que no es texto ni fecha es un error', () => {
    expect(unwrap(h.parse({ lotCode: 'L-1', expiresAt: null })).expiresAt).toBeUndefined();
    expect(h.parse({ lotCode: 'L-1', expiresAt: 7 }).ok).toBe(false);
  });

  it('un lotCode que no es texto es ausente, no un error de forma', () => {
    expect(unwrap(h.parse({ lotCode: 7, serial: 'BSH-1' }))).toEqual({ serial: 'BSH-1' });
  });

  it('un lote nuevo sin vencimiento no arrastra la clave', async () => {
    const p = unwrap(await h.validate(unwrap(h.parse({ lotCode: 'L-SIN-FECHA' })), con(leche), deps, {}));
    expect(p.newBatch).toEqual({ productId: leche.id, lotCode: 'L-SIN-FECHA' });
  });

  it('apply sin nada decidido no toca el borrador', () => {
    expect(h.apply({ lotCode: 'L-1' }, con(leche)).draft.batchId).toBeUndefined();
  });
});
