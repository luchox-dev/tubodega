import {
  err, ok,
  type OrgId, type ProcessInstanceId, type Result, type TraceId, type UserId,
} from '@app/common';
import type { Batch, BatchId, Product, ProductId, TrackingMode } from '@app/catalog';
import { TrackingMode as Mode } from '@app/catalog';
import {
  BatchNotAllowedError, BatchProductMismatchError, BatchRequiredError,
  DueDateNotAllowedError, FutureOccurrenceError, NodeInactiveError,
  NonPositiveQuantityError, ReasonRequiredError, SameNodeError,
  SettlesExceededError, SettlesMismatchError, SettlesRequiredError,
} from './errors.js';
import type { MovementId, NodeId } from './ids.js';
import { NodeKind, type Node } from './node.js';
import type { Quantity } from './quantity.js';

/** I-14: a phone whose clock drifts still records real facts (spec 02 §9). */
export const CLOCK_TOLERANCE_MINUTES = 5;
const TOLERANCE_MS = CLOCK_TOLERANCE_MINUTES * 60_000;

/**
 * The boundary nodes whose movements are corrections, and therefore have to say
 * why (decision D-36). By `code`, because `Movement.create` holds both nodes
 * resolved — a list of uuids at the edge would have to resolve them a second
 * time and would drift from the seeder. `consumption` is not here on purpose:
 * using something up is a physical fact, not a correction.
 */
export const REASON_REQUIRED_CODES: readonly string[] = ['adjustment-in', 'adjustment-out', 'shrinkage'];

export interface CreateMovementInput {
  readonly id: MovementId;
  readonly orgId: OrgId;
  /** Resolved, not just its id: it carries the trackingMode I-8 needs. */
  readonly product: Product;
  readonly batch?: Batch;
  /** Resolved: they carry the kind I-11, I-16 and I-17 need, and the readable path. */
  readonly fromNode: Node;
  readonly toNode: Node;
  readonly quantity: Quantity;
  readonly occurredAt: Date;
  readonly recordedAt: Date;
  readonly actorId: UserId;
  readonly reason?: string;
  readonly dueAt?: Date;
  readonly reversesId?: MovementId;
  /** Resolved: the check-out plus what is still owed on it (I-17, I-18). */
  readonly settles?: { readonly movement: Movement; readonly pending: Quantity };
  readonly processInstanceId?: ProcessInstanceId;
  readonly traceId: TraceId;
}

export interface RehydrateMovementProps {
  readonly id: MovementId;
  readonly orgId: OrgId;
  readonly productId: ProductId;
  readonly batchId?: BatchId;
  readonly fromNodeId: NodeId;
  readonly toNodeId: NodeId;
  readonly quantity: Quantity;
  readonly occurredAt: Date;
  readonly recordedAt: Date;
  readonly actorId: UserId;
  readonly reason?: string;
  readonly dueAt?: Date;
  readonly reversesId?: MovementId;
  readonly settlesId?: MovementId;
  readonly processInstanceId?: ProcessInstanceId;
  readonly traceId: TraceId;
  readonly trackingMode: TrackingMode;
  readonly fromNodeKind: NodeKind;
  readonly toNodeKind: NodeKind;
}

/**
 * One entry of the ledger: `quantity` of a product left one node and entered
 * another. Immutable — no setters, no copy-with (I-3) — and deliberately
 * ignorant of *why*: that a movement "is a receipt" is an interpretation that
 * comes from the kind of the nodes involved, never a property of the movement.
 * Any `operationType` column here would be the beginning of the end of that.
 */
export class Movement {
  private constructor(
    readonly id: MovementId,
    readonly orgId: OrgId,
    readonly productId: ProductId,
    readonly batchId: BatchId | undefined,
    readonly fromNodeId: NodeId,
    readonly toNodeId: NodeId,
    readonly quantity: Quantity,
    readonly occurredAt: Date,
    readonly recordedAt: Date,
    readonly actorId: UserId,
    readonly reason: string | undefined,
    readonly dueAt: Date | undefined,
    readonly reversesId: MovementId | undefined,
    readonly settlesId: MovementId | undefined,
    readonly processInstanceId: ProcessInstanceId | undefined,
    readonly traceId: TraceId,
    // Copies, not the source of truth. They exist so the CHECKs of I-8, I-11
    // and I-17 are enforceable without reading another table (spec 04 §3.4),
    // which is also why I-15 locks the trackingMode and MoveNode locks the kind.
    readonly trackingMode: TrackingMode,
    readonly fromNodeKind: NodeKind,
    readonly toNodeKind: NodeKind,
  ) {}

