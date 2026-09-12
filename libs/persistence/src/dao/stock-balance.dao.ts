import { Injectable } from '@nestjs/common';
import type { OrgId } from '@app/common';
import { TransactionContext } from '../kysely/transaction.context.js';
import { AbstractOrgDao } from './base/org/abstract-org.dao.js';

export interface StockPositionRow {
  readonly nodeId: string;
  readonly path: string;
  readonly quantity: string;
}

/**
 * Read-only for now: the upserts of spec 04 §3.5 arrive with the ledger in
 * wave 3. What exists is what C-9 needs — whether a product still has stock,
 * and where.
 */
@Injectable()
export class StockBalanceDao extends AbstractOrgDao<'stockBalance', string> {
  protected readonly table = 'stockBalance' as const;

  constructor(ctx: TransactionContext) {
    super(ctx);
  }

  /**
   * The join to `node` is what lets the error name the places instead of the
   * uuids: "still stock in BOD-A/Z1/E3" is actionable, a uuid is not. Only
   * custodial nodes count — a SOURCE or a TERMINAL is the boundary of the
   * system, and its balance is a running total, not stock on a shelf.
   */
  positionsOfProduct(orgId: OrgId, productId: string): Promise<StockPositionRow[]> {
    return this.db
      .selectFrom('stockBalance')
      .innerJoin('node', (join) =>
        join.onRef('node.id', '=', 'stockBalance.nodeId').onRef('node.orgId', '=', 'stockBalance.orgId'),
      )
      .select(['stockBalance.nodeId as nodeId', 'node.path as path', 'stockBalance.quantity as quantity'])
      .where('stockBalance.orgId', '=', orgId)
      .where('stockBalance.productId', '=', productId)
      .where('stockBalance.quantity', '<>', '0')
      .where('stockBalance.nodeKind', 'in', ['INTERNAL', 'CUSTODY'])
      .orderBy('node.path')
      .execute();
  }
}
