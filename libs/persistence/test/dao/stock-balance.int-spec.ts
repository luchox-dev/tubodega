// El único lector de saldos que existe hoy, y lo que C-9 necesita de él: dónde
// hay existencias de un producto, y qué no cuenta como existencia. El filtro
// por clase de nodo no lo impone ningún constraint —la frontera del sistema
// tiene saldo, y es legítimo—, así que solo esta prueba lo sostiene.
import { v7 } from 'uuid';
import { StockBalanceDao } from '@app/persistence';
import { createPersistenceHarness } from '../../../../test/support/db.js';
import { rawBalance, seedWorld, type World } from '../support/raw-rows.js';

describe('StockBalanceDao · dónde hay existencias', () => {
  let h: Awaited<ReturnType<typeof createPersistenceHarness>>;
  let dao: StockBalanceDao;
  let w: World;

  beforeAll(async () => {
    h = await createPersistenceHarness();
    dao = h.get(StockBalanceDao);
    w = await seedWorld(h.uow, h.ctx, 'balances');
  });
  afterAll(() => h.close());

  /** Un producto nuevo por caso: los saldos se acumulan y no se limpian. */
  const freshProduct = async (): Promise<string> => {
    const id = v7();
    await h.uow.runAs({ pool: 'system' }, () =>
      h.ctx
        .current()
        .insertInto('product')
        .values({
          id,
          orgId: w.orgId,
          sku: `BAL-${id.slice(-12)}`,
          name: 'Con saldo',
          trackingMode: 'QUANTITY',
          uom: 'UNIT',
        })
        .execute(),
    );
    return id;
  };

  const place = (productId: string, over: Parameters<typeof rawBalance>[1]) =>
    h.uow.runAs({ pool: 'system' }, () =>
      h.ctx
        .current()
        .insertInto('stockBalance')
        .values(rawBalance(w, { productId, ...over }))
        .execute(),
    );

  const positions = (productId: string) =>
    h.uow.runAs({ pool: 'tenant', orgId: w.orgId }, () => dao.positionsOfProduct(w.orgId, productId));

  it('nombra los lugares, no los uuid: es lo que hace accionable a product-has-stock', async () => {
    const productId = await freshProduct();
    await place(productId, { nodeId: w.binNodeId, nodeKind: 'INTERNAL', quantity: '4.000' });
    await place(productId, { nodeId: w.custodyNodeId, nodeKind: 'CUSTODY', quantity: '2.000' });

    const found = await positions(productId);
    expect(found).toEqual([
      { nodeId: w.binNodeId, path: expect.stringMatching(/^BIN-/), quantity: '4.000' },
      { nodeId: w.custodyNodeId, path: expect.stringMatching(/^CUS-/), quantity: '2.000' },
    ]);
  });

  it('un saldo en la frontera del sistema no es existencia: SOURCE y TERMINAL no cuentan', async () => {
    const productId = await freshProduct();
    await place(productId, { nodeId: w.sourceNodeId, nodeKind: 'SOURCE', quantity: '-9.000' });
    await place(productId, { nodeId: w.terminalNodeId, nodeKind: 'TERMINAL', quantity: '7.000' });

    // El proveedor lleva un acumulado de lo que entregó y la venta de lo que
    // salió; ninguno de los dos es stock en un estante, así que retirar este
    // producto del catálogo no debería toparse con C-9.
    expect(await positions(productId)).toEqual([]);
  });

  it('y un saldo de cero tampoco: la fila queda, la existencia no', async () => {
    const productId = await freshProduct();
    await place(productId, { nodeId: w.binNodeId, nodeKind: 'INTERNAL', quantity: '0.000' });

    expect(await positions(productId)).toEqual([]);
  });
});
