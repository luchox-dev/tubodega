import { Product, type ProductId } from '@app/catalog';
import { Role } from '@app/tenancy';
import { NodeKind, type MovementId, type Node, type NodeId } from '@app/inventory';
import { aNode } from '../../../../test/builders/a-node.js';
import { aContext } from '../../../../test/builders/a-context.js';
import { aProduct } from '../../../../test/builders/a-movement.js';
import {
  InMemoryMovementRepository, InMemoryNodeRepository, InMemoryStockBalanceRepository,
  RecordingEventPublisher, fakeIds, fixedClock,
} from '../../../../test/doubles/in-memory.js';
import { RecordMovement } from '../movements/record-movement.js';
import { GetMovementById } from './get-movement-by-id.js';
import { GetMovementHistory } from './get-movement-history.js';
import { GetOpenCustodies } from './get-open-custodies.js';
import { GetStock } from './get-stock.js';

class FakeProducts {
  readonly rows: Product[] = [];
  add<T extends Product>(p: T): T { this.rows.push(p); return p; }
  async findById(_o: unknown, id: string) { return this.rows.find((p) => p.id === id) ?? null; }
}
class FakeBatches {
  async findById() { return null; }
}

const NOW = new Date('2026-09-12T12:00:00.000Z');
const PAGE = { limit: 50 } as const;
const SORT = { limit: 50, sort: { field: 'occurredAt', dir: 'desc' } } as const;

function build() {
  const nodes = new InMemoryNodeRepository();
  const balances = new InMemoryStockBalanceRepository(nodes);
  const movements = new InMemoryMovementRepository();
  const products = new FakeProducts();
  const record = new RecordMovement(
    movements, balances, nodes, products as never, new FakeBatches() as never,
    new RecordingEventPublisher(), fakeIds, fixedClock,
  );
  return {
    nodes, balances, movements, products, record,
    stock: new GetStock(balances, nodes),
    history: new GetMovementHistory(movements),
    byId: new GetMovementById(movements),
    custodies: new GetOpenCustodies(movements, fixedClock),
  };
}

async function aWarehouse(t: ReturnType<typeof build>) {
  const put = (n: Node) => { t.nodes.rows.set(`${n.orgId}:${n.id}`, n); return n; };
  const bodA = put(aNode({ code: 'BOD-A' }));
  const z1 = put(aNode({ code: 'Z1' }, bodA));
  const e3 = put(aNode({ code: 'E3' }, z1));
  return {
    ctx: aContext(),
    bodA, z1, e3,
    b2: put(aNode({ code: 'B2' }, e3)),
    b3: put(aNode({ code: 'B3' }, e3)),
    supplier: put(aNode({ kind: NodeKind.SOURCE, code: 'supplier-default' })),
    sale: put(aNode({ kind: NodeKind.TERMINAL, code: 'sale' })),
    juan: put(aNode({ kind: NodeKind.CUSTODY, code: 'juan' })),
    tornillo: t.products.add(aProduct()),
  };
}

type World = Awaited<ReturnType<typeof aWarehouse>>;

const move = (t: ReturnType<typeof build>, w: World, over: Record<string, unknown> = {}) =>
  t.record.execute(w.ctx, {
    productId: w.tornillo.id, fromNodeId: w.supplier.id, toNodeId: w.b2.id,
    quantity: '100', occurredAt: NOW, ...over,
  } as never);

