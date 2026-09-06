import { v7 } from 'uuid';
import type { OrgId } from '@app/common';
import {
  OrganizationDao,
  RecordNotFoundError,
  UniqueViolationError,
  UserDao,
  VersionConflictError,
} from '@app/persistence';
import { createPersistenceHarness, withRollback } from '../../../../test/support/db.js';

describe('AbstractOrgDao (through UserDao, against app_user)', () => {
  let h: Awaited<ReturnType<typeof createPersistenceHarness>>;
  let users: UserDao;
  let orgs: OrganizationDao;
  beforeAll(async () => {
    h = await createPersistenceHarness();
    users = h.get(UserDao);
    orgs = h.get(OrganizationDao);
  });
  afterAll(() => h.close());

  const inTx = <T>(fn: (orgId: OrgId) => Promise<T>) =>
    withRollback(h.uow, { pool: 'system' }, async () => {
      const org = await orgs.insert({ id: v7(), name: 'Acme', slug: `acme-${v7().slice(-12)}` });
      return fn(org.id as OrgId);
    });

  const newUser = (orgId: OrgId, email: string) => ({
    id: v7(),
    orgId,
    email,
    passwordHash: 'h',
    name: 'Someone',
  });

  it('create + findUnique + findFirst', async () => {
    await inTx(async (orgId) => {
      const created = await users.create(newUser(orgId, 'a@x.co'));
      expect(created.version).toBe(1);
      expect(await users.findUnique(orgId, created.id)).toMatchObject({ email: 'a@x.co' });
      expect(await users.findFirst(orgId, { email: 'a@x.co' })).toMatchObject({ id: created.id });
      expect(await users.findFirst(orgId, { email: 'nobody@x.co' })).toBeNull();
      expect(await users.findMany(orgId, { active: true })).toHaveLength(1);
    });
  });

  it('the org filter applies even when the role could see everything', async () => {
    await inTx(async (orgId) => {
      const created = await users.create(newUser(orgId, 'a@x.co'));
      expect(await users.findUnique(v7() as OrgId, created.id)).toBeNull();
    });
  });

  it('update with the right version bumps version and updated_at', async () => {
    await inTx(async (orgId) => {
      const created = await users.create(newUser(orgId, 'a@x.co'));
      const updated = await users.update(orgId, created.id, { name: 'Renamed' }, { expectedVersion: 1 });
      expect(updated.name).toBe('Renamed');
      expect(updated.version).toBe(2);
      expect(updated.updatedAt.getTime()).toBeGreaterThanOrEqual(created.updatedAt.getTime());
    });
  });

  it('update with a stale version → VersionConflictError; missing id → RecordNotFoundError', async () => {
    await inTx(async (orgId) => {
      const created = await users.create(newUser(orgId, 'a@x.co'));
      await expect(users.update(orgId, created.id, { name: 'x' }, { expectedVersion: 99 })).rejects.toBeInstanceOf(
        VersionConflictError,
      );
      await expect(users.update(orgId, v7(), { name: 'x' }, { expectedVersion: 1 })).rejects.toBeInstanceOf(
        RecordNotFoundError,
      );
    });
  });

  it('duplicate email in the same org → UniqueViolationError with the constraint name (T-1)', async () => {
    await inTx(async (orgId) => {
      await users.create(newUser(orgId, 'dup@x.co'));
      // A failed INSERT aborts the transaction; a SAVEPOINT (nested run) keeps it usable.
      const e = await h.uow.run(() => users.create(newUser(orgId, 'DUP@x.co'))).catch((err) => err);
      expect(e).toBeInstanceOf(UniqueViolationError);
      expect(e).toMatchObject({ constraint: 'app_user_org_id_email_key' });
      expect(await users.findMany(orgId)).toHaveLength(1);
    });
  });

  it('a DAO outside a transaction throws NoActiveTransactionError', async () => {
    await expect(users.findUnique(v7() as OrgId, v7())).rejects.toMatchObject({ name: 'NoActiveTransactionError' });
  });
});
