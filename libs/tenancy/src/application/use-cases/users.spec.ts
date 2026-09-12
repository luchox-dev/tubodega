// The five user use cases share their setup, so they share a file: the same
// fictional organization, the same doubles, one describe each.
import { unwrap, type Cursor, type OrgId, type TraceId, type UserId } from '@app/common';
import {
  EmailTakenError,
  InsufficientRoleError,
  LastOwnerError,
  UserNotFoundError,
} from '../../domain/errors.js';
import type { RequestContext } from '../../domain/request-context.js';
import { Role } from '../../domain/role.js';
import { User } from '../../domain/user.js';
import { InMemoryUserRepository } from '../../../test/doubles/in-memory-user.repository.js';
import {
  FakePasswordHasher,
  FixedClock,
  InMemoryEventPublisher,
  SequentialIdGenerator,
} from '../../../test/doubles/fakes.js';
import { CreateUser } from './create-user.js';
import { DeactivateUser } from './deactivate-user.js';
import { GetUser } from './get-user.js';
import { ListUsers } from './list-users.js';
import { UpdateUserRoles } from './update-user-roles.js';

const NOW = new Date('2026-09-07T10:00:00.000Z');
const ORG = '00000000-0000-7000-8000-0000000000aa' as OrgId;
const OTHER = '00000000-0000-7000-8000-0000000000ab' as OrgId;

let users: InMemoryUserRepository;
let events: InMemoryEventPublisher;
let ids: SequentialIdGenerator;
let admin: RequestContext;
let viewer: RequestContext;

const ctxOf = (roles: Role[]): RequestContext => ({
  orgId: ORG,
  userId: '00000000-0000-7000-8000-0000000000c9' as UserId,
  roles: new Set(roles),
  traceId: 'trace' as TraceId,
});

const seed = async (over: { id: string; orgId?: OrgId; email: string; name: string; roles: Role[] }) => {
  const u = unwrap(
    User.create({
      id: over.id as UserId,
      orgId: over.orgId ?? ORG,
      email: over.email,
      name: over.name,
      passwordHash: 'hashed:x',
      roles: over.roles,
    }),
  );
  await users.save(u);
  return u;
};

beforeEach(() => {
  users = new InMemoryUserRepository();
  events = new InMemoryEventPublisher();
  ids = new SequentialIdGenerator();
  admin = ctxOf([Role.ADMIN]);
  viewer = ctxOf([Role.VIEWER]);
});

const createUser = () => new CreateUser(users, new FakePasswordHasher(), events, ids, new FixedClock(NOW));
const listUsers = () => new ListUsers(users);
const getUser = () => new GetUser(users);
const updateRoles = () => new UpdateUserRoles(users, events, ids, new FixedClock(NOW));
const deactivate = () => new DeactivateUser(users, events, ids, new FixedClock(NOW));

describe('CreateUser', () => {
  const input = { email: 'Juan@X.co', name: 'Juan', password: 'secreta1!', roles: [Role.OPERATOR] };

  it('creates an active user with the roles asked for and a hashed password', async () => {
    const created = await createUser().execute(admin, input);
    expect(created.email).toBe('juan@x.co'); // normalised by the domain
    expect(created.active).toBe(true);
    expect(created.roles).toEqual(new Set([Role.OPERATOR]));
    expect(created.passwordHash).toBe('hashed:secreta1!');
    expect(events.published.map((e) => e.type)).toEqual(['user.created']);
    expect(events.published[0]!.orgId).toBe(ORG);
  });

  it('needs MANAGE_USERS', async () => {
    await expect(createUser().execute(viewer, input)).rejects.toBeInstanceOf(InsufficientRoleError);
    expect(users.rows.size).toBe(0);
  });

  it('T-1 · the email is unique per organization, not globally', async () => {
    await createUser().execute(admin, input);
    await expect(createUser().execute(admin, input)).rejects.toBeInstanceOf(EmailTakenError);
    // The same email in another organization is fine.
    await expect(seed({ id: 'u-x', orgId: OTHER, email: 'juan@x.co', name: 'Juan', roles: [Role.OWNER] })).resolves
      .toBeDefined();
  });
});

