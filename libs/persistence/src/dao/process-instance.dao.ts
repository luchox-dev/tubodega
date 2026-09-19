import { Injectable } from '@nestjs/common';
import { TransactionContext } from '../kysely/transaction.context.js';
import { AbstractOrgDao } from './base/org/abstract-org.dao.js';

@Injectable()
export class ProcessInstanceDao extends AbstractOrgDao<'processInstance', string> {
  protected readonly table = 'processInstance' as const;
  /**
   * **`true` here, and it is the trap of `ProcessTemplateDao` the other way
   * round.** There, `version` is part of the natural key `(org_id, code,
   * version)` and the table has no `updated_at`, so `versioned` has to be
   * false. Here it is genuine optimistic locking — spec 13 §9 calls it
   * internal, not contract — and the column `updated_at` exists. Getting it
   * wrong in either direction breaks something: false here would let two
   * simultaneous `complete` step on each other's context.
   */
  protected override readonly versioned = true;

  constructor(ctx: TransactionContext) {
    super(ctx);
  }
}
