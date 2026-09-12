import type { ProcessInstanceId } from '@app/common';
import { Product, TrackingMode, type ProductId } from '@app/catalog';
import { Role } from '@app/tenancy';
import { NodeKind, type MovementId, type Node } from '@app/inventory';
import { ORG, aNode } from '../../../../test/builders/a-node.js';
import { aContext } from '../../../../test/builders/a-context.js';
import { aBatch, aProduct } from '../../../../test/builders/a-movement.js';
import {
  InMemoryMovementRepository, InMemoryNodeRepository, InMemoryStockBalanceRepository,
  RecordingEventPublisher, fakeIds, fixedClock,
} from '../../../../test/doubles/in-memory.js';
import { RecordMovement } from './record-movement.js';
import { RecordMovementBatch, MAX_BATCH_MOVEMENTS } from './record-movement-batch.js';
import { ReverseMovement } from './reverse-movement.js';

/** Products live in a tiny in-memory catalogue; only findById is ever reached for. */
class FakeProducts {
  readonly rows: Product[] = [];
  add<T extends Product>(p: T): T {
    this.rows.push(p);
    return p;
  }
  async findById(_o: unknown, id: string) {
    return this.rows.find((p) => p.id === id) ?? null;
  }
}
class FakeBatches {
  readonly rows: { id: string }[] = [];
  add<T extends { id: string }>(b: T): T {
    this.rows.push(b);
    return b;
  }
  async findById(_o: unknown, id: string) {
    return this.rows.find((b) => b.id === id) ?? null;
  }
}

const NOW = new Date('2026-09-12T12:00:00.000Z');

function build() {
  const nodes = new InMemoryNodeRepository();
  const balances = new InMemoryStockBalanceRepository(nodes);
  const movements = new InMemoryMovementRepository();
  const products = new FakeProducts();
  const batches = new FakeBatches();
  const events = new RecordingEventPublisher();
  const record = new RecordMovement(
    movements, balances, nodes, products as never, batches as never, events, fakeIds, fixedClock,
  );
  return {
    nodes, balances, movements, products, batches, events, record,
    batch: new RecordMovementBatch(record, movements, balances, events, fakeIds, fixedClock),
    reverse: new ReverseMovement(
      movements, balances, nodes, products as never, batches as never, events, fakeIds, fixedClock,
    ),
  };
}

type World = Awaited<ReturnType<typeof aWarehouse>>;

/** supplier-default › BOD-A/Z1/E3/{B2,B3}, sale, shrinkage and Juan's custody. */
async function aWarehouse(t: ReturnType<typeof build>) {
  const put = (n: Node) => {
    t.nodes.rows.set(`${n.orgId}:${n.id}`, n);
    return n;
  };
  const bodA = put(aNode({ code: 'BOD-A' }));
  const z1 = put(aNode({ code: 'Z1' }, bodA));
  const e3 = put(aNode({ code: 'E3' }, z1));
  return {
    ctx: aContext(),
    bodA, z1, e3,
    b2: put(aNode({ code: 'B2' }, e3)),
    b3: put(aNode({ code: 'B3' }, e3)),
    supplier: put(aNode({ kind: NodeKind.SOURCE, code: 'supplier-default' })),
    opening: put(aNode({ kind: NodeKind.SOURCE, code: 'opening-balance' })),
    sale: put(aNode({ kind: NodeKind.TERMINAL, code: 'sale' })),
    shrinkage: put(aNode({ kind: NodeKind.TERMINAL, code: 'shrinkage' })),
    juan: put(aNode({ kind: NodeKind.CUSTODY, code: 'juan' })),
    tornillo: t.products.add(aProduct()),
  };
}

const move = (t: ReturnType<typeof build>, w: World, over: Record<string, unknown> = {}) =>
  t.record.execute(w.ctx, {
    productId: w.tornillo.id,
    fromNodeId: w.supplier.id,
    toNodeId: w.b2.id,
    quantity: '100',
    occurredAt: NOW,
    ...over,
  } as never);

const balanceAt = async (t: ReturnType<typeof build>, node: Node, product: { id: string }) =>
  (await t.balances.find(ORG, node.id, product.id as ProductId))?.quantity.toString() ?? '—';