describe('ListUsers', () => {
  beforeEach(async () => {
    await seed({ id: 'u-1', email: 'marta@x.co', name: 'Marta', roles: [Role.OWNER] });
    await seed({ id: 'u-2', email: 'diego@x.co', name: 'Diego', roles: [Role.ADMIN] });
    await seed({ id: 'u-3', email: 'juan@x.co', name: 'Juan', roles: [Role.OPERATOR] });
    await seed({ id: 'u-4', email: 'sofia@x.co', name: 'Sofía', roles: [Role.VIEWER] });
    await seed({ id: 'u-5', orgId: OTHER, email: 'ajeno@x.co', name: 'Ajeno', roles: [Role.OWNER] });
  });
  const page = { limit: 50, sort: { field: 'name', dir: 'asc' } } as const;

  it('lists only this organization, ordered', async () => {
    const out = await listUsers().execute(admin, { ...page });
    expect(out.data.map((u) => u.name)).toEqual(['Diego', 'Juan', 'Marta', 'Sofía']);
    expect(out.hasMore).toBe(false);
  });

  it('filters by role and by active', async () => {
    expect((await listUsers().execute(admin, { ...page, role: Role.OPERATOR })).data.map((u) => u.name)).toEqual([
      'Juan',
    ]);
    await users.save(unwrap((await users.findById(ORG, 'u-3' as UserId))!.deactivate(2)));
    expect((await listUsers().execute(admin, { ...page, active: false })).data.map((u) => u.name)).toEqual(['Juan']);
    expect((await listUsers().execute(admin, { ...page, active: true })).data).toHaveLength(3);
  });

  it('paginates by cursor, without repeating or skipping', async () => {
    const first = await listUsers().execute(admin, { ...page, limit: 2 });
    expect(first.data.map((u) => u.name)).toEqual(['Diego', 'Juan']);
    expect(first.hasMore).toBe(true);
    const second = await listUsers().execute(admin, { ...page, limit: 2, cursor: first.nextCursor as Cursor });
    expect(second.data.map((u) => u.name)).toEqual(['Marta', 'Sofía']);
    expect(second.hasMore).toBe(false);
    expect(second.nextCursor).toBeUndefined();
  });

  it('needs MANAGE_USERS', async () => {
    await expect(listUsers().execute(viewer, { ...page })).rejects.toBeInstanceOf(InsufficientRoleError);
  });
});

describe('GetUser', () => {
  beforeEach(async () => {
    await seed({ id: 'u-1', email: 'juan@x.co', name: 'Juan', roles: [Role.OPERATOR] });
    await seed({ id: 'u-9', orgId: OTHER, email: 'ajeno@x.co', name: 'Ajeno', roles: [Role.OWNER] });
  });

  it('returns the user of this organization', async () => {
    expect((await getUser().execute(admin, { id: 'u-1' as UserId })).name).toBe('Juan');
  });

  it('I-6 · a user of another organization is 404, never 403', async () => {
    await expect(getUser().execute(admin, { id: 'u-9' as UserId })).rejects.toBeInstanceOf(UserNotFoundError);
    await expect(getUser().execute(admin, { id: 'nope' as UserId })).rejects.toBeInstanceOf(UserNotFoundError);
  });
});

