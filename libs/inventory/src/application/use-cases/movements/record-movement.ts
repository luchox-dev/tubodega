import { Inject, Injectable } from '@nestjs/common';
import {
  CLOCK, EVENT_PUBLISHER, ID_GENERATOR, unwrap,
  type Clock, type DomainEvent, type EventPublisher, type IdGenerator,
  type OrgId, type ProcessInstanceId,
} from '@app/common';
import {
  BATCH_REPOSITORY, BatchNotFoundError, PRODUCT_REPOSITORY, ProductNotFoundError, TrackingMode,
  type Batch, type BatchId, type BatchRepository, type Product, type ProductId,
  type ProductRepository,
} from '@app/catalog';
import { Action, requireAction, type RequestContext } from '@app/tenancy';
import {
  InsufficientStockError, MovementNotFoundError, NodeNotFoundError, ProductInactiveError,
  SerialAlreadyPlacedError,
} from '../../../domain/errors.js';
import type { MovementId, NodeId } from '../../../domain/ids.js';
import { Movement } from '../../../domain/movement.js';
import { Quantity } from '../../../domain/quantity.js';
import { isCustodialKind, type Node } from '../../../domain/node.js';
import type { StockPosition } from '../../../domain/stock-position.js';
import { inventoryEvent } from '../../events.js';
import { MOVEMENT_REPOSITORY, type MovementRepository } from '../../ports/movement.repository.js';
import { NODE_REPOSITORY, type NodeRepository } from '../../ports/node.repository.js';
import {
  InsufficientStockSignal, STOCK_BALANCE_REPOSITORY,
  type BalanceDelta, type StockBalanceRepository,
} from '../../ports/stock-balance.repository.js';

export interface RecordMovementInput {
  /** The client's UUIDv7; generated here when absent (spec 12 §2). */
  readonly id?: MovementId;
  readonly productId: ProductId;
  readonly batchId?: BatchId;
  readonly fromNodeId: NodeId;
  readonly toNodeId: NodeId;
  readonly quantity: string;
  readonly occurredAt: Date;
  readonly reason?: string;
  readonly dueAt?: Date;
  readonly settlesId?: MovementId;
  readonly processInstanceId?: ProcessInstanceId;
}

export interface RecordedMovement {
  readonly movement: Movement;
  readonly balances: StockPosition[];
}

/** One movement resolved and validated, not yet written. The seam the batch uses. */
export interface PreparedMovement {
  readonly movement: Movement;
  readonly deltas: readonly BalanceDelta[];
  readonly fromNode: Node;
  readonly toNode: Node;
}

const naturalKey = (d: { nodeId: string; productId: string; batchId?: string }) =>
  `${d.nodeId}|${d.productId}|${d.batchId ?? ''}`;

/**
 * Turns the signal the balances raise into the error the operator reads. The
 * detail names the node by its **path**, not its uuid, because that is the
 * message that ends up on the screen (spec 12 §9).
 */
export async function applyOrExplain(
  balances: StockBalanceRepository,
  orgId: OrgId,
  deltas: readonly BalanceDelta[],
  nodes: ReadonlyMap<string, Node>,
): Promise<StockPosition[]> {
  try {
    return await balances.applyDelta(orgId, deltas);
  } catch (e) {
    if (!(e instanceof InsufficientStockSignal)) throw e;
    const { nodeId, available } = e.position;
    const failed = deltas.find((d) => naturalKey(d) === naturalKey(e.position));
    throw new InsufficientStockError(
      nodes.get(nodeId)?.path ?? nodeId,
      available.toString(),
      // Negative at the origin, and what was asked for is its magnitude.
      failed ? failed.delta.negated().toString() : available.toString(),
    );
  }
}

/** A balance that crossed zero in either direction — and only then (spec 12 §8). */
const crossedZero = (after: Quantity, delta: Quantity): boolean =>
  after.minus(delta).isZero() !== after.isZero();

