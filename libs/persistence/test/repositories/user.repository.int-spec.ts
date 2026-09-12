import { v7 } from 'uuid';
import { unwrap, type Cursor, type OrgId, type UserId } from '@app/common';
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
      expect(await users.save(u)).toBe(1);
      expect(await users.save(unwrap(u.withRoles([Role.ADMIN], 1)), 1)).toBe(2);
      await expect(users.save(unwrap(u.withRoles([Role.VIEWER], 1)), 1)).rejects.toBeInstanceOf(
        VersionConflictError,
      );
      expect((await users.findById(org.id, u.id))?.roles).toEqual(new Set([Role.ADMIN]));
    });
  });

  // D-31: what `save` returns has to be the version of the row, or the use case
  // cannot hand the client something it can use as the next If-Match.
  it('la versión devuelta encadena tres escrituras seguidas', async () => {
    await withRollback(uow, { pool: 'system' }, async () => {
      const org = await newOrg();
      const u = newUser(org.id, 'a@x.co');
      const v1 = await users.save(u);
      const v2 = await users.save(unwrap(u.withRoles([Role.ADMIN], 2)), v1);
      const v3 = await users.save(unwrap(u.withRoles([Role.VIEWER], 2)), v2);
      expect([v1, v2, v3]).toEqual([1, 2, 3]);
      expect((await users.findById(org.id, u.id))?.version).toBe(3);
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

  it('listPage paginates stably by name and hydrates every role', async () => {
    await withRollback(uow, { pool: 'system' }, async () => {
      const org = await newOrg();
      const names = ['Ana', 'Beto', 'Carla', 'Diego', 'Elena', 'Fabio', 'Gina'];
      for (const [i, name] of names.entries()) {
        const u = unwrap(
          User.create({
            id: v7() as UserId,
            orgId: org.id,
            email: `${name.toLowerCase()}@x.co`,
            name,
            passwordHash: 'h',
            roles: i === 0 ? [Role.OWNER, Role.ADMIN] : [Role.OPERATOR],
          }),
        );
        await users.save(u);
      }

      const seen: string[] = [];
      let cursor: Cursor | undefined;
      for (let page = 0; page < 3; page++) {
        const got = await users.listPage(org.id, {}, { limit: 3, cursor, sort: { field: 'name', dir: 'asc' } });
        seen.push(...got.data.map((u) => u.name));
        cursor = got.nextCursor;
        expect(got.hasMore).toBe(page < 2);
      }
      expect(seen).toEqual(names);
      expect(cursor).toBeUndefined();
    });
  });

  it('listPage filters by role and by active', async () => {
    await withRollback(uow, { pool: 'system' }, async () => {
      const org = await newOrg();
      await users.save(newUser(org.id, 'marta@x.co', [Role.OWNER]));
      const juan = newUser(org.id, 'juan@x.co', [Role.OPERATOR]);
      await users.save(juan);
      await users.save(newUser(org.id, 'sofia@x.co', [Role.VIEWER]));

      const page = { limit: 50, sort: { field: 'email', dir: 'asc' } } as const;
      const operators = await users.listPage(org.id, { role: Role.OPERATOR }, page);
      expect(operators.data.map((u) => u.email)).toEqual(['juan@x.co']);
      expect(operators.data[0]!.roles).toEqual(new Set([Role.OPERATOR]));

      await users.save(unwrap(juan.deactivate(1)));
      expect((await users.listPage(org.id, { active: false }, page)).data.map((u) => u.email)).toEqual(['juan@x.co']);
      expect((await users.listPage(org.id, { active: true }, page)).data).toHaveLength(2);
    });
  });
});