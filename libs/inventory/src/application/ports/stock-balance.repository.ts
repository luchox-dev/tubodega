import type { Cursor, OrgId, Page } from '@app/common';
import type { BatchId, ProductId } from '@app/catalog';
import type { NodeId, NodePath } from '../../domain/ids.js';
import type { NodeKind } from '../../domain/node.js';
import type { Quantity } from '../../domain/quantity.js';
import type { StockPosition } from '../../domain/stock-position.js';

/**
 * The read row, not the entity of spec 12 §2: that one carries `Quantity`, and
 * `Quantity` belongs to the ledger (wave 3). Plan 4 declares only the two reads
 * N-3 needs; `query`, `find`, `sumUnder` and `applyDelta` arrive with it.
 */
export interface StockPositionRow {
  readonly productId: string;
  readonly batchId?: string;
  readonly quantity: string;
}

export interface StockScope {
  readonly productId?: string;
  readonly nodeId?: NodeId;
}

/** One side of a double entry, with sign: negative at the origin (decision D-32). */
export interface BalanceDelta {
  readonly nodeId: NodeId;
  readonly productId: ProductId;
  readonly batchId?: BatchId;
  /** Denormalised, because it is what the CHECK of I-4 reads. */
  readonly nodeKind: NodeKind;
  readonly delta: Quantity;
}

/** What `GET /v1/stock` may filter by (spec 12 §4.3). */
export interface StockQuery {
  readonly productId?: ProductId;
  readonly nodeId?: NodeId;
  /** Aggregated over a subtree; the use case resolves the id to a path. */
  readonly underPath?: NodePath;
  readonly batchId?: BatchId;
  /** Excludes SOURCE and TERMINAL: their balance is a running total, not stock. */
  readonly custodialOnly?: boolean;
  /** Defaults to true at the edge. */
  readonly nonZeroOnly?: boolean;
}

export interface StockPage {
  readonly limit: number;
  readonly cursor?: Cursor;
}

/**
 * I-4, raised by whoever holds the balances — the Kysely repository from the
 * CHECK, the in-memory double from its own arithmetic — and caught by
 * `RecordMovement`, the only place that turns it into `InsufficientStockError`.
 *
 * Deliberately **not** a `DomainError` (decision D-35): the exception filter
 * recognises those by duck typing, so a signal that escaped a use case would
 * reach the client as a problem+json with no `available` and no `requested`.
 * Not being one makes escaping a loud 500 instead.
 */
export class InsufficientStockSignal extends Error {
  constructor(
    readonly position: {
      readonly nodeId: NodeId;
      readonly productId: ProductId;
      readonly batchId?: BatchId;
      readonly available: Quantity;
    },
  ) {
    super(`insufficient stock at node ${position.nodeId}`);
    this.name = 'InsufficientStockSignal';
  }
}

export interface StockBalanceRepository {
  /** C-9 and N-3: is there any, without asking how much. */
  hasAnyStock(orgId: OrgId, scope: StockScope): Promise<boolean>;
  /**
   * What blocks a deactivation. Capped, because one shelf can legitimately hold
   * thousands of (product, batch) positions and the error has to stay an error
   * rather than become a dump.
   */
  positionsIn(orgId: OrgId, scope: StockScope, cap: number): Promise<readonly StockPositionRow[]>;

  // ── The ledger half (wave 3). These carry `Quantity`, which is why they could
  // not exist in plan 4; the two reads above keep their row shape so that
  // DeactivateNode and C-9 do not have to be rewritten (decision D-34).

  find(orgId: OrgId, nodeId: NodeId, productId: ProductId, batchId?: BatchId): Promise<StockPosition | null>;
  query(orgId: OrgId, query: StockQuery, page: StockPage): Promise<Page<StockPosition>>;
  /** Aggregated by (product, batch) over a subtree, for `GET /v1/stock?under=`. */
  sumUnder(orgId: OrgId, path: NodePath, productId?: ProductId): Promise<StockPosition[]>;
  /** I-9: how many units of a SERIAL batch sit in custodial nodes right now. */
  custodialTotal(orgId: OrgId, batchId: BatchId): Promise<Quantity>;
  /**
   * Every balance change of one transaction at once, **ordered by the natural
   * key** `(nodeId, productId, batchId)` by the repository itself. That the
   * order is its responsibility and not the caller's is what makes it
   * impossible for a use case to cause a deadlock by carelessness.
   *
   * Raises `InsufficientStockSignal` when a custodial node would go negative.
   */
  applyDelta(orgId: OrgId, deltas: readonly BalanceDelta[]): Promise<StockPosition[]>;
}

export const STOCK_BALANCE_REPOSITORY = Symbol('StockBalanceRepository');
