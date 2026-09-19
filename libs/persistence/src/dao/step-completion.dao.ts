import { Injectable } from '@nestjs/common';
import { TransactionContext } from '../kysely/transaction.context.js';
import { AbstractOrgAppendDao } from './base/org/abstract-org-append.dao.js';

/**
 * Stops at the append family, like `movement`. A DAO of an append-only table
 * that inherited `update` would have the method in its type and somebody would
 * eventually call it — that is the first of the two layers spec 04 §3.4 asks
 * for; the second is the `REVOKE UPDATE, DELETE ON step_completion` this plan
 * migrates (D-49), promised three times in prose since spec 13 §2 and until now
 * nowhere in SQL.
 */
@Injectable()
export class StepCompletionDao extends AbstractOrgAppendDao<'stepCompletion', string> {
  protected readonly table = 'stepCompletion' as const;

  constructor(ctx: TransactionContext) {
    super(ctx);
  }
}
