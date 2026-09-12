import { v7 } from 'uuid';
import { unwrap, type ProcessInstanceId, type TraceId, type UserId } from '@app/common';
import { Batch, TrackingMode, type BatchId, type StorageKey } from '@app/catalog';
import { Movement, NodeKind, type MovementId } from '@app/inventory';
import { ORG } from '../../test/builders/a-template.js';
import { fakeHandlerDeps, unLote, unNodo, unProducto } from '../../test/doubles/fake-handler-deps.js';
import { FACTORY_TEMPLATES } from './factory-templates.js';
import { mvpRegistry } from './handlers/index.js';
import { LinearRunner } from './linear-runner.js';
import { ProcessState } from './instance.js';
import { ProcessTemplate } from './template.js';
import type { MovementDraft } from './drafts.js';
import type { ProcessTemplateId } from './ids.js';
import type { ResolvedCode } from './handlers/handler.js';

const ACTOR = '018f0000-0000-7000-8000-0000000000aa' as UserId;
const TRACE = '018f0000-0000-7000-8000-0000000000bb' as TraceId;
const OCURRIO = new Date('2026-09-12T11:00:00.000Z');
const VENCE = new Date('2026-12-01T00:00:00.000Z');
const DEVOLVER = new Date('2026-09-19T12:00:00.000Z');

// ── El mundo de papel ────────────────────────────────────────────────────────
// El reparto narrativo, más los ocho de frontera por `code`: adjustment-in y
// adjustment-out hacen falta de verdad, porque los `defaults` de las dos
// plantillas de ajuste los resuelven por código y no por id.

const tornillo = unProducto({ sku: 'TOR-M8', trackingMode: TrackingMode.QUANTITY, uom: 'UNIT' });
const arroz = unProducto({ sku: 'ARROZ-25', trackingMode: TrackingMode.QUANTITY, uom: 'KG' });
const leche = unProducto({ sku: 'LECHE-1L', trackingMode: TrackingMode.LOT, uom: 'L' });
const taladro = unProducto({ sku: 'TAL-BOSCH', trackingMode: TrackingMode.SERIAL, uom: 'UNIT' });

const unidadVieja = unLote(taladro, { serial: 'BSH-000' });
const loteViejo = unLote(leche, { lotCode: 'L-2026-08', expiresAt: VENCE });

const B2 = unNodo('B2');
const B3 = unNodo('B3');
const JUAN = unNodo('juan', NodeKind.CUSTODY);
const FRONTERA = [
  unNodo('supplier-default', NodeKind.SOURCE),
  unNodo('adjustment-in', NodeKind.SOURCE),
  unNodo('opening-balance', NodeKind.SOURCE),
  unNodo('sale', NodeKind.TERMINAL),
  unNodo('consumption', NodeKind.TERMINAL),
  unNodo('shrinkage', NodeKind.TERMINAL),
  unNodo('adjustment-out', NodeKind.TERMINAL),
  unNodo('supplier-return', NodeKind.TERMINAL),
];
const NODOS = [B2, B3, JUAN, ...FRONTERA];
const porCodigo = (code: string) => NODOS.find((n) => n.code === code)!;

const CODIGOS = new Map<string, ResolvedCode>([
  ['7501000000017', { product: tornillo }],
  ['ARROZ-25', { product: arroz }],
  ['LECHE-1L', { product: leche }],
  ['TAL-BOSCH', { product: taladro }],
  ['BSH-000', { product: taladro, batch: unidadVieja }],
]);

const deps = fakeHandlerDeps({
  productos: [tornillo, arroz, leche, taladro],
  lotes: [unidadVieja, loteViejo],
  nodos: NODOS,
  codigos: CODIGOS,
});

const runner = new LinearRunner(mvpRegistry());

const plantilla = (code: string): ProcessTemplate => {
  const t = FACTORY_TEMPLATES.find((f) => f.code === code)!;
  return unwrap(
    ProcessTemplate.create({ id: v7() as ProcessTemplateId, orgId: ORG, code: t.code, version: t.version, steps: t.steps }),
  );
};

/**
 * Recorre una plantilla de principio a fin respondiendo cada paso con lo que
 * diga `respuestas`. Un paso sin respuesta se omite, que es exactamente lo que
 * hace un cliente genérico: seguir lo que el servidor le va indicando.
 */
async function recorrer(code: string, respuestas: Record<string, unknown>) {
  const template = plantilla(code);
  let instance = runner.start({ id: v7() as ProcessInstanceId, orgId: ORG, template, actorId: ACTOR });
  const pasos: string[] = [];

  for (let guarda = 0; guarda < 20; guarda += 1) {
    const stepId = instance.currentStepId;
    if (stepId === undefined) break;
    pasos.push(stepId);
    const r = await runner.advance({
      instance, template, stepId,
      payload: stepId in respuestas ? respuestas[stepId] : null,
      deps,
    });
    if (!r.ok) return { error: r.error, pasos, instance };
    instance = r.value.instance;
    if (!instance.isOpen()) return { outcome: r.value, pasos, instance };
  }
  throw new Error(`${code} no terminó`);
}