/** The events one written movement produces, balances included (spec 05 §5). */
export function movementEvents(
  ids: IdGenerator,
  ctx: RequestContext,
  at: Date,
  p: PreparedMovement,
  balances: readonly StockPosition[],
  o: { readonly reversal?: boolean; readonly pending?: Quantity } = {},
): DomainEvent[] {
  const { movement } = p;
  const event = (type: Parameters<typeof inventoryEvent>[1], data: Record<string, unknown>) =>
    inventoryEvent(ids, type, ctx.orgId, ctx.traceId, at, data);

  const payload = {
    movementId: movement.id,
    productId: movement.productId,
    batchId: movement.batchId ?? null,
    fromNodeId: movement.fromNodeId,
    toNodeId: movement.toNodeId,
    quantity: movement.quantity.toString(),
    actorId: movement.actorId,
    balances: balances.map((b) => ({
      nodeId: b.nodeId,
      productId: b.productId,
      batchId: b.batchId ?? null,
      quantity: b.quantity.toString(),
    })),
  };

  const out = [event(o.reversal === true ? 'stock.reversed' : 'stock.moved', payload)];

  // Only custodial nodes, and only when the balance crosses zero: a TERMINAL
  // going from 0 to 15 is a running total, not stock appearing on a shelf.
  for (const delta of p.deltas) {
    if (!isCustodialKind(delta.nodeKind)) continue;
    const after = balances.find((b) => naturalKey(b) === naturalKey(delta));
    if (after === undefined || !crossedZero(after.quantity, delta.delta)) continue;
    out.push(event('stock.balance_changed', {
      nodeId: delta.nodeId,
      productId: delta.productId,
      batchId: delta.batchId ?? null,
      quantity: after.quantity.toString(),
    }));
  }

  if (p.toNode.kind === 'CUSTODY') {
    out.push(event('custody.checked_out', {
      movementId: movement.id,
      nodeId: movement.toNodeId,
      productId: movement.productId,
      quantity: movement.quantity.toString(),
      dueAt: movement.dueAt?.toISOString() ?? null,
    }));
  }
  if (p.fromNode.kind === 'CUSTODY') {
    out.push(event('custody.checked_in', {
      movementId: movement.id,
      nodeId: movement.fromNodeId,
      productId: movement.productId,
      quantity: movement.quantity.toString(),
      settlesId: movement.settlesId ?? null,
      pending: (o.pending ?? Quantity.zero()).toString(),
    }));
  }
  return out;
}

/**
 * **The central operation of the system.** The sequence of spec 12 §4.2, inside
 * the transaction the edge already opened.
 *
 * The stock check is deliberately *not* a prior SELECT: the upsert is attempted
 * and the CHECK decides. A SELECT followed by an INSERT has a window in which
 * another transaction can consume the stock, and the result is a negative
 * balance under concurrency — the classic defect of this kind of system. The
 * constraint has no window.
 */
