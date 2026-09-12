import { sql } from 'kysely';
import { v7 } from 'uuid';
import { createPersistenceHarness } from '../../../../test/support/db.js';
import { seedEveryTable, seedWorld, type World } from '../support/raw-rows.js';

/**
 * I-6 with the repository filter deliberately bypassed: raw selects through the
 * tenant pool must return only the current organization's rows, and an insert
 * for another organization must be rejected (spec 04 §4, 06 §5). Every one of
 * the 19 tables that carries org_id is covered — `organization` is the only
 * business table without one, and without RLS, on purpose (spec 10 §6).
 *
 * This is the test that proves the second layer exists. The first layer is the
 * repository adding `org_id = :currentOrg`, and a repository is a promise; a
 * policy is a guarantee.
 */
describe('Row Level Security', () => {
  let h: Awaited<ReturnType<typeof createPersistenceHarness>>;
  let a: World;
  let b: World;

  beforeAll(async () => {
    h = await createPersistenceHarness();
    a = await seedWorld(h.uow, h.ctx, 'rls-a');
    b = await seedWorld(h.uow, h.ctx, 'rls-b');
    await seedEveryTable(h.uow, h.ctx, a);
    await seedEveryTable(h.uow, h.ctx, b);
  }, 60_000);
  afterAll(() => h.close());

  /** The 19 tables with org_id, as of the full_schema migration. */
  const TABLES = [
    'appUser',
    'userRole',
    'refreshToken',
    'outboxEvent',
    'idempotencyKey',
    'product',
    'productCode',
    'productMedia',
    'mediaUpload',
    'batch',
    'customFieldDefinition',
    'node',
    'movement',
    'stockBalance',
    'processTemplate',
    'processInstance',
    'stepCompletion',
    'alert',
    'alertRule',
  ] as const;

  it('covers every table that has an org_id column', async () => {
    const { rows } = await sql<{ tablename: string }>`
      select c.relname as tablename
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      join pg_attribute att on att.attrelid = c.oid and att.attname = 'org_id' and att.attnum > 0
      where n.nspname = 'public' and c.relkind = 'r'
    `.execute(h.factory.get('system'));

    const camel = (t: string) => t.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
    expect(new Set(rows.map((r) => camel(r.tablename)))).toEqual(new Set(TABLES));
  });

  it.each(TABLES)('%s: a tenant transaction for B sees only B, even without a WHERE', async (table) => {
    const rows = await h.uow.runAs({ pool: 'tenant', orgId: b.orgId }, () =>
      h.ctx.current().selectFrom(table).select('orgId').execute(),
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.orgId === b.orgId)).toBe(true);
  });

  it.each(TABLES)('%s: the system pool sees both organizations', async (table) => {
    const rows = await h.uow.runAs({ pool: 'system' }, () =>
      h.ctx
        .current()
        .selectFrom(table)
        .select('orgId')
        .where('orgId', 'in', [a.orgId, b.orgId])
        .execute(),
    );
    expect(new Set(rows.map((r) => r.orgId))).toEqual(new Set([a.orgId, b.orgId]));
  });

  it('a tenant transaction for B cannot insert a row for A (WITH CHECK)', async () => {
    await expect(
      h.uow.runAs({ pool: 'tenant', orgId: b.orgId }, () =>
        h.ctx
          .current()
          .insertInto('outboxEvent')
          .values({ id: v7(), orgId: a.orgId, type: 'probe', payload: '{}', traceId: v7() })
          .execute(),
      ),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('nor can it reach into A by primary key on a catalogue table', async () => {
    const rows = await h.uow.runAs({ pool: 'tenant', orgId: b.orgId }, () =>
      h.ctx.current().selectFrom('product').select('id').where('id', '=', a.productId).execute(),
    );
    expect(rows).toEqual([]);
  });

  it('the tenant pool without app.current_org cannot read at all', async () => {
    const db = h.factory.get('tenant');
    // 42704 (unrecognized parameter) on a fresh connection; 22P02 (''::uuid) once a
    // pooled connection has seen a SET LOCAL. Either way, RLS denies the read.
    await expect(sql`select count(*) from product`.execute(db)).rejects.toMatchObject({
      code: expect.stringMatching(/^(42704|22P02)$/),
    });
  });
});
