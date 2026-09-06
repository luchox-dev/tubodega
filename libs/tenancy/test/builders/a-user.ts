import type { OrgId, UserId } from '@app/common';
import type { Email } from '../../src/domain/ids.js';
import { Role } from '../../src/domain/role.js';
import { User } from '../../src/domain/user.js';

let seq = 0;

/** Test builder with sensible defaults and partial override (spec 06 §12). */
export function aUser(overrides: Partial<Parameters<typeof User.rehydrate>[0]> = {}): User {
  seq += 1;
  return User.rehydrate({
    id: `00000000-0000-7000-8000-${String(seq).padStart(12, '0')}` as UserId,
    orgId: '00000000-0000-7000-8000-00000000000a' as OrgId,
    email: `user${seq}@esquina.co` as Email,
    name: `User ${seq}`,
    passwordHash: 'hash',
    roles: [Role.OPERATOR],
    active: true,
    version: 1,
    ...overrides,
  });
}
