import { sql } from 'kysely';
import type { OrgId } from '@app/common';
import { NoActiveTransactionError } from '@app/persistence';
import { createPersistenceHarness, withRollback } from '../../../../test/support/db.js';

const ORG = '018f3a2b-7c4d-7000-8000-a1b2c3d4e5f6' as OrgId;

describe('KyselyUnitOfWork', () => {
  let h: Awaited<ReturnType<typeof createPersistenceHarness>>;
  beforeAll(async () => {
    h = await createPersistenceHarness();
  });
  afterAll(() => h.close());

  it('run() outside a transaction throws NoActiveTransactionError', async () => {
    await expect(h.uow.run(async () => 1)).rejects.toBeInstanceOf(NoActiveTransactionError);
  });

  it('runAs(tenant) sets app.current_org inside the transaction (T-5)', async () => {
    const v = await withRollback(h.uow, { pool: 'tenant', orgId: ORG }, async () => {
      const r = await sql<{ v: string }>`select current_setting('app.current_org') as v`.execute(h.ctx.current());
      return r.rows[0]!.v;
    });
    expect(v).toBe(ORG);
  });

  it('runAs(system) without orgId leaves app.current_org unset', async () => {
    const v = await withRollback(h.uow, { pool: 'system' }, async () => {
      const r = await sql<{ v: string | null }>`select current_setting('app.current_org', true) as v`.execute(h.ctx.current());
      return r.rows[0]!.v;
    });
    expect(v === null || v === '').toBe(true);
  });

  it('nested run() is a SAVEPOINT: its failure does not abort the outer transaction', async () => {
    await withRollback(h.uow, { pool: 'system' }, async () => {
      await expect(
        h.uow.run(async () => {
          await sql`select 1/0`.execute(h.ctx.current());
        }),
      ).rejects.toMatchObject({ code: '22012' });
      const r = await sql<{ one: number }>`select 1 as one`.execute(h.ctx.current());
      expect(r.rows[0]!.one).toBe(1);
    });
  });

  it('nested run() keeps its work when it succeeds', async () => {
    const seen = await withRollback(h.uow, { pool: 'system' }, async () => {
      await h.uow.run(async () => {
        await sql`create temporary table t_uow (x int) on commit drop`.execute(h.ctx.current());
        await sql`insert into t_uow values (1)`.execute(h.ctx.current());
      });
      const r = await sql<{ n: string }>`select count(*)::text as n from t_uow`.execute(h.ctx.current());
      return r.rows[0]!.n;
    });
    expect(seen).toBe('1');
  });

  it('readOnly transactions reject writes', async () => {
    await expect(
      h.uow.runAs(
        { pool: 'system' },
        async () => {
          await sql`insert into outbox_event (id, org_id, type, payload, trace_id)
                    values (gen_random_uuid(), ${ORG}, 'probe', '{}', gen_random_uuid())`.execute(h.ctx.current());
        },
        { readOnly: true },
      ),
    ).rejects.toMatchObject({ code: '25006' });
  });

  it('runDetached does not see uncommitted rows of the ambient transaction', async () => {
    const outside = await withRollback(h.uow, { pool: 'system' }, async () => {
      await sql`insert into organization (id, name, slug) values (${ORG}, 'x', 'uow-detached-probe')`.execute(h.ctx.current());
      return h.uow.runDetached({ orgId: ORG }, async () => {
        const r = await sql<{ n: string }>`select count(*)::text as n from organization where slug = 'uow-detached-probe'`.execute(h.ctx.current());
        return r.rows[0]!.n;
      });
    });
    expect(outside).toBe('0');
  });
});