describe('RecordMovement', () => {
  it('la recepción del proveedor deja el saldo en el estante, y lo anuncia', async () => {
    const t = build();
    const w = await aWarehouse(t);
    const { movement, balances } = await move(t, w);

    expect(movement.quantity.toString()).toBe('100.000');
    expect(movement.recordedAt).toEqual(NOW);
    expect(await balanceAt(t, w.b2, w.tornillo)).toBe('100.000');
    // Double entry: the boundary node goes to -100, which is what conservation means.
    expect(await balanceAt(t, w.supplier, w.tornillo)).toBe('-100.000');
    expect(balances).toHaveLength(2);
    expect(t.events.types()).toEqual(['stock.moved', 'stock.balance_changed']);
  });

  it('usa el id que manda el cliente, y lo rechaza si ya existe', async () => {
    const t = build();
    const w = await aWarehouse(t);
    const id = '018f0000-0000-7000-8000-00000000f001' as MovementId;
    expect((await move(t, w, { id })).movement.id).toBe(id);
    await expect(move(t, w, { id })).rejects.toMatchObject({ type: 'movement-id-taken' });
  });

  it('resuelve el producto y se niega si no existe o está retirado', async () => {
    const t = build();
    const w = await aWarehouse(t);
    await expect(move(t, w, { productId: 'no-existe' })).rejects.toMatchObject({ type: 'not-found' });
    const retirado = t.products.add(aProduct({ sku: 'VIEJO' }).deactivate());
    await expect(move(t, w, { productId: retirado.id })).rejects.toMatchObject({ type: 'product-inactive' });
  });

  it('resuelve los dos nodos y se niega si falta alguno', async () => {
    const t = build();
    const w = await aWarehouse(t);
    await expect(move(t, w, { fromNodeId: 'no-existe' })).rejects.toMatchObject({ type: 'not-found' });
    await expect(move(t, w, { toNodeId: 'no-existe' })).rejects.toMatchObject({ type: 'not-found' });
  });

  it('resuelve el lote y se niega si no existe', async () => {
    const t = build();
    const w = await aWarehouse(t);
    const leche = t.products.add(aProduct({ sku: 'LECHE-1L', trackingMode: TrackingMode.LOT }));
    await expect(
      move(t, w, { productId: leche.id, batchId: 'no-existe' }),
    ).rejects.toMatchObject({ type: 'not-found' });
  });

  it('la cantidad viaja como cadena y se rechaza si no es una cantidad', async () => {
    const t = build();
    const w = await aWarehouse(t);
    await expect(move(t, w, { quantity: '0' })).rejects.toMatchObject({ type: 'non-positive-quantity' });
    await expect(move(t, w, { quantity: 'abc' })).rejects.toMatchObject({ type: 'invalid-quantity' });
  });

  it('propaga las invariantes del asiento', async () => {
    const t = build();
    const w = await aWarehouse(t);
    await expect(move(t, w, { toNodeId: w.supplier.id })).rejects.toMatchObject({ type: 'same-node' });
    await expect(
      move(t, w, { fromNodeId: w.b3.id, toNodeId: w.shrinkage.id }),
    ).rejects.toMatchObject({ type: 'reason-required' });
  });

  describe('I-4 · no se despacha lo que no hay', () => {
    it('insufficient-stock trae el path legible, lo disponible y lo pedido', async () => {
      const t = build();
      const w = await aWarehouse(t);
      await move(t, w, { quantity: '10' });

      const fallo = move(t, w, { fromNodeId: w.b2.id, toNodeId: w.sale.id, quantity: '999' });
      await expect(fallo).rejects.toMatchObject({
        type: 'insufficient-stock',
        message: expect.stringContaining('BOD-A/Z1/E3/B2'),
      });
      await fallo.catch((e: { errors?: { available?: string; requested?: string }[] }) => {
        expect(e.errors?.[0]?.available).toBe('10.000');
        expect(e.errors?.[0]?.requested).toBe('999.000');
      });
    });

    // The double reverts its own writes before raising, exactly like the
    // savepoint does: without that, this test would pass over a balance that
    // production would have rolled back.
    it('y el saldo no cambió', async () => {
      const t = build();
      const w = await aWarehouse(t);
      await move(t, w, { quantity: '10' });
      await move(t, w, { fromNodeId: w.b2.id, toNodeId: w.sale.id, quantity: '999' }).catch(() => {});
      expect(await balanceAt(t, w.b2, w.tornillo)).toBe('10.000');
      expect(await balanceAt(t, w.sale, w.tornillo)).toBe('—');
    });

    it('un nodo de frontera sí baja de cero: su saldo es un acumulado', async () => {
      const t = build();
      const w = await aWarehouse(t);
      await move(t, w, { quantity: '5' });
      expect(await balanceAt(t, w.supplier, w.tornillo)).toBe('-5.000');
    });
  });

  describe('I-9 · una serie no está en dos sitios a la vez', () => {
    const serialWorld = async () => {
      const t = build();
      const w = await aWarehouse(t);
      const taladro = t.products.add(aProduct({ sku: 'TAL-BOSCH', trackingMode: TrackingMode.SERIAL }));
      const bsh = t.batches.add(aBatch(taladro, { serial: 'BSH-001' }));
      return { t, w, taladro, bsh };
    };

    it('recibirla dos veces desde la frontera falla', async () => {
      const { t, w, taladro, bsh } = await serialWorld();
      const recibir = () =>
        move(t, w, { productId: taladro.id, batchId: bsh.id, quantity: '1' });
      await recibir();
      await expect(recibir()).rejects.toMatchObject({ type: 'serial-already-placed' });
    });

    // The unit leaves and enters in the same entry, so it is never in two
    // places: the rule must not fire, or no serial could ever be moved.
    it('trasladarla entre dos estantes no dispara la regla', async () => {
      const { t, w, taladro, bsh } = await serialWorld();
      await move(t, w, { productId: taladro.id, batchId: bsh.id, quantity: '1' });
      const r = await move(t, w, {
        productId: taladro.id, batchId: bsh.id, quantity: '1',
        fromNodeId: w.b2.id, toNodeId: w.b3.id,
      });
      expect(r.movement.toNodeId).toBe(w.b3.id);
    });

    it('ni prestarla, que también es custodiable → custodiable', async () => {
      const { t, w, taladro, bsh } = await serialWorld();
      await move(t, w, { productId: taladro.id, batchId: bsh.id, quantity: '1' });
      const r = await move(t, w, {
        productId: taladro.id, batchId: bsh.id, quantity: '1',
        fromNodeId: w.b2.id, toNodeId: w.juan.id, dueAt: new Date('2026-09-19T12:00:00.000Z'),
      });
      expect(r.movement.dueAt).toBeDefined();
    });
  });

  describe('stock.balance_changed solo al cruzar cero, y solo en custodiables', () => {
    it('de 0 a 10 sí, de 10 a 4 no, de 4 a 0 sí', async () => {
      const t = build();
      const w = await aWarehouse(t);
      await move(t, w, { quantity: '10' });
      expect(t.events.types()).toContain('stock.balance_changed');

      t.events.published.length = 0;
      await move(t, w, { fromNodeId: w.b2.id, toNodeId: w.b3.id, quantity: '6' });
      // B2 10→4 does not cross; B3 0→6 does.
      expect(t.events.types().filter((x) => x === 'stock.balance_changed')).toHaveLength(1);

      t.events.published.length = 0;
      await move(t, w, { fromNodeId: w.b2.id, toNodeId: w.b3.id, quantity: '4' });
      expect(t.events.types().filter((x) => x === 'stock.balance_changed')).toHaveLength(1);
    });

    it('un TERMINAL que pasa de 0 a 15 no lo anuncia: no es inventario propio', async () => {
      const t = build();
      const w = await aWarehouse(t);
      await move(t, w, { quantity: '20' });
      t.events.published.length = 0;
      await move(t, w, { fromNodeId: w.b2.id, toNodeId: w.sale.id, quantity: '15' });
      expect(t.events.types()).toEqual(['stock.moved']);
    });
  });

  describe('custodia', () => {
    const dueAt = new Date('2026-09-19T12:00:00.000Z');

    const prestar = async (t: ReturnType<typeof build>, w: World, quantity = '5') => {
      await move(t, w, { quantity: '20' });
      t.events.published.length = 0;
      return move(t, w, { fromNodeId: w.b2.id, toNodeId: w.juan.id, quantity, dueAt });
    };

    it('prestar anuncia custody.checked_out', async () => {
      const t = build();
      const w = await aWarehouse(t);
      await prestar(t, w);
      expect(t.events.types()).toContain('custody.checked_out');
    });

    it('devolver exige settlesId, y anuncia checked_in con el pendiente restante', async () => {
      const t = build();
      const w = await aWarehouse(t);
      const { movement: prestamo } = await prestar(t, w);

      await expect(
        move(t, w, { fromNodeId: w.juan.id, toNodeId: w.b2.id, quantity: '2' }),
      ).rejects.toMatchObject({ type: 'settles-required' });

      t.events.published.length = 0;
      await move(t, w, {
        fromNodeId: w.juan.id, toNodeId: w.b2.id, quantity: '2', settlesId: prestamo.id,
      });
      const checkIn = t.events.published.find((e) => e.type === 'custody.checked_in');
      expect(checkIn?.data.pending).toBe('3.000');
    });

    it('I-18 · devolver más de lo pendiente falla con el pendiente real', async () => {
      const t = build();
      const w = await aWarehouse(t);
      const { movement: prestamo } = await prestar(t, w);
      await move(t, w, {
        fromNodeId: w.juan.id, toNodeId: w.b2.id, quantity: '2', settlesId: prestamo.id,
      });
      const fallo = move(t, w, {
        fromNodeId: w.juan.id, toNodeId: w.b2.id, quantity: '4', settlesId: prestamo.id,
      });
      await expect(fallo).rejects.toMatchObject({ type: 'settles-exceeded' });
      await fallo.catch((e: { errors?: { pending?: string }[] }) =>
        expect(e.errors?.[0]?.pending).toBe('3.000'));
    });

    it('un settlesId que no existe es un 404', async () => {
      const t = build();
      const w = await aWarehouse(t);
      await move(t, w, { quantity: '20' });
      await expect(
        move(t, w, {
          fromNodeId: w.b2.id, toNodeId: w.b3.id, settlesId: '018f0000-0000-7000-8000-0000000000ff',
        }),
      ).rejects.toMatchObject({ type: 'not-found' });
    });
  });

  it('guarda processInstanceId cuando el proceso lo manda', async () => {
    const t = build();
    const w = await aWarehouse(t);
    const r = await move(t, w, { processInstanceId: 'pi-1' as ProcessInstanceId });
    expect(r.movement.processInstanceId).toBe('pi-1');
  });

  it('autorización: OPERATOR registra, VIEWER no', async () => {
    const t = build();
    const w = await aWarehouse(t);
    const operario = aContext([Role.OPERATOR]);
    const mirona = aContext([Role.VIEWER]);
    await expect(
      t.record.execute(mirona, {
        productId: w.tornillo.id, fromNodeId: w.supplier.id, toNodeId: w.b2.id,
        quantity: '1', occurredAt: NOW,
      }),
    ).rejects.toMatchObject({ type: 'insufficient-role' });
    const ok = await t.record.execute(operario, {
      productId: w.tornillo.id, fromNodeId: w.supplier.id, toNodeId: w.b2.id,
      quantity: '1', occurredAt: NOW,
    });
    expect(ok.movement.actorId).toBe(operario.userId);
  });
});

