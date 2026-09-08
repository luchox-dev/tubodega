import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { TransactionContext } from '../kysely/transaction.context.js';
import type { OutboxEventModel } from '../models/index.js';
import { AbstractOrgAppendDao } from './base/org/abstract-org-append.dao.js';

/** Append-only in shape, not just by convention: no update, upsert or delete (spec 08 §3). */
@Injectable()
export class OutboxEventDao extends AbstractOrgAppendDao<'outboxEvent', string> {
  protected readonly table = 'outboxEvent' as const;

  constructor(ctx: TransactionContext) {
    super(ctx);
  }

  /**
   * System context, across organizations (spec 05 §3). `FOR UPDATE SKIP
   * LOCKED` is what lets several instances consume in parallel without
   * coordinating — it is why this design needs no message queue.
   */
  claimPending(limit: number): Promise<OutboxEventModel[]> {
    return this.db
      .selectFrom('outboxEvent')
      .selectAll()
      .where('publishedAt', 'is', null)
      .orderBy('occurredAt', 'asc')
      .limit(limit)
      .modifyEnd(sql`for update skip locked`)
      .execute();
  }

  /** The only write that is not an insert; it touches a column the ledger does not read. */
  async markPublished(ids: readonly string[], at: Date): Promise<void> {
    if (ids.length === 0) return;
    await this.db.updateTable('outboxEvent').set({ publishedAt: at }).where('id', 'in', ids).execute();
  }
}
