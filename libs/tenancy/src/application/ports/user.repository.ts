import type { Cursor, OrgId, Page, UserId } from '@app/common';
import type { Email } from '../../domain/ids.js';
import type { Role } from '../../domain/role.js';
import type { User } from '../../domain/user.js';

/** What `GET /v1/users` may filter and order by; anything else is 400 (spec 03 §8). */
export interface UserFilter {
  readonly active?: boolean;
  readonly role?: Role;
}
export interface UserPage {
  readonly limit: number;
  readonly cursor?: Cursor;
  /** `createdAt` is not offered: the entity does not carry it, and nothing needs it. */
  readonly sort: { readonly field: 'name' | 'email'; readonly dir: 'asc' | 'desc' };
}

export interface UserRepository {
  findById(orgId: OrgId, id: UserId): Promise<User | null>;
  findByEmail(orgId: OrgId, email: Email): Promise<User | null>;
  /** System context only: candidates across organizations, for login (spec 10 §5). */
  findByEmailGlobal(email: Email): Promise<User[]>;
  /** T-2 */
  countActiveOwners(orgId: OrgId): Promise<number>;
  /** Cursor paginated, never offset: the list grows while it is walked (spec 03 §6). */
  listPage(orgId: OrgId, filter: UserFilter, page: UserPage): Promise<Page<User>>;
  /**
   * Insert or update by id with optimistic locking. Throws EmailTakenError on T-1.
   * The lock is an argument and not a field of the entity, like every other
   * repository of the house: a caller that omits it writes blind, and that has
   * to be visible at the call site.
   *
   * Returns the version the row ended up with: the caller has to be able to
   * hand it back to the client, and only the repository knows it (D-31).
   */
  save(user: User, expectedVersion?: number): Promise<number>;
}
export const USER_REPOSITORY = Symbol('UserRepository');
