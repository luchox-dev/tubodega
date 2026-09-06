import { Injectable } from '@nestjs/common';
import { TransactionContext } from '../kysely/transaction.context.js';
import type { UserModel } from '../models/index.js';
import { AbstractOrgDao } from './base/abstract-org.dao.js';

@Injectable()
export class UserDao extends AbstractOrgDao<'appUser'> {
  protected readonly table = 'appUser' as const;
  protected override readonly versioned = true;

  constructor(ctx: TransactionContext) {
    super(ctx);
  }

  /**
   * System context only: the single read of tenant data without an
   * organization in the whole system (spec 07 §2). Login does not know the
   * organization until the password disambiguates the candidates.
   */
  findByEmailGlobal(email: string): Promise<UserModel[]> {
    return this.db
      .selectFrom('appUser')
      .selectAll()
      .where('email', '=', email)
      .where('active', '=', true)
      .execute();
  }
}
