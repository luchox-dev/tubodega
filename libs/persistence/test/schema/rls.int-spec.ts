import { sql } from 'kysely';
import { v7 } from 'uuid';
import type { OrgId } from '@app/common';
import { createPersistenceHarness } from '../../../../test/support/db.js';

/**
 * I-6 with the repository filter deliberately bypassed: raw selects through
 * the tenant pool must return only the current organization's rows, and an
 * insert for another organization must be rejected (spec 04 §4, 06 §5).
 * Rows are committed for real (two organizations) and removed afterwards
 * with the system pool.
 */
describe('Row Level Security (tenancy tables)', () => {
  let h: Awaited<ReturnType<typeof createPersistenceHarness>>;
  const orgA = v7() as OrgId;
  const orgB = v7() as OrgId;
  const userA = v7();
  const userB = v7();

  beforeAll(async () => {
    h = await createPersistenceHarness();
    await h.uow.runAs({ pool: 'system' }, async () => {
      const db = h.ctx.current();
      await db
        .insertInto('organization')
        .values([
          { id: orgA, name: 'A', slug: `rls-a-${orgA.slice(-8)}` },
          { id: orgB, name: 'B', slug: `rls-b-${orgB.slice(-8)}` },
        ])
        .execute();
      await db
        .insertInto('appUser')
        .values([
          { id: userA, orgId: orgA, email: 'a@rls.test', passwordHash: 'h', name: 'A' },
          { id: userB, orgId: orgB, email: 'b@rls.test', passwordHash: 'h', name: 'B' },
        ])
        .execute();
      await db
        .insertInto('userRole')
        .values([
          { userId: userA, orgId: orgA, role: 'OWNER' },
          { userId: userB, orgId: orgB, role: 'OWNER' },
        ])
        .execute();
      await db
        .insertInto('refreshToken')
        .values([
          { id: v7(), orgId: orgA, userId: userA, tokenHash: `ha-${orgA.slice(-8)}`, expiresAt: new Date() },
          { id: v7(), orgId: orgB, userId: userB, tokenHash: `hb-${orgB.slice(-8)}`, expiresAt: new Date() },
        ])
        .execute();
      await db
        .insertInto('outboxEvent')
        .values([
          { id: v7(), orgId: orgA, type: 'probe', payload: '{}', traceId: v7() },
          { id: v7(), orgId: orgB, type: 'probe', payload: '{}', traceId: v7() },
        ])
        .execute();
    });
  });

  afterAll(async () => {
    await h.uow.runAs({ pool: 'system' }, async () => {
      const db = h.ctx.current();
      for (const t of ['outboxEvent', 'refreshToken', 'userRole', 'appUser'] as const) {
        await db.deleteFrom(t).where('orgId', 'in', [orgA, orgB]).execute();
      }
      await db.deleteFrom('organization').where('id', 'in', [orgA, orgB]).execute();
    });
    await h.close();
  });

  const TABLES = ['appUser', 'userRole', 'refreshToken', 'outboxEvent'] as const;

  it.each(TABLES)('%s: a tenant transaction for B sees only B, even without a WHERE', async (table) => {
    const rows = await h.uow.runAs({ pool: 'tenant', orgId: orgB }, () =>
      h.ctx.current().selectFrom(table).select('orgId').execute(),
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.orgId === orgB)).toBe(true);
  });

  it.each(TABLES)('%s: the system pool sees both organizations', async (table) => {
    const rows = await h.uow.runAs({ pool: 'system' }, () =>
      h.ctx.current().selectFrom(table).select('orgId').where('orgId', 'in', [orgA, orgB]).execute(),
    );
    expect(new Set(rows.map((r) => r.orgId))).toEqual(new Set([orgA, orgB]));
  });

  it('a tenant transaction for B cannot insert a row for A (WITH CHECK)', async () => {
    await expect(
      h.uow.runAs({ pool: 'tenant', orgId: orgB }, () =>
        h.ctx
          .current()
          .insertInto('outboxEvent')
          .values({ id: v7(), orgId: orgA, type: 'probe', payload: '{}', traceId: v7() })
          .execute(),
      ),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('the tenant pool without app.current_org cannot read at all', async () => {
    const db = h.factory.get('tenant');
    // 42704 (unrecognized parameter) on a fresh connection; 22P02 (''::uuid) once a
    // pooled connection has seen a SET LOCAL. Either way, RLS denies the read.
    await expect(sql`select count(*) from app_user`.execute(db)).rejects.toMatchObject({
      code: expect.stringMatching(/^(42704|22P02)$/),
    });
  });
});
