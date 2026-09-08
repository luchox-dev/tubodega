import { unwrap, type OrgId, type UserId } from '@app/common';
import { aUser } from '../../test/builders/a-user.js';
import { Action, Role } from './role.js';
import { User } from './user.js';
import { InvalidEmailError, LastOwnerError } from './errors.js';

describe('User', () => {
  it('create normalises the email and starts active at version 1', () => {
    const u = unwrap(
      User.create({ id: 'u1' as never, orgId: 'o1' as never, email: 'Juan@Esquina.CO', name: ' Juan ', passwordHash: 'h', roles: [Role.OPERATOR] }),
    );
    expect(u.email).toBe('juan@esquina.co');
    expect(u.name).toBe('Juan');
    expect(u.active).toBe(true);
    expect(u.version).toBe(1);
  });

  it('create rejects an invalid email', () => {
    const r = User.create({ id: 'u1' as never, orgId: 'o1' as never, email: 'nope', name: 'x', passwordHash: 'h', roles: [] });
    expect(!r.ok && r.error).toBeInstanceOf(InvalidEmailError);
  });

  it('can(READ) holds for every role and fails with no roles', () => {
    for (const role of Object.values(Role)) expect(aUser({ roles: [role] }).can(Action.READ)).toBe(true);
    expect(aUser({ roles: [] }).can(Action.READ)).toBe(false);
  });

  describe('T-2 · the last active OWNER', () => {
    it('cannot be deactivated', () => {
      const r = aUser({ roles: [Role.OWNER] }).deactivate(1);
      expect(!r.ok && r.error).toBeInstanceOf(LastOwnerError);
    });
    it('can be deactivated when another active OWNER exists', () => {
      expect(unwrap(aUser({ roles: [Role.OWNER] }).deactivate(2)).active).toBe(false);
    });
    it('cannot lose the OWNER role', () => {
      const r = aUser({ roles: [Role.OWNER] }).withRoles([Role.ADMIN], 1);
      expect(!r.ok && r.error).toBeInstanceOf(LastOwnerError);
    });
    it('keeping OWNER among the new roles is fine', () => {
      expect(unwrap(aUser({ roles: [Role.OWNER] }).withRoles([Role.OWNER, Role.ADMIN], 1)).roles.size).toBe(2);
    });
    it('does not apply to non-owners', () => {
      expect(unwrap(aUser({ roles: [Role.ADMIN] }).deactivate(1)).active).toBe(false);
    });
  });

  it('withVersion carries what the caller believes, for If-Match', () => {
    const u = unwrap(
      User.create({ id: 'u' as UserId, orgId: 'o' as OrgId, email: 'a@b.co', name: 'A', passwordHash: 'h', roles: [Role.ADMIN] }),
    );
    const stale = u.withVersion(7);
    expect(stale.version).toBe(7);
    expect(stale.roles).toEqual(u.roles);
    expect(stale.email).toBe(u.email);
  });
});