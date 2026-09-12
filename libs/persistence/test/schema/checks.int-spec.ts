import { v7 } from 'uuid';
import { createPersistenceHarness } from '../../../../test/support/db.js';
import { rawBalance, rawMovement, seedWorld, type World } from '../support/raw-rows.js';

/**
 * One test per CHECK of docs/specs/04 §3: each row is valid except for the one
 * field under test, and the error must name the constraint. A test that only
 * asserted "23514" would still pass if a different CHECK fired, which is
 * exactly the regression this suite exists to catch.
 */
describe('CHECK constraints', () => {
  let h: Awaited<ReturnType<typeof createPersistenceHarness>>;
  let w: World;

  beforeAll(async () => {
    h = await createPersistenceHarness();
    w = await seedWorld(h.uow, h.ctx, 'checks');
  });
  afterAll(() => h.close());

  const insertMovement = (over: Parameters<typeof rawMovement>[1]) =>
    h.uow.runAs({ pool: 'system' }, () =>
      h.ctx.current().insertInto('movement').values(rawMovement(w, over)).execute(),
    );

  it('I-1 · a movement cannot go from a node to itself', async () => {
    await expect(insertMovement({ toNodeId: w.sourceNodeId, toNodeKind: 'SOURCE' })).rejects.toMatchObject({
      code: '23514',
      constraint: 'movement_i1_distinct_nodes',
    });
  });

  it('I-2 · a movement of zero moves nothing', async () => {
    await expect(insertMovement({ quantity: '0.000' })).rejects.toMatchObject({
      code: '23514',
      constraint: 'movement_i2_positive_quantity',
    });
  });

  it('I-8 · a QUANTITY movement carries no batch', async () => {
    await expect(insertMovement({ batchId: w.batchId })).rejects.toMatchObject({
      code: '23514',
      constraint: 'movement_i8_batch_iff_tracked',
    });
  });

  it('I-8 · a LOT movement without a batch is the same violation', async () => {
    await expect(
      insertMovement({ productId: w.lotProductId, trackingMode: 'LOT', batchId: null }),
    ).rejects.toMatchObject({ code: '23514', constraint: 'movement_i8_batch_iff_tracked' });
  });

  it('I-11 · only a hand-over has a due date', async () => {
    await expect(insertMovement({ dueAt: new Date() })).rejects.toMatchObject({
      code: '23514',
      constraint: 'movement_i11_due_only_custody',
    });
  });

  it('I-14 · nothing is recorded as having happened in the future', async () => {
    await expect(insertMovement({ occurredAt: new Date(Date.now() + 3_600_000) })).rejects.toMatchObject({
      code: '23514',
      constraint: 'movement_i14_not_from_future',
    });
  });

  it('I-17 · stock leaves a custody only by settling or by compensation', async () => {
    await expect(
      insertMovement({ fromNodeId: w.custodyNodeId, fromNodeKind: 'CUSTODY' }),
    ).rejects.toMatchObject({ code: '23514', constraint: 'movement_i17_custody_exit' });
  });

  it('I-17 · and only what left a custody can settle', async () => {
    const base = rawMovement(w);
    await h.uow.runAs({ pool: 'system' }, () =>
      h.ctx.current().insertInto('movement').values(base).execute(),
    );
    await expect(insertMovement({ settlesId: base.id as string })).rejects.toMatchObject({
      code: '23514',
      constraint: 'movement_i17_settles_custody',
    });
  });

  it('I-4 · only the boundary of the system may go negative', async () => {
    await expect(
      h.uow.runAs({ pool: 'system' }, () =>
        h.ctx.current().insertInto('stockBalance').values(rawBalance(w, { quantity: '-1.000' })).execute(),
      ),
    ).rejects.toMatchObject({ code: '23514', constraint: 'stock_balance_i4_non_negative' });
  });

  it('I-4 · a TERMINAL node is allowed to', async () => {
    await expect(
      h.uow.runAs({ pool: 'system' }, () =>
        h.ctx
          .current()
          .insertInto('stockBalance')
          .values(rawBalance(w, { nodeId: w.terminalNodeId, nodeKind: 'TERMINAL', quantity: '-5.000' }))
          .execute(),
      ),
    ).resolves.toBeDefined();
  });

  it('I-10 · only an INTERNAL node hangs from a parent', async () => {
    await expect(
      h.uow.runAs({ pool: 'system' }, () =>
        h.ctx
          .current()
          .insertInto('node')
          .values({
            id: v7(),
            orgId: w.orgId,
            kind: 'CUSTODY',
            code: `BAD-${v7().slice(-8)}`,
            name: 'Juan bajo un bin',
            parentId: w.binNodeId,
            path: 'x/y',
          })
          .execute(),
      ),
    ).rejects.toMatchObject({ code: '23514', constraint: 'node_i10_parent_is_internal' });
  });

  it('C-3 · a batch is a lot or a serial, never neither', async () => {
    await expect(
      h.uow.runAs({ pool: 'system' }, () =>
        h.ctx
          .current()
          .insertInto('batch')
          .values({ id: v7(), orgId: w.orgId, productId: w.lotProductId, lotCode: null, serial: null })
          .execute(),
      ),
    ).rejects.toMatchObject({ code: '23514', constraint: 'batch_c3_lot_or_serial' });
  });

  it('an alert rule cannot warn a negative number of days ahead', async () => {
    await expect(
      h.uow.runAs({ pool: 'system' }, () =>
        h.ctx
          .current()
          .insertInto('alertRule')
          .values({ orgId: w.orgId, kind: 'CUSTODY_DUE', thresholdDays: -1 })
          .execute(),
      ),
    ).rejects.toMatchObject({ code: '23514', constraint: 'alert_rule_threshold_non_negative' });
  });
});
