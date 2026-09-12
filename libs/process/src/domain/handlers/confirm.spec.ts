import { unwrap } from '@app/common';
import { NodeKind, Quantity } from '@app/inventory';
import type { StorageKey } from '@app/catalog';
import { ProcessContext } from '../context.js';
import { ConfirmHandler } from './confirm.js';
import { fakeHandlerDeps, unNodo, unProducto } from '../../../test/doubles/fake-handler-deps.js';
import { TrackingMode } from '@app/catalog';

const h = new ConfirmHandler();

const tornillo = unProducto({ sku: 'TOR-M8' });
const leche = unProducto({ sku: 'LECHE-1L', trackingMode: TrackingMode.LOT });
const B2 = unNodo('B2');
const B3 = unNodo('B3');
const AJUSTE_IN = unNodo('adjustment-in', NodeKind.SOURCE);
const AJUSTE_OUT = unNodo('adjustment-out', NodeKind.TERMINAL);
const deps = fakeHandlerDeps({ productos: [tornillo, leche], nodos: [B2, B3, AJUSTE_IN, AJUSTE_OUT] });

const qty = (raw: string) => unwrap(Quantity.of(raw));

const completo = () =>
  ProcessContext.empty().withDraft({
    productId: tornillo.id, quantity: qty('10'), fromNodeId: B2.id, toNodeId: B3.id,
  });

describe('CONFIRM · el borrador', () => {
  it('un borrador completo pasa', async () => {
    expect((await h.validate({}, completo(), deps, {})).ok).toBe(true);
  });

  it('ignora lo que le manden: todo lo que necesita está en el contexto', () => {
    expect(unwrap(h.parse())).toEqual({});
  });

  it('un borrador incompleto es incomplete-draft, y lista lo que falta', async () => {
    const r = await h.validate({}, ProcessContext.empty(), deps, {});
    expect(!r.ok && r.error.type).toBe('incomplete-draft');
    expect(!r.ok && r.error.extensions).toEqual({
      missing: ['el producto', 'la cantidad', 'el origen', 'el destino'],
    });
  });

  it('lista solo lo que falta de verdad', async () => {
    const casi = ProcessContext.empty().withDraft({ productId: tornillo.id, fromNodeId: B2.id, toNodeId: B3.id });
    const r = await h.validate({}, casi, deps, {});
    expect(!r.ok && r.error.extensions).toEqual({ missing: ['la cantidad'] });
  });
});

describe('CONFIRM · los lados fijos', () => {
  const ENTRADA = { defaults: { fromNodeCode: 'adjustment-in' } };
  const SALIDA = { defaults: { toNodeCode: 'adjustment-out' } };

  /**
   * Un ajuste positivo no le pide al operario que "elija" el nodo
   * SOURCE:adjustment-in, que es el único posible.
   */
  it('resuelve el origen por código y lo deja en el borrador', async () => {
    const sinOrigen = ProcessContext.empty().withDraft({
      productId: tornillo.id, quantity: qty('3'), toNodeId: B2.id,
    });
    const p = unwrap(await h.validate({}, sinOrigen, deps, ENTRADA));
    expect(p.fromNodeId).toBe(AJUSTE_IN.id);
    expect(h.apply(p, sinOrigen).draft.fromNodeId).toBe(AJUSTE_IN.id);
  });

  it('y el destino igual', async () => {
    const sinDestino = ProcessContext.empty().withDraft({
      productId: tornillo.id, quantity: qty('3'), fromNodeId: B2.id,
    });
    const p = unwrap(await h.validate({}, sinDestino, deps, SALIDA));
    expect(p.toNodeId).toBe(AJUSTE_OUT.id);
  });

  // El default es una comodidad, no una imposición.
  it('lo que el borrador ya trae gana sobre el default', async () => {
    const p = unwrap(await h.validate({}, completo(), deps, ENTRADA));
    expect(p.fromNodeId).toBeUndefined();
    expect(h.apply(p, completo()).draft.fromNodeId).toBe(B2.id);
  });

  // Los ocho de frontera se siembran por código y son distintos en cada
  // organización: por eso el default nombra un código y no un uuid.
  it('un código que no existe en esta organización es invalid-step-payload', async () => {
    const sinOrigen = ProcessContext.empty().withDraft({
      productId: tornillo.id, quantity: qty('3'), toNodeId: B2.id,
    });
    const r = await h.validate({}, sinOrigen, deps, { defaults: { fromNodeCode: 'inventado' } });
    expect(!r.ok && r.error.type).toBe('invalid-step-payload');
    expect(!r.ok && r.error.message).toContain('inventado');
  });

  it('lo mismo por el lado del destino', async () => {
    const sinDestino = ProcessContext.empty().withDraft({
      productId: tornillo.id, quantity: qty('3'), fromNodeId: B2.id,
    });
    const r = await h.validate({}, sinDestino, deps, { defaults: { toNodeCode: 'inventado' } });
    expect(!r.ok && r.error.message).toContain('inventado');
  });

  it('un `defaults` que no es un objeto, o vacío, no estorba', async () => {
    for (const config of [{}, { defaults: null }, { defaults: 'adjustment-in' }, { defaults: { fromNodeCode: 7 } }]) {
      expect((await h.validate({}, completo(), deps, config)).ok).toBe(true);
    }
  });

  it('apply sin nada resuelto no toca el borrador', () => {
    expect(h.apply({}, completo()).draft.fromNodeId).toBe(B2.id);
  });
});

