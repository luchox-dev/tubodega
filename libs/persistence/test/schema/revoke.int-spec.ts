import { sql } from 'kysely';
import { createPersistenceHarness } from '../../../../test/support/db.js';
import { rawMovement, seedWorld, type World } from '../support/raw-rows.js';

/**
 * I-3, third layer. The repository has no update method and the domain never
 * asks for one, but those are promises of the code. This is the one that turns
 * a programming mistake into a loud permission error instead of silent
 * corruption of history — and it holds for the system role too, because
 * immutability has no exception context (spec 04 §4).
 */
describe('REVOKE on movement', () => {
  let h: Awaited<ReturnType<typeof createPersistenceHarness>>;
  let w: World;

  beforeAll(async () => {
    h = await createPersistenceHarness();
    w = await seedWorld(h.uow, h.ctx, 'revoke');
    await h.uow.runAs({ pool: 'system' }, () =>
      h.ctx.current().insertInto('movement').values(rawMovement(w)).execute(),
    );
  });
  afterAll(() => h.close());

  it.each(['tenant', 'system'] as const)('%s: UPDATE movement is denied', async (pool) => {
    const scope = pool === 'tenant' ? ({ pool, orgId: w.orgId } as const) : ({ pool } as const);
    await expect(
      h.uow.runAs(scope, () => sql`update movement set quantity = 99`.execute(h.ctx.current())),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it.each(['tenant', 'system'] as const)('%s: DELETE FROM movement is denied', async (pool) => {
    const scope = pool === 'tenant' ? ({ pool, orgId: w.orgId } as const) : ({ pool } as const);
    await expect(
      h.uow.runAs(scope, () => sql`delete from movement`.execute(h.ctx.current())),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('INSERT and SELECT still work: the ledger is append-only, not read-only', async () => {
    const rows = await h.uow.runAs({ pool: 'tenant', orgId: w.orgId }, () =>
      h.ctx.current().selectFrom('movement').select('id').execute(),
    );
    expect(rows.length).toBeGreaterThan(0);
  });
});
