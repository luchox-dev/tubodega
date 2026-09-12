import { Injectable } from '@nestjs/common';
import type { OrgId } from '@app/common';
import { TransactionContext } from '../kysely/transaction.context.js';
import { AbstractOrgAppendDao } from './base/org/abstract-org-append.dao.js';

/**
 * The ledger stops at the append family, and that is the point: a DAO of
 * `movement` that inherited `update` would have the method in its type and
 * someone would eventually call it. I-3 is a shape, not just a REVOKE.
 *
 * Only what the catalogue needs exists so far (C-8); the rest lands with the
 * ledger in wave 3.
 */
@Injectable()
export class MovementDao extends AbstractOrgAppendDao<'movement', string> {
  protected readonly table = 'movement' as const;

  constructor(ctx: TransactionContext) {
    super(ctx);
  }

  countByProduct(orgId: OrgId, productId: string): Promise<number> {
    return this.count(orgId, { productId });
  }
}
