import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { v7 } from 'uuid';
import type { OrgId } from '@app/common';
import { TransactionContext } from '../kysely/transaction.context.js';
import { escapeLike } from './base/where.js';
import { translatePgError } from './base/errors.js';
import { AbstractOrgDao } from './base/org/abstract-org.dao.js';
import type { StockBalanceModel } from '../models/index.js';

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

/** Aggregated over a subtree, one row per (product, batch). */
export interface SubtreeTotalRow {
  readonly productId: string;
  readonly batchId: string | null;
  readonly quantity: string;
}

/**
 * The balances. The reads C-9 and N-3 need, plus the upsert of spec 04 §3.5 —
 * the one write in the system whose failure is a business answer and not a bug.
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

  /**
   * Two statements, and it has to be two.
   *
   * The single `INSERT … ON CONFLICT … DO UPDATE SET quantity = quantity +
   * excluded.quantity` of spec 04 §3.5 **cannot work for a negative delta**:
   * Postgres runs `ExecConstraints` over the *proposed* tuple before it
   * resolves the conflict, so a row carrying −5 trips
   * `stock_balance_i4_non_negative` and never reaches the DO UPDATE that would
   * have left it at 0. The error even says so — "Failing row contains
   * (…, -5.000, INTERNAL)" is the value that was never going to be stored.
   *
   * So: make sure the row is there with a zero, which passes the CHECK under
   * every circumstance, and then add the delta with an UPDATE, where the CHECK
   * sees the merged value and I-4 fires exactly when it should. The INSERT
   * blocks on a concurrent speculative insertion of the same natural key, so by
   * the time it returns the row is settled and the UPDATE — a new snapshot in
   * READ COMMITTED — always finds it. The UPDATE takes the row lock, which is
   * what makes two transactions on the same position serialise instead of both
   * reading a stale balance.
   *
   * Still no prior SELECT: what decides is the constraint, which has no window
   * (spec 12 §4.2).
   */
  async upsertDelta(row: {
    orgId: OrgId;
    nodeId: string;
    productId: string;
    batchId: string | null;
    nodeKind: StockBalanceModel['nodeKind'];
    delta: string;
  }): Promise<StockBalanceModel> {
    try {
      await this.db
        .insertInto('stockBalance')
        .values({
          id: v7(),
          orgId: row.orgId,
          nodeId: row.nodeId,
          productId: row.productId,
          batchId: row.batchId,
          nodeKind: row.nodeKind,
          quantity: '0',
        })
        // Infers the natural-key index, NULLS NOT DISTINCT included, so the
        // most common products in any catalogue get one balance and not many.
        .onConflict((oc) => oc.columns(['orgId', 'nodeId', 'productId', 'batchId']).doNothing())
        .execute();

      let q = this.db
        .updateTable('stockBalance')
        .set({
          quantity: sql<string>`quantity + ${row.delta}::numeric`,
          updatedAt: sql<Date>`now()`,
        })
        .where('orgId', '=', row.orgId)
        .where('nodeId', '=', row.nodeId)
        .where('productId', '=', row.productId);
      q = row.batchId === null ? q.where('batchId', 'is', null) : q.where('batchId', '=', row.batchId);

      return (await q.returningAll().executeTakeFirstOrThrow()) as StockBalanceModel;
    } catch (e) {
      // A hand-written statement does not inherit the family's translation, and
      // the 23514 of I-4 is the whole reason this method has a try at all.
      return translatePgError(e);
    }
  }

  /** One position by its natural key; `batchId` null is part of the key, not a wildcard. */
  findPosition(
    orgId: OrgId, nodeId: string, productId: string, batchId: string | null,
  ): Promise<StockBalanceModel | undefined> {
    let q = this.db
      .selectFrom('stockBalance')
      .selectAll()
      .where('orgId', '=', orgId)
      .where('nodeId', '=', nodeId)
      .where('productId', '=', productId);
    q = batchId === null ? q.where('batchId', 'is', null) : q.where('batchId', '=', batchId);
    return q.executeTakeFirst() as Promise<StockBalanceModel | undefined>;
  }

  /**
   * A subtree, added up by (product, batch). The join is to `node` because a
   * balance knows its node's id and not its path, and the trailing separator is
   * the same one `listUnder` uses — 'BOD-A/Z1' must not drag 'BOD-A/Z10' along.
   * The root itself counts: stock can sit on the zone as well as under it.
   */
  async sumUnder(orgId: OrgId, path: string, productId?: string): Promise<SubtreeTotalRow[]> {
    let q = this.db
      .selectFrom('stockBalance')
      .innerJoin('node', (join) =>
        join.onRef('node.id', '=', 'stockBalance.nodeId').onRef('node.orgId', '=', 'stockBalance.orgId'),
      )
      .select(({ fn }) => [
        'stockBalance.productId as productId',
        'stockBalance.batchId as batchId',
        fn.sum<string>('stockBalance.quantity').as('quantity'),
      ])
      .where('stockBalance.orgId', '=', orgId)
      .where('stockBalance.nodeKind', 'in', ['INTERNAL', 'CUSTODY'])
      .where((eb) =>
        eb.or([eb('node.path', '=', path), eb('node.path', 'like', `${escapeLike(path)}/%`)]),
      )
      .groupBy(['stockBalance.productId', 'stockBalance.batchId']);
    if (productId !== undefined) q = q.where('stockBalance.productId', '=', productId);
    return q.orderBy('stockBalance.productId').execute();
  }

  /** I-9: how much of a batch sits in custodial nodes right now. */
  async custodialTotal(orgId: OrgId, batchId: string): Promise<string> {
    const row = await this.db
      .selectFrom('stockBalance')
      .select(({ fn }) => fn.sum<string>('quantity').as('total'))
      .where('orgId', '=', orgId)
      .where('batchId', '=', batchId)
      .where('nodeKind', 'in', ['INTERNAL', 'CUSTODY'])
      .executeTakeFirst();
    return row?.total ?? '0';
  }
}
