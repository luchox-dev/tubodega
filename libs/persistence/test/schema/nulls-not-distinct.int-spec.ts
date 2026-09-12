import { sql } from 'kysely';
import { v7 } from 'uuid';
import { createPersistenceHarness } from '../../../../test/support/db.js';
import { seedWorld, type World } from '../support/raw-rows.js';

/**
 * The natural key of a balance includes batch_id, which is NULL for QUANTITY
 * products — the most common kind in any catalogue. By default two NULLs do
 * not collide in a unique index, so without NULLS NOT DISTINCT the upsert of
 * spec 04 §3.5 would insert a second row instead of adding to the first, and
 * the stock of exactly those products would silently split in two.
 */
describe('NULLS NOT DISTINCT on the natural key of stock_balance', () => {
  let h: Awaited<ReturnType<typeof createPersistenceHarness>>;
  let w: World;

  beforeAll(async () => {
    h = await createPersistenceHarness();
    w = await seedWorld(h.uow, h.ctx, 'nnd');
  });
  afterAll(() => h.close());

  it('two upserts with batch_id NULL leave one row, with the quantities added', async () => {
    const upsert = (quantity: string) =>
      h.uow.runAs({ pool: 'system' }, () =>
        h.ctx
          .current()
          .insertInto('stockBalance')
          .values({
            id: v7(),
            orgId: w.orgId,
            nodeId: w.binNodeId,
            productId: w.productId,
            batchId: null,
            nodeKind: 'INTERNAL',
            quantity,
          })
          .onConflict((oc) =>
            oc.columns(['orgId', 'nodeId', 'productId', 'batchId']).doUpdateSet({
              quantity: sql`stock_balance.quantity + excluded.quantity`,
              updatedAt: sql`now()`,
            }),
          )
          .execute(),
      );

    await upsert('3.000');
    await upsert('4.000');

    const rows = await h.uow.runAs({ pool: 'tenant', orgId: w.orgId }, () =>
      h.ctx
        .current()
        .selectFrom('stockBalance')
        .select(['quantity'])
        .where('nodeId', '=', w.binNodeId)
        .where('productId', '=', w.productId)
        .execute(),
    );

    expect(rows).toHaveLength(1);
    expect(Number(rows[0]!.quantity)).toBe(7);
  });
});
