import { unwrap, type OrgId, type TraceId, type UserId } from '@app/common';
import { InvalidCredentialsError } from '../../domain/errors.js';
import { Role } from '../../domain/role.js';
import type { RequestContext } from '../../domain/request-context.js';
import { User } from '../../domain/user.js';
import { InMemoryUserRepository } from '../../../test/doubles/in-memory-user.repository.js';
import { FakePasswordHasher } from '../../../test/doubles/fakes.js';
import { ChangePassword } from './change-password.js';

const ORG = '00000000-0000-7000-8000-0000000000aa' as OrgId;
const JUAN = '00000000-0000-7000-8000-0000000000b1' as UserId;

describe('ChangePassword', () => {
  let users: InMemoryUserRepository;
  let change: ChangePassword;
  let ctx: RequestContext;

  beforeEach(async () => {
    users = new InMemoryUserRepository();
    change = new ChangePassword(users, new FakePasswordHasher());
    const user = unwrap(
      User.create({
        id: JUAN,
        orgId: ORG,
        email: 'juan@x.co',
        name: 'Juan',
        passwordHash: 'hashed:vieja',
        roles: [Role.OPERATOR, Role.OWNER],
      }),
    );
    await users.save(user);
    ctx = { orgId: ORG, userId: JUAN, roles: new Set([Role.OPERATOR]), traceId: 't' as TraceId };
  });

  it('the current password must be right', async () => {
    await expect(change.execute(ctx, { current: 'otra', next: 'nueva' })).rejects.toBeInstanceOf(
      InvalidCredentialsError,
    );
    expect(users.rows.get(JUAN)?.passwordHash).toBe('hashed:vieja');
  });

  it('stores the new hash and touches nothing else', async () => {
    await change.execute(ctx, { current: 'vieja', next: 'nueva' });
    const after = users.rows.get(JUAN)!;
    expect(after.passwordHash).toBe('hashed:nueva');
    expect(after.roles).toEqual(new Set([Role.OPERATOR, Role.OWNER]));
    expect(after.active).toBe(true);
    // Todo UPDATE incrementa la versión, también el que solo cambia el hash:
    // «nothing else» son los roles y el estado, no la versión.
    expect(after.version).toBe(2);
  });

  it('a user that vanished mid-request is invalid credentials, not a crash', async () => {
    users.rows.delete(JUAN);
    await expect(change.execute(ctx, { current: 'vieja', next: 'nueva' })).rejects.toBeInstanceOf(
      InvalidCredentialsError,
    );
  });
});
