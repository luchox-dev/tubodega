import { v7 } from 'uuid';
import { unwrap, type ProcessInstanceId } from '@app/common';
import { Batch, Product, TrackingMode, type BatchId, type ProductId, type StorageKey } from '@app/catalog';
import { Quantity, type NodeId } from '@app/inventory';
import { aContext } from '../../test/builders/a-context.js';
import { ORG } from '../../test/builders/a-template.js';
import type { Effect } from '../domain/effects.js';
import type { MovementDraft } from '../domain/drafts.js';
import { EffectApplier } from './effect-applier.js';

const AHORA = new Date('2026-09-19T10:00:00.000Z');
const INSTANCIA = v7() as ProcessInstanceId;
const B2 = v7() as NodeId;
const MUELLE = v7() as NodeId;

const leche = unwrap(Product.create({
  id: v7() as ProductId, orgId: ORG, sku: 'LECHE-1L', name: 'Leche',
  trackingMode: TrackingMode.LOT, uom: 'UNIT',
}));

/**
 * Espías sobre los casos de uso reales, no `Recording*Port`: esos puertos ya no
 * existen (D-46). Lo que importa afirmar es **el orden** y **qué recibe cada
 * uno**, que es lo único que el aplicador decide.
 */
const build = () => {
  const llamadas: string[] = [];
  const recibido: Record<string, unknown> = {};
  const nuevo = unwrap(Batch.create({ id: v7() as BatchId, product: leche, lotCode: 'L-NUEVO' }));

  const createBatch = {
    execute: (_ctx: unknown, input: unknown) => {
      llamadas.push('CREATE_BATCH');
      recibido.batch = input;
      return Promise.resolve(nuevo);
    },
  };
  const recordBatch = {
    execute: (_ctx: unknown, input: { movements: readonly unknown[] }) => {
      llamadas.push('EMIT_MOVEMENTS');
      recibido.movements = input.movements;
      return Promise.resolve({ movements: [{ id: 'mov-1' }], balances: [] });
    },
  };
  const attach = {
    execute: (_ctx: unknown, input: unknown) => {
      llamadas.push('ATTACH_MEDIA');
      recibido.media = input;
      return Promise.resolve([]);
    },
  };

  return {
    llamadas, recibido, nuevo,
    applier: new EffectApplier(createBatch as never, recordBatch as never, attach as never, { now: () => AHORA }),
  };
};

const borrador = (over: Partial<MovementDraft> = {}): MovementDraft => ({
  productId: leche.id,
  quantity: unwrap(Quantity.of('24')),
  fromNodeId: MUELLE,
  toNodeId: B2,
  ...over,
});

describe('EffectApplier', () => {
  it('el orden es CREATE_BATCH, EMIT_MOVEMENTS, ATTACH_MEDIA, y no es cosmético', async () => {
    const t = build();
    const efectos: Effect[] = [
      { kind: 'CREATE_BATCH', draft: { productId: leche.id, lotCode: 'L-NUEVO' }, feeds: 0 },
      { kind: 'EMIT_MOVEMENTS', drafts: [borrador()] },
      { kind: 'ATTACH_MEDIA', productId: leche.id, storageKeys: ['k1' as StorageKey] },
    ];

    await t.applier.apply(aContext(), INSTANCIA, efectos);

    expect(t.llamadas).toEqual(['CREATE_BATCH', 'EMIT_MOVEMENTS', 'ATTACH_MEDIA']);
  });

  it('el id del lote recién creado aterriza en el borrador que dice `feeds`', async () => {
    const t = build();
    await t.applier.apply(aContext(), INSTANCIA, [
      { kind: 'CREATE_BATCH', draft: { productId: leche.id, lotCode: 'L-NUEVO' }, feeds: 0 },
      { kind: 'EMIT_MOVEMENTS', drafts: [borrador()] },
    ]);

    const movimientos = t.recibido.movements as { batchId?: string }[];
    expect(movimientos[0]?.batchId).toBe(t.nuevo.id);
  });

  it('`occurredAt` lo pone el reloj, no el borrador: la hora es la de confirmar', async () => {
    const t = build();
    await t.applier.apply(aContext(), INSTANCIA, [{ kind: 'EMIT_MOVEMENTS', drafts: [borrador()] }]);

    const movimientos = t.recibido.movements as { occurredAt: Date }[];
    expect(movimientos[0]?.occurredAt).toEqual(AHORA);
  });

  it('estampa el processInstanceId, que es lo que por fin llena la columna', async () => {
    const t = build();
    await t.applier.apply(aContext(), INSTANCIA, [{ kind: 'EMIT_MOVEMENTS', drafts: [borrador()] }]);

    const movimientos = t.recibido.movements as { processInstanceId: string }[];
    expect(movimientos[0]?.processInstanceId).toBe(INSTANCIA);
  });

  it('pasa `reason` y `dueAt` cuando el borrador los trae, y no cuando no', async () => {
    const t = build();
    const vence = new Date('2026-09-26T10:00:00.000Z');
    await t.applier.apply(aContext(), INSTANCIA, [
      { kind: 'EMIT_MOVEMENTS', drafts: [borrador({ reason: 'conteo', dueAt: vence })] },
    ]);
    expect(t.recibido.movements).toMatchObject([{ reason: 'conteo', dueAt: vence }]);

    const u = build();
    await u.applier.apply(aContext(), INSTANCIA, [{ kind: 'EMIT_MOVEMENTS', drafts: [borrador()] }]);
    expect(u.recibido.movements as object[]).toEqual([expect.not.objectContaining({ reason: expect.anything() })]);
  });

  it('adjunta por `storageKeys`, la forma que exige RECORD_MOVEMENT (D-14)', async () => {
    const t = build();
    await t.applier.apply(aContext(), INSTANCIA, [
      { kind: 'EMIT_MOVEMENTS', drafts: [borrador()] },
      { kind: 'ATTACH_MEDIA', productId: leche.id, storageKeys: ['k1' as StorageKey, 'k2' as StorageKey] },
    ]);
    expect(t.recibido.media).toEqual({ productId: leche.id, storageKeys: ['k1', 'k2'] });
  });

  it('sin CREATE_BATCH no llama a CreateBatch, y sin claves no llama a AttachMedia', async () => {
    const t = build();
    await t.applier.apply(aContext(), INSTANCIA, [{ kind: 'EMIT_MOVEMENTS', drafts: [borrador()] }]);
    expect(t.llamadas).toEqual(['EMIT_MOVEMENTS']);
  });

  it('devuelve los movimientos asentados, que son los que ve el cliente', async () => {
    const t = build();
    const out = await t.applier.apply(aContext(), INSTANCIA, [{ kind: 'EMIT_MOVEMENTS', drafts: [borrador()] }]);
    expect(out).toEqual([{ id: 'mov-1' }]);
  });

  it('sin efectos no llama a nadie ni inventa movimientos', async () => {
    const t = build();
    expect(await t.applier.apply(aContext(), INSTANCIA, [])).toEqual([]);
    expect(t.llamadas).toEqual([]);
  });
});