  static create(input: CreateMovementInput): Result<Movement> {
    const { product, batch, fromNode, toNode, quantity, settles } = input;

    if (fromNode.id === toNode.id) return err(new SameNodeError(fromNode.path));
    if (!quantity.isPositive()) return err(new NonPositiveQuantityError(quantity.toString()));

    for (const node of [fromNode, toNode]) {
      if (!node.canReceiveMovements()) return err(new NodeInactiveError(node.path));
    }

    const tracked = product.trackingMode !== Mode.QUANTITY;
    if (tracked && !batch) return err(new BatchRequiredError(product.sku, product.trackingMode));
    if (!tracked && batch) return err(new BatchNotAllowedError(product.sku));
    if (batch && batch.productId !== product.id) return err(new BatchProductMismatchError(product.sku));

    if (input.dueAt && toNode.kind !== NodeKind.CUSTODY) return err(new DueDateNotAllowedError(toNode.path));

    if (input.occurredAt.getTime() > input.recordedAt.getTime() + TOLERANCE_MS) {
      return err(new FutureOccurrenceError(CLOCK_TOLERANCE_MINUTES));
    }

    // I-17. A reversal also leaves the custody and settles nothing — it is the
    // undoing of a check-out, not a return against one.
    if (fromNode.kind === NodeKind.CUSTODY && !settles && !input.reversesId) {
      return err(new SettlesRequiredError(fromNode.path));
    }
    if (settles) {
      const checkOut = settles.movement;
      if (checkOut.toNodeId !== fromNode.id) {
        return err(new SettlesMismatchError('ese préstamo no fue a esta custodia'));
      }
      if (checkOut.productId !== product.id) {
        return err(new SettlesMismatchError('es de otro producto'));
      }
      if (checkOut.batchId !== batch?.id) {
        return err(new SettlesMismatchError('es de otro lote'));
      }
      // I-18. An aggregate, so no CHECK can hold it: the pending amount is the
      // check-out's quantity minus everything that has settled it so far.
      if (quantity.compare(settles.pending) === 1) {
        return err(new SettlesExceededError(settles.pending.toString(), quantity.toString()));
      }
    }

    const reason = input.reason?.trim() || undefined;
    if (!reason) {
      const correction = [fromNode, toNode].find((n) => REASON_REQUIRED_CODES.includes(n.code));
      if (correction) return err(new ReasonRequiredError(correction.code));
    }

    return ok(
      new Movement(
        input.id, input.orgId, product.id, batch?.id, fromNode.id, toNode.id, quantity,
        input.occurredAt, input.recordedAt, input.actorId, reason, input.dueAt,
        input.reversesId, settles?.movement.id, input.processInstanceId, input.traceId,
        product.trackingMode, fromNode.kind, toNode.kind,
      ),
    );
  }

  static rehydrate(p: RehydrateMovementProps): Movement {
    return new Movement(
      p.id, p.orgId, p.productId, p.batchId, p.fromNodeId, p.toNodeId, p.quantity,
      p.occurredAt, p.recordedAt, p.actorId, p.reason, p.dueAt, p.reversesId, p.settlesId,
      p.processInstanceId, p.traceId, p.trackingMode, p.fromNodeKind, p.toNodeKind,
    );
  }

  /**
   * I-12: the exact inverse. Nodes swapped, product, batch and quantity kept,
   * and a brand-new entry — nothing here mutates, because the way to undo a
   * movement is to write another one (I-3).
   *
   * `settlesId` is not copied: it would claim this reversal settles the
   * check-out the original settled, and it does the opposite — it re-opens it.
   * `dueAt` is not copied either: stock coming back is not on loan.
   */
  reverse(p: { id: MovementId; by: UserId; at: Date; reason: string }): Movement {
    return new Movement(
      p.id, this.orgId, this.productId, this.batchId,
      this.toNodeId, this.fromNodeId, this.quantity,
      p.at, p.at, p.by, p.reason, undefined, this.id, undefined,
      this.processInstanceId, this.traceId,
      this.trackingMode, this.toNodeKind, this.fromNodeKind,
    );
  }
}
