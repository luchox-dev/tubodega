// The generic DAO is proved once, against a real table (spec 08 §8). Every
// concretion inherits it already tested and only proves its own methods.
import { v7 } from 'uuid';
import type { OrgId } from '@app/common';
import {
  KyselyUnitOfWork,
  NoActiveTransactionError,
  OrganizationDao,
  RecordNotFoundError,
  UniqueViolationError,
  UserDao,
  VersionConflictError,
} from '@app/persistence';
import { createPersistenceHarness, withRollback } from '../../../../test/support/db.js';

describe('the generic DAO against app_user', () => {
  let h: Awaited<ReturnType<typeof createPersistenceHarness>>;
  let users: UserDao;
  let orgs: OrganizationDao;
  let uow: KyselyUnitOfWork;

  beforeAll(async () => {
    h = await createPersistenceHarness();
    users = h.get(UserDao);
    orgs = h.get(OrganizationDao);
    uow = h.uow;
  });
  afterAll(() => h.close());

  const newOrg = async (): Promise<OrgId> => {
    const id = v7() as OrgId;
    await orgs.create({ id, name: 'Acme', slug: `acme-${id.slice(-12)}` });
    return id;
  };
  const row = (orgId: OrgId, over: Partial<{ name: string; email: string }> = {}) => ({
    id: v7(),
    orgId,
    email: over.email ?? `${v7()}@x.co`,
    passwordHash: 'h',
    name: over.name ?? 'Someone',
  });

  const inOrg = (fn: (orgId: OrgId) => Promise<void>) =>
    withRollback(uow, { pool: 'system' }, async () => fn(await newOrg()));

  it('create, findUnique, findUniqueOrThrow and select', () =>
    inOrg(async (orgId) => {
      const created = await users.create(row(orgId, { name: 'Marta' }));
      expect(await users.findUnique(orgId, created.id)).toMatchObject({ name: 'Marta', version: 1 });
      expect(await users.findUniqueOrThrow(orgId, created.id)).toMatchObject({ id: created.id });
      expect(await users.findUnique(orgId, created.id, { select: ['id', 'name'] })).toEqual({
        id: created.id,
        name: 'Marta',
      });
      await expect(users.findUniqueOrThrow(orgId, v7())).rejects.toBeInstanceOf(RecordNotFoundError);
      expect(await users.findUnique(orgId, v7())).toBeNull();
    }));

  it('createMany returns the rows, findManyByIds fetches them back', () =>
    inOrg(async (orgId) => {
      const made = await users.createMany([row(orgId), row(orgId), row(orgId)]);
      expect(made).toHaveLength(3);
      const back = await users.findManyByIds(orgId, [made[0]!.id, made[2]!.id]);
      expect(back.map((r) => r.id).sort()).toEqual([made[0]!.id, made[2]!.id].sort());
      expect(await users.findManyByIds(orgId, [])).toEqual([]);
    }));

  it('findMany with the DSL, count and exists', () =>
    inOrg(async (orgId) => {
      await users.createMany([
        row(orgId, { name: 'Ana' }),
        row(orgId, { name: 'Beto' }),
        row(orgId, { name: 'Carla' }),
      ]);
      const desc = await users.findMany(orgId, { orderBy: { name: 'desc' } });
      expect(desc.map((r) => r.name)).toEqual(['Carla', 'Beto', 'Ana']);
      expect(await users.count(orgId)).toBe(3);
      expect(await users.count(orgId, { name: { startsWith: 'B' } })).toBe(1);
      expect(await users.exists(orgId, { name: 'Ana' })).toBe(true);
      expect(await users.exists(orgId, { name: 'Zoe' })).toBe(false);
      expect(await users.findFirst(orgId, { where: { name: 'Beto' } })).toMatchObject({ name: 'Beto' });
      expect(await users.findMany(orgId, { where: { name: { in: [] } } })).toEqual([]);
    }));

  it('escapes the LIKE wildcards of the value', () =>
    inOrg(async (orgId) => {
      await users.createMany([row(orgId, { name: '50%_off' }), row(orgId, { name: '50xyoff' })]);
      const found = await users.findMany(orgId, { where: { name: { contains: '50%_' } } });
      expect(found.map((r) => r.name)).toEqual(['50%_off']);
    }));

  it('update bumps version, honours expectedVersion and tells the two failures apart', () =>
    inOrg(async (orgId) => {
      const u = await users.create(row(orgId));
      const v2 = await users.update(orgId, u.id, { name: 'Nuevo' }, { expectedVersion: 1 });
      expect(v2).toMatchObject({ name: 'Nuevo', version: 2 });
      expect(v2.updatedAt.getTime()).toBeGreaterThanOrEqual(u.updatedAt.getTime());
      await expect(users.update(orgId, u.id, { name: 'x' }, { expectedVersion: 1 })).rejects.toBeInstanceOf(
        VersionConflictError,
      );
      await expect(users.update(orgId, v7(), { name: 'x' })).rejects.toBeInstanceOf(RecordNotFoundError);
      expect(await users.updateMany(orgId, { name: 'Nuevo' }, { name: 'Otro' })).toBe(1);
    }));

  it('upsert creates and then updates, over the real primary key', () =>
    inOrg(async (orgId) => {
      const r = row(orgId, { name: 'Primera' });
      expect(await users.upsert(orgId, r.id, r, { name: 'Primera' })).toMatchObject({ name: 'Primera' });
      expect(await users.upsert(orgId, r.id, r, { name: 'Segunda' })).toMatchObject({ name: 'Segunda' });
      expect(await users.count(orgId)).toBe(1);
    }));

  it('delete returns the deleted row; deleteMany counts', () =>
    inOrg(async (orgId) => {
      const [a, b] = await users.createMany([row(orgId, { name: 'A' }), row(orgId, { name: 'B' })]);
      expect(await users.delete(orgId, a!.id)).toMatchObject({ name: 'A' });
      await expect(users.delete(orgId, a!.id)).rejects.toBeInstanceOf(RecordNotFoundError);
      expect(await users.deleteMany(orgId, { id: b!.id })).toBe(1);
      expect(await users.count(orgId)).toBe(0);
    }));

  it('23505 becomes UniqueViolationError carrying the constraint name', () =>
    inOrg(async (orgId) => {
      await users.create(row(orgId, { email: 'dup@x.co' }));
      // The failed INSERT aborts the transaction, so it goes inside a savepoint.
      await expect(uow.run(() => users.create(row(orgId, { email: 'dup@x.co' })))).rejects.toMatchObject({
        constraint: 'app_user_org_id_email_key',
      });
      await expect(
        uow.run(() => users.create(row(orgId, { email: 'dup@x.co' }))),
      ).rejects.toBeInstanceOf(UniqueViolationError);
    }));

  it('findPage walks three pages with inserts in between, skipping and repeating nothing', () =>
    inOrg(async (orgId) => {
      const names = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l'];
      await users.createMany(names.map((name) => row(orgId, { name })));

      const seen: string[] = [];
      let page = await users.findPage(orgId, { take: 5, orderBy: { name: 'asc' } });
      seen.push(...page.data.map((r) => r.name));
      expect(page.hasMore).toBe(true);

      // Rows appear mid-walk: one behind the cursor, one ahead of it.
      await users.createMany([row(orgId, { name: 'aa' }), row(orgId, { name: 'zz' })]);

      page = await users.findPage(orgId, { take: 5, orderBy: { name: 'asc' }, cursor: page.nextCursor });
      seen.push(...page.data.map((r) => r.name));
      page = await users.findPage(orgId, { take: 5, orderBy: { name: 'asc' }, cursor: page.nextCursor });
      seen.push(...page.data.map((r) => r.name));

      expect(new Set(seen).size).toBe(seen.length); // nothing repeated
      expect(names.every((n) => seen.includes(n))).toBe(true); // nothing skipped
      expect(seen).toContain('zz'); // a row inserted ahead of the cursor is seen
      expect(seen).not.toContain('aa'); // one inserted behind it is not — that is keyset
      expect(page.hasMore).toBe(false);
      expect(page.nextCursor).toBeUndefined();
    }));

  it('a DAO outside run() throws NoActiveTransactionError', async () => {
    await expect(users.findUnique('x' as OrgId, 'y')).rejects.toBeInstanceOf(NoActiveTransactionError);
  });
});