/**
 * La aserción que cierra el círculo: el borrador final se convierte en lo que
 * `Movement.create` espera y el ledger lo acepta. **Es la única prueba que
 * demuestra que el motor y el ledger hablan el mismo idioma.**
 *
 * El `occurredAt` lo pone aquí la prueba, como en producción lo pondrá el
 * aplicador de efectos con el `Clock`: el borrador no lo lleva.
 */
function asiento(draft: MovementDraft) {
  const product = [tornillo, arroz, leche, taladro].find((p) => p.id === draft.productId)!;
  // Lo que hará el efecto CREATE_BATCH antes de emitir el movimiento.
  const { productId: _delLote, ...datosDelLote } = draft.newBatch ?? { productId: undefined };
  const batch = draft.newBatch
    ? unwrap(Batch.create({ id: v7() as BatchId, product, ...datosDelLote }))
    : [unidadVieja, loteViejo].find((b) => b.id === draft.batchId);

  return Movement.create({
    id: v7() as MovementId,
    orgId: ORG,
    product,
    ...(batch !== undefined ? { batch } : {}),
    fromNode: NODOS.find((n) => n.id === draft.fromNodeId)!,
    toNode: NODOS.find((n) => n.id === draft.toNodeId)!,
    quantity: draft.quantity!,
    occurredAt: OCURRIO,
    recordedAt: OCURRIO,
    actorId: ACTOR,
    ...(draft.reason !== undefined ? { reason: draft.reason } : {}),
    ...(draft.dueAt !== undefined ? { dueAt: draft.dueAt } : {}),
    traceId: TRACE,
  });
}

// ── Los tres modos de seguimiento, y lo que cada uno responde en `lote` ───────

const MODOS = {
  QUANTITY: { codigo: '7501000000017', cantidad: '500', lote: undefined },
  LOT: { codigo: 'LECHE-1L', cantidad: '48', lote: { lotCode: 'L-2026-09', expiresAt: VENCE } },
  SERIAL: { codigo: 'BSH-000', cantidad: '1', lote: undefined },
} as const;

/** Lo que cada plantilla necesita más allá del producto y la cantidad. */
const EXTRAS: Record<string, Record<string, unknown>> = {
  RECEPCION: {
    origen: { nodeId: porCodigo('supplier-default').id },
    destino: { nodeId: B2.id },
    foto: { storageKeys: ['org/foto-1' as StorageKey] },
  },
  TRASLADO: { origen: { nodeId: B2.id }, destino: { nodeId: B3.id } },
  SALIDA: { origen: { nodeId: B2.id }, destino: { nodeId: porCodigo('sale').id } },
  AJUSTE_ENTRADA: { destino: { nodeId: B2.id }, motivo: { reason: 'apareció en el conteo' } },
  AJUSTE_SALIDA: { origen: { nodeId: B2.id }, motivo: { reason: 'faltó en el conteo' } },
  CUSTODIA: { origen: { nodeId: B2.id }, tenedor: { nodeId: JUAN.id }, vencimiento: { dueAt: DEVOLVER } },
};

describe('las seis plantillas de fábrica, de punta a punta', () => {
  for (const { code } of FACTORY_TEMPLATES) {
    for (const [modo, m] of Object.entries(MODOS)) {
      it(`${code} con un producto ${modo} llega a CONFIRM y el asiento se acepta`, async () => {
        const respuestas: Record<string, unknown> = {
          item: { code: m.codigo },
          cantidad: { quantity: m.cantidad },
          confirmar: {},
          ...EXTRAS[code],
          ...(m.lote !== undefined ? { lote: m.lote } : {}),
        };

        const r = await recorrer(code, respuestas);
        expect(r.error, r.error?.message).toBeUndefined();
        expect(r.instance.state).toBe(ProcessState.COMPLETED);

        const emision = r.outcome!.effects.find((e) => e.kind === 'EMIT_MOVEMENTS');
        expect(emision, 'todo proceso completado emite su movimiento').toBeDefined();
        const draft = (emision as { drafts: readonly MovementDraft[] }).drafts[0]!;

        // El borrador no arrastra la hora: la pone quien confirma.
        expect('occurredAt' in draft).toBe(false);

        const asentado = asiento(draft);
        expect(asentado.ok, !asentado.ok ? asentado.error.message : '').toBe(true);
        expect(unwrap(asentado).quantity.toString()).toBe(`${m.cantidad}.000`);
      });
    }
  }
});