describe('UpdateUserRoles', () => {
  beforeEach(async () => {
    await seed({ id: 'u-1', email: 'marta@x.co', name: 'Marta', roles: [Role.OWNER] });
    await seed({ id: 'u-2', email: 'juan@x.co', name: 'Juan', roles: [Role.OPERATOR] });
    await seed({ id: 'u-9', orgId: OTHER, email: 'ajeno@x.co', name: 'Ajeno', roles: [Role.OWNER] });
  });

  it('changes the set and emits user.roles_changed', async () => {
    const out = await updateRoles().execute(admin, {
      id: 'u-2' as UserId,
      roles: [Role.ADMIN],
      expectedVersion: 1,
    });
    expect(out.roles).toEqual(new Set([Role.ADMIN]));
    expect(events.published.map((e) => e.type)).toEqual(['user.roles_changed']);
    expect(events.published[0]!.data).toMatchObject({ userId: 'u-2', roles: ['ADMIN'] });
  });

  // Lo encontró la colección de Postman: lo que vuelve de una escritura tiene que
  // llevar la versión con la que quedó la fila, o un cliente que edita dos veces
  // con la versión que acaba de recibir se lleva un 409 fantasma (D-31).
  it('devuelve la versión que quedó guardada, no la que traía', async () => {
    const once = await updateRoles().execute(admin, {
      id: 'u-2' as UserId,
      roles: [Role.ADMIN],
      expectedVersion: 1,
    });
    expect(once.version).toBe(2);
    const twice = await updateRoles().execute(admin, {
      id: 'u-2' as UserId,
      roles: [Role.VIEWER],
      expectedVersion: once.version,
    });
    expect(twice.version).toBe(3);
  });

  it('T-2 · taking OWNER away from the only active owner is refused', async () => {
    await expect(
      updateRoles().execute(admin, { id: 'u-1' as UserId, roles: [Role.ADMIN], expectedVersion: 1 }),
    ).rejects.toBeInstanceOf(LastOwnerError);
    expect((await users.findById(ORG, 'u-1' as UserId))?.roles).toEqual(new Set([Role.OWNER]));
  });

  it('T-2 · with a second owner it goes through', async () => {
    await seed({ id: 'u-3', email: 'otro@x.co', name: 'Otro', roles: [Role.OWNER] });
    const out = await updateRoles().execute(admin, {
      id: 'u-1' as UserId,
      roles: [Role.ADMIN],
      expectedVersion: 1,
    });
    expect(out.roles).toEqual(new Set([Role.ADMIN]));
  });

  it('I-6 and authorization', async () => {
    await expect(
      updateRoles().execute(admin, { id: 'u-9' as UserId, roles: [Role.ADMIN], expectedVersion: 1 }),
    ).rejects.toBeInstanceOf(UserNotFoundError);
    await expect(
      updateRoles().execute(viewer, { id: 'u-2' as UserId, roles: [Role.ADMIN], expectedVersion: 1 }),
    ).rejects.toBeInstanceOf(InsufficientRoleError);
  });
});

describe('DeactivateUser', () => {
  beforeEach(async () => {
    await seed({ id: 'u-1', email: 'marta@x.co', name: 'Marta', roles: [Role.OWNER] });
    await seed({ id: 'u-2', email: 'juan@x.co', name: 'Juan', roles: [Role.OPERATOR] });
  });

  it('deactivates instead of deleting, and emits user.deactivated', async () => {
    await deactivate().execute(admin, { id: 'u-2' as UserId });
    expect((await users.findById(ORG, 'u-2' as UserId))?.active).toBe(false);
    expect(events.published.map((e) => e.type)).toEqual(['user.deactivated']);
  });

  it('T-2 · the last active owner cannot be deactivated', async () => {
    await expect(deactivate().execute(admin, { id: 'u-1' as UserId })).rejects.toBeInstanceOf(LastOwnerError);
  });

  it('deactivating twice is not an error, and emits nothing the second time', async () => {
    await deactivate().execute(admin, { id: 'u-2' as UserId });
    await deactivate().execute(admin, { id: 'u-2' as UserId });
    expect(events.published).toHaveLength(1);
  });

  it('I-6 and authorization', async () => {
    await expect(deactivate().execute(admin, { id: 'nope' as UserId })).rejects.toBeInstanceOf(UserNotFoundError);
    await expect(deactivate().execute(viewer, { id: 'u-2' as UserId })).rejects.toBeInstanceOf(
      InsufficientRoleError,
    );
  });
});
