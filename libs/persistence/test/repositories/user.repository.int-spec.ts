import { v7 } from 'uuid';
import { unwrap, type OrgId, type UserId } from '@app/common';
import { Organization, Role, User, type Email } from '@app/tenancy';
import {
  KyselyOrganizationRepository,
  KyselyUserRepository,
  KyselyUnitOfWork,
  VersionConflictError,
} from '@app/persistence';
import { createPersistenceHarness, withRollback } from '../../../../test/support/db.js';

describe('KyselyUserRepository', () => {
  let h: Awaited<ReturnType<typeof createPersistenceHarness>>;
  let users: KyselyUserRepository;
  let orgs: KyselyOrganizationRepository;
  let uow: KyselyUnitOfWork;
  beforeAll(async () => {
    h = await createPersistenceHarness();
    users = h.get(KyselyUserRepository);
    orgs = h.get(KyselyOrganizationRepository);
    uow = h.uow;
  });
  afterAll(() => h.close());

  const newOrg = async () => {
    const org = unwrap(Organization.create({ id: v7() as OrgId, name: 'Acme', slug: `acme-${v7().slice(-12)}` }));
    await orgs.save(org);
    return org;
  };
  const newUser = (orgId: OrgId, email: string, roles: Role[] = [Role.OPERATOR]) =>
    unwrap(User.create({ id: v7() as UserId, orgId, email, name: 'Someone', passwordHash: 'h', roles }));

  it('save (insert) + findById returns the entity with its roles', async () => {
    await withRollback(uow, { pool: 'system' }, async () => {
      const org = await newOrg();
      const u = newUser(org.id, 'a@x.co', [Role.OWNER, Role.ADMIN]);
      await users.save(u);
      const found = await users.findById(org.id, u.id);
      expect(found?.email).toBe('a@x.co');
      expect(found?.roles).toEqual(new Set([Role.OWNER, Role.ADMIN]));
      expect(found?.version).toBe(1);
      expect(await users.countActiveOwners(org.id)).toBe(1);
      expect(await users.findByEmail(org.id, 'A@X.CO' as Email)).not.toBeNull();
    });
  });

  it('save (update) with a stale version → VersionConflictError', async () => {
    await withRollback(uow, { pool: 'system' }, async () => {
      const org = await newOrg();
      const u = newUser(org.id, 'a@x.co');
      await users.save(u);
      await users.save(unwrap(u.withRoles([Role.ADMIN], 1))); // version 1 → 2
      await expect(users.save(unwrap(u.withRoles([Role.VIEWER], 1)))).rejects.toBeInstanceOf(VersionConflictError);
      expect((await users.findById(org.id, u.id))?.roles).toEqual(new Set([Role.ADMIN]));
    });
  });

  it('findByEmailGlobal with the system pool finds the email in two organizations', async () => {
    await withRollback(uow, { pool: 'system' }, async () => {
      const a = await newOrg();
      const b = await newOrg();
      await users.save(newUser(a.id, 'juan@x.co'));
      await users.save(newUser(b.id, 'juan@x.co'));
      const found = await users.findByEmailGlobal('juan@x.co' as Email);
      expect(found.map((u) => u.orgId).sort()).toEqual([a.id, b.id].sort());
    });
  });

  it('findByEmailGlobal with the tenant pool and no app.current_org fails under RLS', async () => {
    // A tenant transaction without an organization: only reachable by bypassing runAs on purpose.
    const db = h.factory.get('tenant');
    const tx = await db.startTransaction().execute();
    try {
      await expect(
        h.ctx.runWith(tx as never, () => users.findByEmailGlobal('juan@x.co' as Email)),
      ).rejects.toMatchObject({ code: expect.stringMatching(/^(42704|22P02)$/) });
    } finally {
      await tx.rollback().execute();
    }
  });
});