@Injectable()
export class RecordMovement {
  constructor(
    @Inject(MOVEMENT_REPOSITORY) private readonly movements: MovementRepository,
    @Inject(STOCK_BALANCE_REPOSITORY) private readonly balances: StockBalanceRepository,
    @Inject(NODE_REPOSITORY) private readonly nodes: NodeRepository,
    // Straight from the catalogue, no bridge port: R-2 allows inventory → catalog
    // and CreateNode already injects CUSTOM_FIELD_REPOSITORY the same way (D-38).
    @Inject(PRODUCT_REPOSITORY) private readonly products: ProductRepository,
    @Inject(BATCH_REPOSITORY) private readonly batches: BatchRepository,
    @Inject(EVENT_PUBLISHER) private readonly events: EventPublisher,
    @Inject(ID_GENERATOR) private readonly ids: IdGenerator,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(ctx: RequestContext, input: RecordMovementInput): Promise<RecordedMovement> {
    requireAction(ctx, Action.RECORD_MOVEMENT);
    const recordedAt = this.clock.now();
    const prepared = await this.assemble(ctx, input, recordedAt);

    await this.movements.append(prepared.movement);
    const balances = await applyOrExplain(
      this.balances, ctx.orgId, prepared.deltas,
      new Map([[prepared.fromNode.id, prepared.fromNode], [prepared.toNode.id, prepared.toNode]]),
    );

    await this.events.publish(
      movementEvents(
        this.ids, ctx, recordedAt, prepared, balances,
        prepared.pending !== undefined ? { pending: prepared.pending } : {},
      ),
    );
    return { movement: prepared.movement, balances };
  }

  /**
   * Steps 1-5 and 7 of the sequence: resolve, validate, build the entry and its
   * two deltas. Public because `RecordMovementBatch` prepares N of these and
   * writes them once (decision D-39) — nothing else should call it.
   *
   * `placedSerials` carries the SERIAL batches a batch already placed in this
   * same call, so I-9 holds *within* one request too: `custodialTotal` only
   * sees what is committed.
   */
  async assemble(
    ctx: RequestContext,
    input: RecordMovementInput,
    recordedAt: Date,
    placedSerials: Set<string> = new Set(),
  ): Promise<PreparedMovement & { pending?: Quantity }> {
    const product = await this.products.findById(ctx.orgId, input.productId);
    if (!product) throw new ProductNotFoundError();
    if (!product.active) throw new ProductInactiveError(product.sku);

    // One round trip for both ends, not two.
    const found = await this.nodes.findManyByIds(ctx.orgId, [input.fromNodeId, input.toNodeId]);
    const fromNode = found.get(input.fromNodeId);
    const toNode = found.get(input.toNodeId);
    if (!fromNode || !toNode) throw new NodeNotFoundError();

    let batch: Batch | undefined;
    if (input.batchId !== undefined) {
      batch = (await this.batches.findById(ctx.orgId, input.batchId)) ?? undefined;
      if (!batch) throw new BatchNotFoundError();
    }

    const quantity = unwrap(Quantity.of(input.quantity));
    await guardSerial(this.balances, ctx.orgId, product, batch, fromNode, toNode, placedSerials);

    let settles: { movement: Movement; pending: Quantity } | undefined;
    if (input.settlesId !== undefined) {
      const checkOut = await this.movements.findById(ctx.orgId, input.settlesId);
      if (!checkOut) throw new MovementNotFoundError();
      const settled = await this.movements.settledQuantity(ctx.orgId, checkOut.id);
      settles = { movement: checkOut, pending: checkOut.quantity.minus(settled) };
    }

    const movement = unwrap(
      Movement.create({
        id: input.id ?? (this.ids.next() as MovementId),
        orgId: ctx.orgId,
        product,
        ...(batch !== undefined ? { batch } : {}),
        fromNode, toNode, quantity,
        occurredAt: input.occurredAt,
        recordedAt,
        actorId: ctx.userId,
        ...(input.reason !== undefined ? { reason: input.reason } : {}),
        ...(input.dueAt !== undefined ? { dueAt: input.dueAt } : {}),
        ...(settles !== undefined ? { settles } : {}),
        ...(input.processInstanceId !== undefined ? { processInstanceId: input.processInstanceId } : {}),
        traceId: ctx.traceId,
      }),
    );

    return {
      movement,
      deltas: deltasOf(movement, fromNode, toNode),
      fromNode,
      toNode,
      ...(settles !== undefined ? { pending: settles.pending.minus(quantity) } : {}),
    };
  }
}

/**
 * The only pair of ends that can put a *second* copy of a serial on a shelf:
 * coming in from outside. Moving one between two custodial nodes is the same
 * unit leaving and entering in one entry, and the CHECK of I-4 covers that.
 */
export const entersFromBoundary = (fromNode: Node, toNode: Node): boolean =>
  toNode.isCustodial() && !fromNode.isCustodial();

/**
 * I-9 with a real mechanism (spec 02 §9: "domain validation").
 *
 * A free function and not a method because **both** ways of writing an entry
 * have to ask it (decision D-41). Reversing a dispatch is an entry coming in
 * from a TERMINAL, so it can put back a serial that has meanwhile been received
 * again somewhere else — and `custodialTotal` reads zero right up until it does.
 *
 * `placedSerials` carries the SERIAL batches one call has already placed, so
 * I-9 holds *within* a single batched request too: `custodialTotal` only sees
 * what is committed.
 */
export async function guardSerial(
  balances: StockBalanceRepository,
  orgId: OrgId,
  product: Product,
  batch: Batch | undefined,
  fromNode: Node,
  toNode: Node,
  placedSerials: Set<string> = new Set(),
): Promise<void> {
  if (product.trackingMode !== TrackingMode.SERIAL || batch === undefined) return;
  if (!entersFromBoundary(fromNode, toNode)) return;
  const already =
    placedSerials.has(batch.id) || (await balances.custodialTotal(orgId, batch.id)).isPositive();
  if (already) throw new SerialAlreadyPlacedError(batch.serial ?? batch.id);
  placedSerials.add(batch.id);
}

/** Double entry: what leaves the origin is exactly what enters the destination. */
export function deltasOf(movement: Movement, fromNode: Node, toNode: Node): BalanceDelta[] {
  const common = {
    productId: movement.productId,
    ...(movement.batchId !== undefined ? { batchId: movement.batchId } : {}),
  };
  return [
    { ...common, nodeId: fromNode.id, nodeKind: fromNode.kind, delta: movement.quantity.negated() },
    { ...common, nodeId: toNode.id, nodeKind: toNode.kind, delta: movement.quantity },
  ];
}