describe('ReverseMovement', () => {
  const stock = async (t: ReturnType<typeof build>, w: World) => {
    await move(t, w, { quantity: '100' });
  };

  const setup = async () => {
    const t = build();
    const w = await aWarehouse(t);
    await stock(t, w);
    const { movement } = await move(t, w, { fromNodeId: w.b2.id, toNodeId: w.b3.id, quantity: '100' });
    return { t, w, movement };
  };

  it('invierte el asiento, cuadra los saldos y lo anuncia', async () => {
    const t = build();
    const w = await aWarehouse(t);
    await stock(t, w);
    const { movement } = await move(t, w, { fromNodeId: w.b2.id, toNodeId: w.b3.id, quantity: '100' });
    t.events.published.length = 0;

    const { reversal } = await t.reverse.execute(w.ctx, { movementId: movement.id, reason: 'eran 10' });

    expect(reversal.reversesId).toBe(movement.id);
    expect(await balanceAt(t, w.b2, w.tornillo)).toBe('100.000');
    expect(await balanceAt(t, w.b3, w.tornillo)).toBe('0.000');
    expect(t.events.types()).toContain('stock.reversed');
  });

  it('I-13 · no se compensa dos veces', async () => {
    const t = build();
    const w = await aWarehouse(t);
    await stock(t, w);
    const { movement } = await move(t, w, { fromNodeId: w.b2.id, toNodeId: w.b3.id, quantity: '100' });
    await t.reverse.execute(w.ctx, { movementId: movement.id, reason: 'eran 10' });
    await expect(
      t.reverse.execute(w.ctx, { movementId: movement.id, reason: 'otra vez' }),
    ).rejects.toMatchObject({ type: 'already-reversed' });
  });

  // The right way out is to bring the stock back first. The system does not
  // invent goods to make a correction balance.
  it('compensar sin stock falla: no se inventan existencias', async () => {
    const t = build();
    const w = await aWarehouse(t);
    await stock(t, w);
    const { movement } = await move(t, w, { fromNodeId: w.b2.id, toNodeId: w.b3.id, quantity: '100' });
    await move(t, w, { fromNodeId: w.b3.id, toNodeId: w.sale.id, quantity: '100' });
    await expect(
      t.reverse.execute(w.ctx, { movementId: movement.id, reason: 'me equivoqué' }),
    ).rejects.toMatchObject({ type: 'insufficient-stock' });
  });

  // D-41 · La compensación de un despacho es una entrada desde la frontera, así
  // que puede devolver a la estantería una serie que mientras tanto volvió a
  // entrar por otro sitio. Hasta el plan 6, `guardSerial` solo la miraba al
  // recibir y nadie preguntaba nada al compensar.
  describe('I-9 · compensar un despacho también coloca una serie', () => {
    const conSerie = async () => {
      const t = build();
      const w = await aWarehouse(t);
      const taladro = t.products.add(aProduct({ sku: 'TAL-BOSCH', trackingMode: TrackingMode.SERIAL }));
      const bsh = t.batches.add(aBatch(taladro, { serial: 'BSH-001' }));
      const serie = { productId: taladro.id, batchId: bsh.id, quantity: '1' };
      await move(t, w, serie);
      const { movement: venta } = await move(t, w, {
        ...serie, fromNodeId: w.b2.id, toNodeId: w.sale.id,
      });
      return { t, w, serie, venta };
    };

    it('si la serie volvió a entrar en otro sitio, la compensación se rechaza', async () => {
      const { t, w, serie, venta } = await conSerie();
      // El proveedor manda otra unidad con la misma serie, y el sistema hace
      // bien en aceptarla: en custodia no queda ninguna.
      await move(t, w, { ...serie, toNodeId: w.b3.id });
      await expect(
        t.reverse.execute(w.ctx, { movementId: venta.id, reason: 'la venta se anuló' }),
      ).rejects.toMatchObject({ type: 'serial-already-placed' });
    });

    it('y si no está en ninguna parte, la compensación pasa', async () => {
      const { t, w, venta } = await conSerie();
      const { reversal } = await t.reverse.execute(w.ctx, { movementId: venta.id, reason: 'la venta se anuló' });
      expect(reversal.toNodeId).toBe(w.b2.id);
    });

    // La guarda no puede dispararse al deshacer una recepción —sale de un nodo
    // custodiable— ni un traslado, o no habría forma de corregir ninguno.
    it('deshacer una recepción no la dispara', async () => {
      const t = build();
      const w = await aWarehouse(t);
      const taladro = t.products.add(aProduct({ sku: 'TAL-BOSCH', trackingMode: TrackingMode.SERIAL }));
      const bsh = t.batches.add(aBatch(taladro, { serial: 'BSH-001' }));
      const { movement } = await move(t, w, { productId: taladro.id, batchId: bsh.id, quantity: '1' });
      const { reversal } = await t.reverse.execute(w.ctx, { movementId: movement.id, reason: 'no era esa' });
      expect(reversal.toNodeId).toBe(w.supplier.id);
    });
  });

  it('un movimiento que no existe es un 404', async () => {
    const { t, w } = await setup();
    await expect(
      t.reverse.execute(w.ctx, { movementId: '018f0000-0000-7000-8000-0000000000ee' as MovementId, reason: 'x' }),
    ).rejects.toMatchObject({ type: 'not-found' });
  });

  it('autorización: el OPERATOR no compensa', async () => {
    const { t, movement } = await setup();
    await expect(
      t.reverse.execute(aContext([Role.OPERATOR]), { movementId: movement.id, reason: 'x' }),
    ).rejects.toMatchObject({ type: 'insufficient-role' });
  });
});

