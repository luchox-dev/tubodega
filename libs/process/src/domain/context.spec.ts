import { unwrap } from '@app/common';
import type { StorageKey } from '@app/catalog';
import { Quantity, type NodeId } from '@app/inventory';
import type { ProductId } from '@app/catalog';
import { ProcessContext } from './context.js';
import type { StepId } from './ids.js';

const PROD = '018f0000-0000-7000-8000-0000000000p1' as ProductId;
const B2 = '018f0000-0000-7000-8000-0000000000b2' as NodeId;
const B3 = '018f0000-0000-7000-8000-0000000000b3' as NodeId;
const qty = (raw: string) => unwrap(Quantity.of(raw));

describe('ProcessContext', () => {
  it('nace vacío: sin valores, sin borrador y sin claves', () => {
    const c = ProcessContext.empty();
    expect(c.values.size).toBe(0);
    expect(c.draft).toEqual({});
    expect(c.storageKeys).toEqual([]);
  });

  it('`with` acumula por paso, y no pierde lo anterior', () => {
    const c = ProcessContext.empty()
      .with('item' as StepId, { code: '7501000000017' })
      .with('cantidad' as StepId, { quantity: '10' });
    expect(c.values.get('item' as StepId)).toEqual({ code: '7501000000017' });
    expect(c.values.get('cantidad' as StepId)).toEqual({ quantity: '10' });
    expect(c.values.size).toBe(2);
  });

  it('`with` registra la omisión como null, que no es lo mismo que no estar', () => {
    const c = ProcessContext.empty().with('lote' as StepId, null);
    expect(c.values.has('lote' as StepId)).toBe(true);
    expect(c.values.get('lote' as StepId)).toBeNull();
  });

  it('no muta: el contexto anterior sigue como estaba', () => {
    const a = ProcessContext.empty().with('item' as StepId, { code: 'X' });
    const b = a.with('cantidad' as StepId, { quantity: '1' });
    expect(a.values.size).toBe(1);
    expect(b.values.size).toBe(2);
    expect(a).not.toBe(b);
  });

  /**
   * §3 dice que una instancia produce a lo sumo un movimiento: el borrador es
   * uno, y cada paso aporta su campo sobre el mismo. Si `withDraft` añadiera en
   * vez de fundir, el escaneo y la cantidad acabarían en dos borradores
   * distintos y CONFIRM no tendría ninguno completo.
   */
  it('`withDraft` funde, no reemplaza ni añade', () => {
    const c = ProcessContext.empty()
      .withDraft({ productId: PROD })
      .withDraft({ quantity: qty('10') })
      .withDraft({ toNodeId: B2 });
    expect(c.draft.productId).toBe(PROD);
    expect(c.draft.quantity?.toString()).toBe('10.000');
    expect(c.draft.toNodeId).toBe(B2);
  });

  it('`withDraft` sobrescribe el mismo campo con lo último que llegó', () => {
    const c = ProcessContext.empty().withDraft({ toNodeId: B2 }).withDraft({ toNodeId: B3 });
    expect(c.draft.toNodeId).toBe(B3);
  });

  it('`withDraft` no toca los valores ni las claves', () => {
    const c = ProcessContext.empty()
      .with('item' as StepId, { code: 'X' })
      .withStorageKeys(['org/a' as StorageKey])
      .withDraft({ productId: PROD });
    expect(c.values.size).toBe(1);
    expect(c.storageKeys).toEqual(['org/a']);
  });

  /**
   * Las claves de foto van en su propio campo y no en el borrador: no son parte
   * del movimiento, alimentan otro efecto, y sobre un producto y no sobre una
   * posición.
   */
  it('`withStorageKeys` acumula aparte del borrador', () => {
    const c = ProcessContext.empty()
      .withStorageKeys(['org/a' as StorageKey])
      .withStorageKeys(['org/b' as StorageKey, 'org/c' as StorageKey]);
    expect(c.storageKeys).toEqual(['org/a', 'org/b', 'org/c']);
    expect(c.draft).toEqual({});
  });

  it('el borrador no lleva occurredAt: la hora del asiento la pone quien confirma', () => {
    const c = ProcessContext.empty().withDraft({ productId: PROD, quantity: qty('1') });
    expect('occurredAt' in c.draft).toBe(false);
  });

  it('`rehydrate` reconstruye un contexto tal cual estaba', () => {
    const c = ProcessContext.rehydrate({
      values: new Map([['item' as StepId, { code: 'X' }]]),
      draft: { productId: PROD },
      storageKeys: ['org/a' as StorageKey],
    });
    expect(c.values.get('item' as StepId)).toEqual({ code: 'X' });
    expect(c.draft.productId).toBe(PROD);
    expect(c.storageKeys).toEqual(['org/a']);
  });
});