describe('lo que cada modo exige del paso del lote', () => {
  // El paso es opcional en la plantilla porque la plantilla no sabe qué
  // producto va a pasar por ella; el manejador sí.
  it('omitir el lote con un producto LOT es batch-step-required', async () => {
    const r = await recorrer('TRASLADO', {
      item: { code: 'LECHE-1L' }, cantidad: { quantity: '10' }, confirmar: {}, ...EXTRAS.TRASLADO,
    });
    expect(r.error?.type).toBe('batch-step-required');
    expect(r.pasos.at(-1)).toBe('lote');
  });

  it('mandar datos de lote con un producto QUANTITY es batch-step-not-allowed', async () => {
    const r = await recorrer('TRASLADO', {
      item: { code: '7501000000017' }, lote: { lotCode: 'L-1' },
      cantidad: { quantity: '10' }, confirmar: {}, ...EXTRAS.TRASLADO,
    });
    expect(r.error?.type).toBe('batch-step-not-allowed');
  });

  // Una serie escaneada ya trae su unidad: el paso sobra, y omitirlo es correcto.
  it('con una serie que el escaneo ya resolvió, omitir el lote es lo correcto', async () => {
    const r = await recorrer('TRASLADO', {
      item: { code: 'BSH-000' }, cantidad: { quantity: '1' }, confirmar: {}, ...EXTRAS.TRASLADO,
    });
    expect(r.error).toBeUndefined();
    const draft = (r.outcome!.effects.find((e) => e.kind === 'EMIT_MOVEMENTS') as { drafts: readonly MovementDraft[] }).drafts[0]!;
    expect(draft.batchId).toBe(unidadVieja.id);
  });
});

describe('lo que cada plantilla produce además del movimiento', () => {
  it('RECEPCION con lote nuevo emite los tres efectos, en orden', async () => {
    const r = await recorrer('RECEPCION', {
      item: { code: 'LECHE-1L' }, lote: { lotCode: 'L-2026-10', expiresAt: VENCE },
      cantidad: { quantity: '24' }, confirmar: {}, ...EXTRAS.RECEPCION,
    });
    expect(r.outcome!.effects.map((e) => e.kind)).toEqual(['CREATE_BATCH', 'EMIT_MOVEMENTS', 'ATTACH_MEDIA']);
  });

  // P-6: una recepción a medias no ensucia el inventario ni el catálogo.
  it('ningún paso anterior a confirmar produce nada, ni siquiera el de la foto', async () => {
    const template = plantilla('RECEPCION');
    let instance = runner.start({ id: v7() as ProcessInstanceId, orgId: ORG, template, actorId: ACTOR });
    const respuestas: Record<string, unknown> = {
      item: { code: '7501000000017' }, cantidad: { quantity: '5' }, ...EXTRAS.RECEPCION,
    };
    while (instance.currentStepId !== undefined && instance.currentStepId !== 'confirmar') {
      const stepId = instance.currentStepId;
      const out = unwrap(
        await runner.advance({
          instance, template, stepId,
          payload: stepId in respuestas ? respuestas[stepId] : null,
          deps,
        }),
      );
      expect(out.effects, `el paso ${stepId} produjo efectos`).toEqual([]);
      instance = out.instance;
    }
    // Y al abandonarlo aquí, las claves de foto siguen sin reclamar.
    expect(instance.context.storageKeys).toEqual(['org/foto-1']);
    expect(instance.cancelled().state).toBe(ProcessState.CANCELLED);
  });

  // D-36: un asiento contra adjustment-in o adjustment-out exige reason en el
  // dominio, y por eso el paso `motivo` de las dos de ajuste es required.
  it('las dos de ajuste llevan su motivo hasta el asiento', async () => {
    for (const code of ['AJUSTE_ENTRADA', 'AJUSTE_SALIDA']) {
      const r = await recorrer(code, {
        item: { code: '7501000000017' }, cantidad: { quantity: '7' }, confirmar: {}, ...EXTRAS[code],
      });
      const draft = (r.outcome!.effects.find((e) => e.kind === 'EMIT_MOVEMENTS') as { drafts: readonly MovementDraft[] }).drafts[0]!;
      expect(draft.reason).toContain('conteo');
      expect(unwrap(asiento(draft)).reason).toContain('conteo');
    }
  });

  it('AJUSTE_ENTRADA no pide origen: lo fija CONFIRM por código', async () => {
    const r = await recorrer('AJUSTE_ENTRADA', {
      item: { code: '7501000000017' }, cantidad: { quantity: '7' }, confirmar: {}, ...EXTRAS.AJUSTE_ENTRADA,
    });
    expect(r.pasos).toEqual(['item', 'lote', 'cantidad', 'motivo', 'destino', 'confirmar']);
    const draft = (r.outcome!.effects.find((e) => e.kind === 'EMIT_MOVEMENTS') as { drafts: readonly MovementDraft[] }).drafts[0]!;
    expect(draft.fromNodeId).toBe(porCodigo('adjustment-in').id);
  });

  it('CUSTODIA lleva la fecha de devolución hasta el asiento (I-11)', async () => {
    const r = await recorrer('CUSTODIA', {
      item: { code: 'BSH-000' }, cantidad: { quantity: '1' }, confirmar: {}, ...EXTRAS.CUSTODIA,
    });
    const draft = (r.outcome!.effects.find((e) => e.kind === 'EMIT_MOVEMENTS') as { drafts: readonly MovementDraft[] }).drafts[0]!;
    expect(draft.dueAt).toEqual(DEVOLVER);
    expect(unwrap(asiento(draft)).dueAt).toEqual(DEVOLVER);
  });
});
