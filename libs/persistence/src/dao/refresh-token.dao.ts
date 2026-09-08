import { Injectable } from '@nestjs/common';
import { TransactionContext } from '../kysely/transaction.context.js';
import type { RefreshTokenModel } from '../models/index.js';
import { AbstractOrgDao } from './base/org/abstract-org.dao.js';

@Injectable()
export class RefreshTokenDao extends AbstractOrgDao<'refreshToken', string> {
  protected readonly table = 'refreshToken' as const;

  constructor(ctx: TransactionContext) {
    super(ctx);
  }

  /** System context: refresh resolves the session before it has an organization (spec 07 §2). */
  async findByHashGlobal(tokenHash: string): Promise<RefreshTokenModel | null> {
    const row = await this.db
      .selectFrom('refreshToken')
      .selectAll()
      .where('tokenHash', '=', tokenHash)
      .executeTakeFirst();
    return row ?? null;
  }

  /** System context, same reason: logout and refresh may not have fixed an organization yet. */
  async revoke(id: string, at: Date): Promise<void> {
    await this.db.updateTable('refreshToken').set({ revokedAt: at }).where('id', '=', id).execute();
  }
}
