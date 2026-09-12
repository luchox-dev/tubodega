import { Injectable } from '@nestjs/common';
import type { OrgId } from '@app/common';
import { TransactionContext } from '../kysely/transaction.context.js';
import { AbstractOrgDao } from './base/org/abstract-org.dao.js';
import type { MediaUploadModel } from '../models/index.js';

@Injectable()
export class MediaUploadDao extends AbstractOrgDao<'mediaUpload', string> {
  protected readonly table = 'mediaUpload' as const;

  constructor(ctx: TransactionContext) {
    super(ctx);
  }

  /**
   * Claims keys in one statement. The `claimed_at IS NULL` predicate is the
   * claim: a second attempt updates nothing and the caller learns which keys
   * were already spoken for, which is what `upload-not-found` reports.
   */
  claim(orgId: OrgId, storageKeys: readonly string[]): Promise<MediaUploadModel[]> {
    if (storageKeys.length === 0) return Promise.resolve([]);
    return this.db
      .updateTable('mediaUpload')
      .set({ claimedAt: new Date() })
      .where('orgId', '=', orgId)
      .where('storageKey', 'in', [...storageKeys])
      .where('claimedAt', 'is', null)
      .returningAll()
      .execute();
  }

  /** The 24 h purge of spec 07 §6. System context: it crosses organizations. */
  listUnclaimedBefore(date: Date): Promise<MediaUploadModel[]> {
    return this.db
      .selectFrom('mediaUpload')
      .selectAll()
      .where('claimedAt', 'is', null)
      .where('createdAt', '<', date)
      .execute();
  }
}
