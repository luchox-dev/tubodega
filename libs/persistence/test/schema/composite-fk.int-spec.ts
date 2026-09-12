import { createPersistenceHarness } from '../../../../test/support/db.js';
import { rawMovement, seedWorld, type World } from '../support/raw-rows.js';

/**
 * Why every foreign key in this schema is composite (spec 04 §2). Postgres does
 * not apply RLS when it validates a foreign key, so with a plain
 * `REFERENCES product(id)` one organization could point a movement at another
 * organization's product and the policy would never see it. The test runs on
 * the system pool precisely so RLS is out of the way and only the key answers.
 */
describe('composite foreign keys', () => {
  let h: Awaited<ReturnType<typeof createPersistenceHarness>>;
  let a: World;
  let b: World;

  beforeAll(async () => {
    h = await createPersistenceHarness();
    a = await seedWorld(h.uow, h.ctx, 'fk-a');
    b = await seedWorld(h.uow, h.ctx, 'fk-b');
  });
  afterAll(() => h.close());

  it("a movement of A cannot reference B's product", async () => {
    await expect(
      h.uow.runAs({ pool: 'system' }, () =>
        h.ctx.current().insertInto('movement').values(rawMovement(a, { productId: b.productId })).execute(),
      ),
    ).rejects.toMatchObject({ code: '23503', constraint: 'movement_org_id_product_id_fkey' });
  });

  it("nor B's node", async () => {
    await expect(
      h.uow.runAs({ pool: 'system' }, () =>
        h.ctx.current().insertInto('movement').values(rawMovement(a, { toNodeId: b.binNodeId })).execute(),
      ),
    ).rejects.toMatchObject({ code: '23503', constraint: 'movement_org_id_to_node_id_fkey' });
  });

  it("nor B's user as the actor", async () => {
    await expect(
      h.uow.runAs({ pool: 'system' }, () =>
        h.ctx.current().insertInto('movement').values(rawMovement(a, { actorId: b.userId })).execute(),
      ),
    ).rejects.toMatchObject({ code: '23503', constraint: 'movement_org_id_actor_id_fkey' });
  });
});
