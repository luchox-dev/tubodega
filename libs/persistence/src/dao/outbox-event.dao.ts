import { Injectable } from '@nestjs/common';
import { TransactionContext } from '../kysely/transaction.context.js';
import { AbstractOrgDao } from './base/abstract-org.dao.js';

/** Append-only in use; the dispatcher's `markPublished` arrives with it (plan 2). */
@Injectable()
export class OutboxEventDao extends AbstractOrgDao<'outboxEvent'> {
  protected readonly table = 'outboxEvent' as const;

  constructor(ctx: TransactionContext) {
    super(ctx);
  }
}
