// The Org family against a composite key (spec 08 §3, §8): `user_role` has key
// `{ userId, role }` and `org_id` always arrives as a parameter.
import { v7 } from 'uuid';
import type { OrgId } from '@app/common';
import { KyselyUnitOfWork, OrganizationDao, RecordNotFoundError, UserDao, UserRoleDao } from '@app/persistence';
import { createPersistenceHarness, withRollback } from '../../../../test/support/db.js';

describe('the Org family against user_role', () => {
  let h: Awaited<ReturnType<typeof createPersistenceHarness>>;
  let roles: UserRoleDao;
  let users: UserDao;
  let orgs: OrganizationDao;
  let uow: KyselyUnitOfWork;

  beforeAll(async () => {
    h = await createPersistenceHarness();
    roles = h.get(UserRoleDao);
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
  const newUser = async (orgId: OrgId): Promise<string> =>
    (await users.create({ id: v7(), orgId, email: `${v7()}@x.co`, passwordHash: 'h', name: 'Someone' })).id;

  it('findUnique, create, findManyByIds and delete over the composite key', () =>
    withRollback(uow, { pool: 'system' }, async () => {
      const orgId = await newOrg();
      const userId = await newUser(orgId);
      await roles.createMany([
        { orgId, userId, role: 'OWNER' },
        { orgId, userId, role: 'ADMIN' },
      ]);

      expect(await roles.findUnique(orgId, { userId, role: 'OWNER' })).toMatchObject({ role: 'OWNER' });
      expect(await roles.findUnique(orgId, { userId, role: 'VIEWER' })).toBeNull();
      expect(
        (await roles.findManyByIds(orgId, [
          { userId, role: 'OWNER' },
          { userId, role: 'VIEWER' },
        ])).map((r) => r.role),
      ).toEqual(['OWNER']);

      expect(await roles.delete(orgId, { userId, role: 'ADMIN' })).toMatchObject({ role: 'ADMIN' });
      await expect(roles.delete(orgId, { userId, role: 'ADMIN' })).rejects.toBeInstanceOf(RecordNotFoundError);
      expect(await roles.count(orgId, { userId })).toBe(1);
    }));

  it('replaceForUser swaps the whole set; countActiveOwners joins app_user', () =>
    withRollback(uow, { pool: 'system' }, async () => {
      const orgId = await newOrg();
      const a = await newUser(orgId);
      const b = await newUser(orgId);
      await roles.replaceForUser(orgId, a, ['OWNER']);
      await roles.replaceForUser(orgId, b, ['OWNER', 'ADMIN']);
      expect(await roles.countActiveOwners(orgId)).toBe(2);

      await roles.replaceForUser(orgId, b, ['VIEWER']);
      expect((await roles.listByUser(orgId, b)).map((r) => r.role)).toEqual(['VIEWER']);
      expect(await roles.countActiveOwners(orgId)).toBe(1);

      await users.update(orgId, a, { active: false });
      expect(await roles.countActiveOwners(orgId)).toBe(0);
      expect((await roles.listByUsers(orgId, [a, b])).length).toBe(2);
    }));

  it('the explicit orgId and RLS are two filters, not one', async () => {
    // Rows in two organizations, committed so a second transaction can see them.
    const made = await uow.runAs({ pool: 'system' }, async () => {
      const orgA = await newOrg();
      const orgB = await newOrg();
      const userA = await newUser(orgA);
      const userB = await newUser(orgB);
      await roles.createMany([
        { orgId: orgA, userId: userA, role: 'OWNER' },
        { orgId: orgB, userId: userB, role: 'OWNER' },
      ]);
      return { orgA, orgB, userA };
    });
    try {
      // With the tenant pool pinned to B, asking for A's rows returns nothing:
      // the parameter says A, the policy says B, and both must agree.
      await uow.runAs({ pool: 'tenant', orgId: made.orgB }, async () => {
        expect(await roles.findMany(made.orgA)).toEqual([]);
        expect(await roles.findUnique(made.orgA, { userId: made.userA, role: 'OWNER' })).toBeNull();
        expect(await roles.count(made.orgB)).toBe(1);
      });
    } finally {
      await uow.runAs({ pool: 'system' }, async () => {
        await roles.deleteMany(made.orgA, {});
        await roles.deleteMany(made.orgB, {});
        await users.deleteMany(made.orgA, {});
        await users.deleteMany(made.orgB, {});
        await orgs.deleteMany({ id: { in: [made.orgA, made.orgB] } });
      });
    }
  });
});