describe('CONFIRM · los efectos', () => {
  it('el mínimo es un EMIT_MOVEMENTS con el único borrador', () => {
    const ctx = completo();
    expect(h.effects(ctx)).toEqual([{ kind: 'EMIT_MOVEMENTS', drafts: [ctx.draft] }]);
  });

  /**
   * El orden no es cosmético: el movimiento necesita el batchId de un lote que
   * todavía no existe, así que CREATE_BATCH va primero y `feeds` dice en qué
   * borrador aterriza su id.
   */
  it('con lote nuevo, CREATE_BATCH va primero y alimenta al borrador 0', () => {
    const ctx = completo().withDraft({ newBatch: { productId: leche.id, lotCode: 'L-2026-09' } });
    const efectos = h.effects(ctx);
    expect(efectos[0]).toEqual({ kind: 'CREATE_BATCH', draft: ctx.draft.newBatch, feeds: 0 });
    expect(efectos[1]?.kind).toBe('EMIT_MOVEMENTS');
  });

  it('con fotos, ATTACH_MEDIA va al final y sobre el producto', () => {
    const ctx = completo().withStorageKeys(['org/a' as StorageKey]);
    const efectos = h.effects(ctx);
    expect(efectos).toHaveLength(2);
    expect(efectos[1]).toEqual({
      kind: 'ATTACH_MEDIA', productId: tornillo.id, storageKeys: ['org/a'],
    });
  });

  it('los tres, en orden', () => {
    const ctx = completo()
      .withDraft({ newBatch: { productId: leche.id, lotCode: 'L-2026-09' } })
      .withStorageKeys(['org/a' as StorageKey]);
    expect(h.effects(ctx).map((e) => e.kind)).toEqual(['CREATE_BATCH', 'EMIT_MOVEMENTS', 'ATTACH_MEDIA']);
  });

  it('sin producto no hay a qué adjuntar, aunque haya claves', () => {
    const ctx = ProcessContext.empty().withStorageKeys(['org/a' as StorageKey]);
    expect(h.effects(ctx).map((e) => e.kind)).toEqual(['EMIT_MOVEMENTS']);
  });
});

describe('CONFIRM · apply del destino resuelto', () => {
  it('el destino fijo también aterriza en el borrador', async () => {
    const sinDestino = ProcessContext.empty().withDraft({
      productId: tornillo.id, quantity: qty('3'), fromNodeId: B2.id,
    });
    const p = unwrap(await h.validate({}, sinDestino, deps, { defaults: { toNodeCode: 'adjustment-out' } }));
    expect(h.apply(p, sinDestino).draft.toNodeId).toBe(AJUSTE_OUT.id);
  });
});