describe('GetStock', () => {
  const stocked = async () => {
    const t = build();
    const w = await aWarehouse(t);
    await move(t, w, { quantity: '100' });
    await move(t, w, { fromNodeId: w.b2.id, toNodeId: w.b3.id, quantity: '40' });
    await move(t, w, { fromNodeId: w.b3.id, toNodeId: w.sale.id, quantity: '15' });
    return { t, w };
  };

  it('sin filtros lista lo que hay, y solo lo que no es cero', async () => {
    const { t, w } = await stocked();
    const page = await t.stock.execute(w.ctx, {}, PAGE);
    const byNode = new Map(page.data.map((p) => [p.nodeId, p.quantity.toString()]));
    expect(byNode.get(w.b2.id)).toBe('60.000');
    expect(byNode.get(w.b3.id)).toBe('25.000');
  });

  // Without custodialOnly the answer includes the running totals of the
  // boundary, which are not stock on a shelf. The contract exposes it rather
  // than deciding for the client: "how much have I sold" is a legitimate query.
  it('custodialOnly deja fuera la frontera; sin él, el acumulado se ve', async () => {
    const { t, w } = await stocked();
    const propio = await t.stock.execute(w.ctx, { custodialOnly: true }, PAGE);
    expect(propio.data.map((p) => p.nodeId)).not.toContain(w.sale.id);

    const todo = await t.stock.execute(w.ctx, { custodialOnly: false, nonZeroOnly: false }, PAGE);
    const venta = todo.data.find((p) => p.nodeId === w.sale.id);
    expect(venta?.quantity.toString()).toBe('15.000');
  });

  it('under agrega el subárbol entero', async () => {
    const { t, w } = await stocked();
    const page = await t.stock.execute(w.ctx, { under: w.z1.id }, PAGE);
    expect(page.data).toHaveLength(1);
    expect(page.data[0]?.quantity.toString()).toBe('85.000');
  });

  // Same criterion as GET /v1/nodes (D-28): a 404 would say the collection
  // endpoint vanished, and an empty page is indistinguishable from an empty
  // subtree, so a mistyped uuid would read "there is nothing here" for ever.
  it('un under que no existe es 400 invalid-filter, no una página vacía', async () => {
    const { t, w } = await stocked();
    await expect(
      t.stock.execute(w.ctx, { under: '018f0000-0000-7000-8000-0000000000ff' as NodeId }, PAGE),
    ).rejects.toMatchObject({ type: 'invalid-filter' });
  });

  it('filtra por nodo y por producto', async () => {
    const { t, w } = await stocked();
    const enB2 = await t.stock.execute(w.ctx, { nodeId: w.b2.id }, PAGE);
    expect(enB2.data).toHaveLength(1);
    const delTornillo = await t.stock.execute(
      w.ctx, { productId: w.tornillo.id as ProductId, custodialOnly: true }, PAGE,
    );
    expect(delTornillo.data.length).toBeGreaterThan(0);
  });

  it('el VIEWER puede mirar', async () => {
    const { t } = await stocked();
    await expect(t.stock.execute(aContext([Role.VIEWER]), {}, PAGE)).resolves.toBeDefined();
  });
});

describe('GetMovementHistory', () => {
  const conHistoria = async () => {
    const t = build();
    const w = await aWarehouse(t);
    await move(t, w, { quantity: '100', occurredAt: new Date('2026-09-10T09:00:00.000Z') });
    await move(t, w, {
      fromNodeId: w.b2.id, toNodeId: w.b3.id, quantity: '40',
      occurredAt: new Date('2026-09-11T09:00:00.000Z'),
    });
    return { t, w };
  };

  it('devuelve lo último primero (D-37)', async () => {
    const { t, w } = await conHistoria();
    const page = await t.history.execute(w.ctx, {}, SORT);
    expect(page.data[0]?.occurredAt.toISOString()).toBe('2026-09-11T09:00:00.000Z');
  });

  // "Everything that touched this shelf", which is what somebody reconciling a
  // location actually asks — not "what left it" and "what entered it" apart.
  it('nodeId casa origen o destino', async () => {
    const { t, w } = await conHistoria();
    const page = await t.history.execute(w.ctx, { nodeId: w.b2.id }, SORT);
    expect(page.data).toHaveLength(2);
  });

  it('filtra por rango de fechas sobre occurredAt', async () => {
    const { t, w } = await conHistoria();
    const page = await t.history.execute(
      w.ctx, { from: new Date('2026-09-11T00:00:00.000Z') }, SORT,
    );
    expect(page.data).toHaveLength(1);
  });

  it('filtra por actor y por producto', async () => {
    const { t, w } = await conHistoria();
    expect((await t.history.execute(w.ctx, { actorId: w.ctx.userId }, SORT)).data).toHaveLength(2);
    expect((await t.history.execute(w.ctx, { productId: w.tornillo.id as ProductId }, SORT)).data)
      .toHaveLength(2);
  });

  it('el VIEWER puede mirar', async () => {
    const { t } = await conHistoria();
    await expect(t.history.execute(aContext([Role.VIEWER]), {}, SORT)).resolves.toBeDefined();
  });
});

