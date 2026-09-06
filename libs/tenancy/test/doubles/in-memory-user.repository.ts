import type { OrgId, UserId } from '@app/common';
import type { Email } from '../../src/domain/ids.js';
import { EmailTakenError } from '../../src/domain/errors.js';
import { Role } from '../../src/domain/role.js';
import type { User } from '../../src/domain/user.js';
import type { UserRepository } from '../../src/application/ports/user.repository.js';

export class InMemoryUserRepository implements UserRepository {
  readonly rows = new Map<UserId, User>();

  async findById(orgId: OrgId, id: UserId) {
    const u = this.rows.get(id);
    return u && u.orgId === orgId ? u : null;
  }
  async findByEmail(orgId: OrgId, email: Email) {
    return [...this.rows.values()].find((u) => u.orgId === orgId && u.email === email) ?? null;
  }
  async findByEmailGlobal(email: Email) {
    return [...this.rows.values()].filter((u) => u.email === email && u.active);
  }
  async countActiveOwners(orgId: OrgId) {
    return [...this.rows.values()].filter((u) => u.orgId === orgId && u.active && u.roles.has(Role.OWNER)).length;
  }
  async save(user: User) {
    for (const other of this.rows.values()) {
      if (other.id !== user.id && other.orgId === user.orgId && other.email === user.email) {
        throw new EmailTakenError(user.email);
      }
    }
    this.rows.set(user.id, user);
  }
}