describe('RecordMovementBatch', () => {
  const linea = (w: World, over: Record<string, unknown> = {}) => ({
    productId: w.tornillo.id,
    fromNodeId: w.opening.id,
    toNodeId: w.b2.id,
    quantity: '1',
    occurredAt: NOW,
    ...over,
  });

  it('carga el saldo inicial de una hoja en una sola pasada', async () => {
    const t = build();
    const w = await aWarehouse(t);
    const r = await t.batch.execute(w.ctx, {
      movements: [linea(w, { quantity: '10' }), linea(w, { quantity: '5', toNodeId: w.b3.id })],
    } as never);

    expect(r.movements).toHaveLength(2);
    expect(await balanceAt(t, w.b2, w.tornillo)).toBe('10.000');
    expect(await balanceAt(t, w.b3, w.tornillo)).toBe('5.000');
  });

  // D-39: one applyDelta, so two lines onto the same bin are one upsert. N
  // separate calls would be N savepoints and would block on each other.
  it('dos líneas sobre el mismo estante se agregan en un solo delta', async () => {
    const t = build();
    const w = await aWarehouse(t);
    const r = await t.batch.execute(w.ctx, {
      movements: [linea(w, { quantity: '10' }), linea(w, { quantity: '7' })],
    } as never);
    expect(await balanceAt(t, w.b2, w.tornillo)).toBe('17.000');
    expect(r.balances.filter((b) => b.nodeId === w.b2.id)).toHaveLength(1);
  });

  it('más de quinientos movimientos no es un lote', async () => {
    const t = build();
    const w = await aWarehouse(t);
    const muchos = Array.from({ length: MAX_BATCH_MOVEMENTS + 1 }, () => linea(w));
    await expect(t.batch.execute(w.ctx, { movements: muchos } as never)).rejects.toMatchObject({
      type: 'batch-too-large',
    });
  });

  it('todo o nada: un movimiento inválido en medio no persiste ninguno', async () => {
    const t = build();
    const w = await aWarehouse(t);
    await expect(
      t.batch.execute(w.ctx, {
        movements: [linea(w), linea(w), linea(w, { quantity: '0' }), linea(w)],
      } as never),
    ).rejects.toMatchObject({ type: 'non-positive-quantity' });
    expect(t.movements.rows).toHaveLength(0);
    expect(await balanceAt(t, w.b2, w.tornillo)).toBe('—');
  });

  it('I-9 dentro del mismo lote: la misma serie dos veces tampoco', async () => {
    const t = build();
    const w = await aWarehouse(t);
    const taladro = t.products.add(aProduct({ sku: 'TAL-BOSCH', trackingMode: TrackingMode.SERIAL }));
    const bsh = t.batches.add(aBatch(taladro, { serial: 'BSH-001' }));
    const l = { productId: taladro.id, batchId: bsh.id, quantity: '1' };
    await expect(
      t.batch.execute(w.ctx, { movements: [linea(w, l), linea(w, l)] } as never),
    ).rejects.toMatchObject({ type: 'serial-already-placed' });
  });

  it('autorización: el VIEWER no carga lotes', async () => {
    const t = build();
    const w = await aWarehouse(t);
    await expect(
      t.batch.execute(aContext([Role.VIEWER]), { movements: [linea(w)] } as never),
    ).rejects.toMatchObject({ type: 'insufficient-role' });
  });
});
