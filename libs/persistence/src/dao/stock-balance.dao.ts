import { Injectable } from '@nestjs/common';
import type { OrgId } from '@app/common';
import { TransactionContext } from '../kysely/transaction.context.js';
import { AbstractOrgDao } from './base/org/abstract-org.dao.js';

export interface StockPositionRow {
  readonly nodeId: string;
  readonly path: string;
  readonly quantity: string;
}

export interface NodePositionRow {
  readonly productId: string;
  readonly batchId?: string;
  readonly quantity: string;
}

/**
 * Read-only for now: the upserts of spec 04 §3.5 arrive with the ledger in
 * wave 3. What exists is what C-9 and N-3 need — whether there is still stock,
 * and what it is.
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

  /**
   * What sits on one node, for N-3. No join: the caller already holds the node
   * whose deactivation it is blocking, so its readable path is in hand — unlike
   * C-9, where the nodes are several and unknown.
   *
   * Index-backed by the partial (org_id, node_id) WHERE quantity <> 0, which is
   * exactly the predicate below.
   */
  positionsOfNode(orgId: OrgId, nodeId: string, limit: number): Promise<NodePositionRow[]> {
    return this.db
      .selectFrom('stockBalance')
      .select(['productId', 'batchId', 'quantity'])
      .where('orgId', '=', orgId)
      .where('nodeId', '=', nodeId)
      .where('quantity', '<>', '0')
      .orderBy('productId')
      .limit(limit)
      .execute()
      .then((rows) =>
        rows.map((r) => ({
          productId: r.productId,
          ...(r.batchId !== null ? { batchId: r.batchId } : {}),
          quantity: r.quantity,
        })),
      );
  }
}
