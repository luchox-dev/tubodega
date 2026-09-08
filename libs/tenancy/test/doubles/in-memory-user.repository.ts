import { decodeCursor, encodeCursor, type OrgId, type Page, type UserId } from '@app/common';
import type { Email } from '../../src/domain/ids.js';
import { EmailTakenError } from '../../src/domain/errors.js';
import { Role } from '../../src/domain/role.js';
import type { User } from '../../src/domain/user.js';
import type { UserFilter, UserPage, UserRepository } from '../../src/application/ports/user.repository.js';

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
  async listPage(orgId: OrgId, filter: UserFilter, page: UserPage): Promise<Page<User>> {
    const matches = [...this.rows.values()].filter(
      (u) =>
        u.orgId === orgId &&
        (filter.active === undefined || u.active === filter.active) &&
        (filter.role === undefined || u.roles.has(filter.role)),
    );
    const key = (u: User) => [String(u[page.sort.field]), u.id] as const;
    matches.sort((a, b) => {
      const [ka, ia] = key(a);
      const [kb, ib] = key(b);
      const c = ka === kb ? (ia < ib ? -1 : ia > ib ? 1 : 0) : ka < kb ? -1 : 1;
      return page.sort.dir === 'asc' ? c : -c;
    });

    let rest = matches;
    if (page.cursor) {
      const parts = decodeCursor(page.cursor);
      const at = parts ? matches.findIndex((u) => key(u)[1] === parts[1]) : -1;
      rest = at >= 0 ? matches.slice(at + 1) : [];
    }
    const data = rest.slice(0, page.limit);
    const hasMore = rest.length > page.limit;
    const last = data[data.length - 1];
    return { data, hasMore, ...(hasMore && last ? { nextCursor: encodeCursor([...key(last)]) } : {}) };
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
