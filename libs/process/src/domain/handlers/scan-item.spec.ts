import { unwrap } from '@app/common';
import { TrackingMode } from '@app/catalog';
import { ProcessContext } from '../context.js';
import { ScanItemHandler } from './scan-item.js';
import { fakeHandlerDeps, unLote, unProducto } from '../../../test/doubles/fake-handler-deps.js';
import type { ResolvedCode } from './handler.js';

const h = new ScanItemHandler();
const ctx = ProcessContext.empty();

describe('SCAN_ITEM', () => {
  const tornillo = unProducto({ sku: 'TOR-M8' });
  const taladro = unProducto({ sku: 'TAL-BOSCH', trackingMode: TrackingMode.SERIAL });
  const unidad = unLote(taladro, { serial: 'BSH-001' });
  const deps = fakeHandlerDeps({
    productos: [tornillo, taladro],
    lotes: [unidad],
    codigos: new Map<string, ResolvedCode>([
      ['7501000000017', { product: tornillo }],
      ['BSH-001', { product: taladro, batch: unidad }],
    ]),
  });

  it('resuelve el código a un producto y lo deja en el borrador', async () => {
    const p = unwrap(await h.validate(unwrap(h.parse({ code: '7501000000017' })), ctx, deps, {}));
    expect(p.productId).toBe(tornillo.id);
    expect(p.batchId).toBeUndefined();
    expect(h.apply(p, ctx).draft.productId).toBe(tornillo.id);
  });

  // Es lo que hace interesante a /v1/codes/{value}/resolve: escanear una serie
  // devuelve el taladro **y** ese taladro.
  it('si el código era una serie que existe, aporta también el lote', async () => {
    const p = unwrap(await h.validate(unwrap(h.parse({ code: 'BSH-001' })), ctx, deps, {}));
    expect(p.productId).toBe(taladro.id);
    expect(p.batchId).toBe(unidad.id);
    expect(h.apply(p, ctx).draft.batchId).toBe(unidad.id);
  });

  it('recorta el código antes de buscarlo', async () => {
    expect(unwrap(h.parse({ code: '  BSH-001  ' })).code).toBe('BSH-001');
  });

  it('un payload sin código, o que no es un objeto, o null, es invalid-step-payload en /code', () => {
    for (const raw of [{}, { code: '' }, { code: 7 }, 'BSH-001', null]) {
      const r = h.parse(raw);
      expect(r.ok).toBe(false);
      expect(!r.ok && r.error.type).toBe('invalid-step-payload');
      expect(!r.ok && r.error.errors?.[0]?.pointer).toBe('/code');
    }
  });

  it('un código que no resuelve a nada es invalid-step-payload, no un 404', async () => {
    const r = await h.validate({ code: 'NADA' }, ctx, deps, {});
    expect(!r.ok && r.error.type).toBe('invalid-step-payload');
    expect(!r.ok && r.error.message).toContain('NADA');
  });

  it('un producto retirado del catálogo no se escanea', async () => {
    const retirado = unProducto({ sku: 'VIEJO' }).deactivate();
    const d = fakeHandlerDeps({ codigos: new Map([['VIEJO', { product: retirado }]]) });
    const r = await h.validate({ code: 'VIEJO' }, ctx, d, {});
    expect(!r.ok && r.error.message).toContain('retirado');
  });
});

describe('SCAN_ITEM · apply sin nada resuelto', () => {
  it('no inventa producto: si validate no resolvió, el borrador sigue vacío', () => {
    expect(h.apply({ code: 'X' }, ctx).draft).toEqual({});
  });
});
