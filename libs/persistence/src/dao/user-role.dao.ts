import { Injectable } from '@nestjs/common';
import type { OrgId } from '@app/common';
import type { Role } from '../generated/db.js';
import { TransactionContext } from '../kysely/transaction.context.js';
import type { UserRoleModel } from '../models/index.js';
import { AbstractOrgDao } from './base/abstract-org.dao.js';

@Injectable()
export class UserRoleDao extends AbstractOrgDao<'userRole'> {
  protected readonly table = 'userRole' as const;

  constructor(ctx: TransactionContext) {
    super(ctx);
  }

  listByUser(orgId: OrgId, userId: string): Promise<UserRoleModel[]> {
    return this.db
      .selectFrom('userRole')
      .selectAll()
      .where('orgId', '=', orgId)
      .where('userId', '=', userId)
      .execute();
  }

  /** Replaces the whole role set of a user: delete + insert in the ambient transaction. */
  async replaceForUser(orgId: OrgId, userId: string, roles: readonly Role[]): Promise<void> {
    await this.db.deleteFrom('userRole').where('orgId', '=', orgId).where('userId', '=', userId).execute();
    if (roles.length === 0) return;
    await this.db
      .insertInto('userRole')
      .values(roles.map((role) => ({ orgId, userId, role })))
      .execute();
  }

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
