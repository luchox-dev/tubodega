import { v7 } from 'uuid';
import { createPersistenceHarness } from '../../../../test/support/db.js';
import { rawMovement, seedWorld, type World } from '../support/raw-rows.js';

/**
 * The two uniques that are partial on purpose. Total ones would be wrong:
 * I-13 must let many movements have no compensation at all, and A-1 must let a
 * resolved alert rise again — with a total index, `ON CONFLICT DO NOTHING`
 * would swallow the second one in silence (spec 04 §3.7).
 */
describe('partial unique indexes', () => {
  let h: Awaited<ReturnType<typeof createPersistenceHarness>>;
  let w: World;

  beforeAll(async () => {
    h = await createPersistenceHarness();
    w = await seedWorld(h.uow, h.ctx, 'partial');
  });
  afterAll(() => h.close());

  const insert = (values: Parameters<typeof rawMovement>[1]) =>
    h.uow.runAs({ pool: 'system' }, () =>
      h.ctx.current().insertInto('movement').values(rawMovement(w, values)).execute(),
    );

  it('I-13 · a movement is compensated once, and only once', async () => {
    const original = rawMovement(w);
    await h.uow.runAs({ pool: 'system' }, () =>
      h.ctx.current().insertInto('movement').values(original).execute(),
    );
    const reversal = { reversesId: original.id as string, fromNodeId: w.binNodeId, fromNodeKind: 'INTERNAL', toNodeId: w.sourceNodeId, toNodeKind: 'SOURCE' } as const;

    await expect(insert({ ...reversal })).resolves.toBeDefined();
    await expect(insert({ ...reversal })).rejects.toMatchObject({
      code: '23505',
      constraint: 'movement_org_id_reverses_id_key',
    });
  });

  it('I-13 · but many movements may have no compensation', async () => {
    await expect(insert({})).resolves.toBeDefined();
    await expect(insert({})).resolves.toBeDefined();
  });

  const alert = (over: Record<string, unknown> = {}) =>
    h.uow.runAs({ pool: 'system' }, () =>
      h.ctx
        .current()
        .insertInto('alert')
        .values({
          id: v7(),
          orgId: w.orgId,
          kind: 'BATCH_EXPIRED',
          subjectType: 'BATCH',
          subjectId: w.batchId,
          dueAt: new Date(),
          ...over,
        } as never)
        .execute(),
    );

  it('A-1 · the same subject cannot have two open alerts', async () => {
    await expect(alert()).resolves.toBeDefined();
    await expect(alert()).rejects.toMatchObject({
      code: '23505',
      constraint: 'alert_org_id_kind_subject_type_subject_id_key',
    });
  });

  it('A-1 · a resolved one and an open one live together, so it can rise again', async () => {
    const subjectId = v7();
    await expect(alert({ subjectId, resolvedAt: new Date() })).resolves.toBeDefined();
    await expect(alert({ subjectId })).resolves.toBeDefined();
    await expect(alert({ subjectId, resolvedAt: new Date() })).resolves.toBeDefined();
  });
});