describe('GetMovementById', () => {
  it('devuelve el asiento, con sus dos relojes', async () => {
    const t = build();
    const w = await aWarehouse(t);
    const { movement } = await move(t, w, { occurredAt: new Date('2026-09-10T09:00:00.000Z') });
    const found = await t.byId.execute(w.ctx, movement.id);
    expect(found.recordedAt.getTime()).toBeGreaterThanOrEqual(found.occurredAt.getTime());
  });

  it('uno que no existe, o de otra organización, es 404', async () => {
    const t = build();
    const w = await aWarehouse(t);
    await move(t, w);
    await expect(
      t.byId.execute(w.ctx, '018f0000-0000-7000-8000-0000000000ee' as MovementId),
    ).rejects.toMatchObject({ type: 'not-found' });
  });
});

describe('GetOpenCustodies', () => {
  const dueAt = (iso: string) => new Date(iso);

  const prestado = async () => {
    const t = build();
    const w = await aWarehouse(t);
    await move(t, w, { quantity: '100' });
    const { movement: vigente } = await move(t, w, {
      fromNodeId: w.b2.id, toNodeId: w.juan.id, quantity: '5',
      dueAt: dueAt('2026-09-19T12:00:00.000Z'),
    });
    const { movement: vencido } = await move(t, w, {
      fromNodeId: w.b2.id, toNodeId: w.juan.id, quantity: '2',
      dueAt: dueAt('2026-09-11T12:00:00.000Z'),
    });
    return { t, w, vigente, vencido };
  };

  it('una fila por préstamo, con su pendiente', async () => {
    const { t, w, vigente } = await prestado();
    const page = await t.custodies.execute(w.ctx, {}, SORT);
    const fila = page.data.find((c) => c.checkOut.id === vigente.id);
    expect(fila?.pending.toString()).toBe('5.000');
    expect(fila?.overdue).toBe(false);
  });

  it('descuenta la devolución parcial', async () => {
    const { t, w, vigente } = await prestado();
    await move(t, w, {
      fromNodeId: w.juan.id, toNodeId: w.b2.id, quantity: '2', settlesId: vigente.id,
    });
    const page = await t.custodies.execute(w.ctx, {}, SORT);
    expect(page.data.find((c) => c.checkOut.id === vigente.id)?.pending.toString()).toBe('3.000');
  });

  it('el préstamo devuelto entero desaparece de la lista', async () => {
    const { t, w, vigente } = await prestado();
    await move(t, w, {
      fromNodeId: w.juan.id, toNodeId: w.b2.id, quantity: '5', settlesId: vigente.id,
    });
    const page = await t.custodies.execute(w.ctx, {}, SORT);
    expect(page.data.map((c) => c.checkOut.id)).not.toContain(vigente.id);
  });

  // The clock is the use case's, not the repository's: overdue is a question
  // about now, and infrastructure has no business knowing what now is.
  it('overdueOnly deja solo el vencido, y lo marca', async () => {
    const { t, w, vencido } = await prestado();
    const page = await t.custodies.execute(w.ctx, { overdueOnly: true }, SORT);
    expect(page.data).toHaveLength(1);
    expect(page.data[0]?.checkOut.id).toBe(vencido.id);
    expect(page.data[0]?.overdue).toBe(true);
  });

  it('filtra por nodo de custodia', async () => {
    const { t, w } = await prestado();
    expect((await t.custodies.execute(w.ctx, { nodeId: w.juan.id }, SORT)).data).toHaveLength(2);
    expect((await t.custodies.execute(w.ctx, { nodeId: w.b2.id }, SORT)).data).toHaveLength(0);
  });

  it('el VIEWER puede mirar', async () => {
    const { t } = await prestado();
    await expect(t.custodies.execute(aContext([Role.VIEWER]), {}, SORT)).resolves.toBeDefined();
  });
});
