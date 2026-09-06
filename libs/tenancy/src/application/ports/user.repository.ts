import type { OrgId, UserId } from '@app/common';
import type { Email } from '../../domain/ids.js';
import type { User } from '../../domain/user.js';

export interface UserRepository {
  findById(orgId: OrgId, id: UserId): Promise<User | null>;
  findByEmail(orgId: OrgId, email: Email): Promise<User | null>;
  /** System context only: candidates across organizations, for login (spec 10 §5). */
  findByEmailGlobal(email: Email): Promise<User[]>;
  /** T-2 */
  countActiveOwners(orgId: OrgId): Promise<number>;
  /** Insert or update by id with optimistic locking. Throws EmailTakenError on T-1. */
  save(user: User): Promise<void>;
}
export const USER_REPOSITORY = Symbol('UserRepository');
