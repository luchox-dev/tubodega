import type { Cursor, OrgId, Page, UserId } from '@app/common';
import type { BatchId, ProductId } from '@app/catalog';
import type { MovementId, NodeId } from '../../domain/ids.js';
import type { Movement } from '../../domain/movement.js';
import type { Quantity } from '../../domain/quantity.js';

/** What `GET /v1/movements` may filter by; anything else is 400 (spec 03 §8). */
export interface MovementFilter {
  readonly productId?: ProductId;
  /** Matches either end: "everything that touched this shelf". */
  readonly nodeId?: NodeId;
  readonly batchId?: BatchId;
  readonly actorId?: UserId;
  readonly from?: Date;
  readonly to?: Date;
}

/**
 * Only `occurredAt` (decision D-37). It is the one indexed column, and this is
 * the table that grows fastest in the system: offering the sorts the other
 * listings offer would be inviting a seq scan over it.
 */
export interface MovementPage {
  readonly limit: number;
  readonly cursor?: Cursor;
  readonly sort: { readonly field: 'occurredAt'; readonly dir: 'asc' | 'desc' };
}

/** A loan that has not fully come back. `overdue` is the use case's to decide:
 *  the clock does not belong in infrastructure. */
export interface OpenCustodyRow {
  readonly checkOut: Movement;
  readonly pending: Quantity;
}

export interface OpenCustodyFilter {
  readonly nodeId?: NodeId;
  /** Only loans due before this instant; the use case passes `now` for `overdueOnly`. */
  readonly overdueBefore?: Date;
}

/**
 * The ledger's way out.
 *
 * **No update. No delete.** Not an oversight: it is I-3 expressed in the type.
 * A programmer who wants to modify a movement does not find the method, and
 * that is the moment they read spec 12 and understand they must compensate.
 */
export interface MovementRepository {
  findById(orgId: OrgId, id: MovementId): Promise<Movement | null>;
  /** I-13: a movement is compensated at most once. */
  existsReversalOf(orgId: OrgId, id: MovementId): Promise<boolean>;
  /**
   * I-18. The sum of what settles a check-out, ignoring the check-ins that were
   * themselves compensated — a reversed return re-opens the loan (spec 04 §3.4).
   */
  settledQuantity(orgId: OrgId, checkOutId: MovementId): Promise<Quantity>;
  listOpenCustodies(orgId: OrgId, filter: OpenCustodyFilter, page: MovementPage): Promise<Page<OpenCustodyRow>>;
  /** Serves C-8: a product with history does not change its trackingMode (I-15). */
  countByProduct(orgId: OrgId, productId: ProductId): Promise<number>;
  list(orgId: OrgId, filter: MovementFilter, page: MovementPage): Promise<Page<Movement>>;
  append(movement: Movement): Promise<void>;
  appendMany(movements: readonly Movement[]): Promise<void>;
}

export const MOVEMENT_REPOSITORY = Symbol('MovementRepository');
