import { Injectable } from '@nestjs/common';
import type { OrgId } from '@app/common';
import type { Role } from '../generated/db.js';
import { TransactionContext } from '../kysely/transaction.context.js';
import type { UserRoleModel } from '../models/index.js';
import { AbstractOrgDao } from './base/org/abstract-org.dao.js';

/** Composite key: `E` excludes `org_id`, which always arrives as a parameter (spec 08 §3). */
export type UserRoleKey = { readonly userId: string; readonly role: Role };

@Injectable()
export class UserRoleDao extends AbstractOrgDao<'userRole', UserRoleKey> {
  protected readonly table = 'userRole' as const;
  protected override readonly idColumns = ['userId', 'role'] as const;

  constructor(ctx: TransactionContext) {
    super(ctx);
  }

  listByUser(orgId: OrgId, userId: string): Promise<UserRoleModel[]> {
    return this.findMany(orgId, { where: { userId } });
  }

  /** One query for a whole page of users, not one per user. */
  listByUsers(orgId: OrgId, userIds: readonly string[]): Promise<UserRoleModel[]> {
    return this.findMany(orgId, { where: { userId: { in: userIds } } });
  }

  /** Replaces the whole role set of a user: delete + insert in the ambient transaction. */
  async replaceForUser(orgId: OrgId, userId: string, roles: readonly Role[]): Promise<void> {
    await this.deleteMany(orgId, { userId });
    if (roles.length === 0) return;
    await this.createMany(roles.map((role) => ({ orgId, userId, role })));
  }

  /** A join, so it is a concrete method: a DAO knows one table (spec 08 §3). */
  countActiveOwners(orgId: OrgId): Promise<number> {
    return this.db
      .selectFrom('userRole')
      .innerJoin('appUser', (join) =>
        join.onRef('appUser.id', '=', 'userRole.userId').onRef('appUser.orgId', '=', 'userRole.orgId'),
      )
      .select((eb) => eb.fn.countAll<string>().as('n'))
      .where('userRole.orgId', '=', orgId)
      .where('userRole.role', '=', 'OWNER')
      .where('appUser.active', '=', true)
      .executeTakeFirstOrThrow()
      .then((r) => Number(r.n));
  }
}
