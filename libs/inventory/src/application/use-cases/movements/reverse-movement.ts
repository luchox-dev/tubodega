import { Inject, Injectable } from '@nestjs/common';
import {
  CLOCK, EVENT_PUBLISHER, ID_GENERATOR,
  type Clock, type EventPublisher, type IdGenerator,
} from '@app/common';
import {
  BATCH_REPOSITORY, PRODUCT_REPOSITORY, ProductNotFoundError,
  type BatchRepository, type ProductRepository,
} from '@app/catalog';
import { Action, requireAction, type RequestContext } from '@app/tenancy';
import { AlreadyReversedError, MovementNotFoundError, NodeNotFoundError } from '../../../domain/errors.js';
import type { MovementId } from '../../../domain/ids.js';
import type { Movement } from '../../../domain/movement.js';
import type { Node } from '../../../domain/node.js';
import type { StockPosition } from '../../../domain/stock-position.js';
import { MOVEMENT_REPOSITORY, type MovementRepository } from '../../ports/movement.repository.js';
import { NODE_REPOSITORY, type NodeRepository } from '../../ports/node.repository.js';
import { STOCK_BALANCE_REPOSITORY, type StockBalanceRepository } from '../../ports/stock-balance.repository.js';
import { applyOrExplain, deltasOf, entersFromBoundary, guardSerial, movementEvents } from './record-movement.js';

export interface ReverseMovementInput {
  readonly movementId: MovementId;
  /** Mandatory: a correction with no explanation is of no use to whoever audits later. */
  readonly reason: string;
}

export interface ReversedMovement {
  readonly reversal: Movement;
  readonly balances: StockPosition[];
}

/**
 * The only way to undo a movement, because movements are never updated or
 * deleted (I-3). A compensation can leave the balance short — if the stock has
 * already moved elsewhere — and then it fails like any other movement. The way
 * out is to bring the stock back first: the system does not invent goods to
 * make a correction balance.
 */
@Injectable()
export class ReverseMovement {
  constructor(
    @Inject(MOVEMENT_REPOSITORY) private readonly movements: MovementRepository,
    @Inject(STOCK_BALANCE_REPOSITORY) private readonly balances: StockBalanceRepository,
    @Inject(NODE_REPOSITORY) private readonly nodes: NodeRepository,
    // I-9 has to hold on this path too (decision D-41), and asking it needs the
    // product's tracking mode and the batch's serial.
    @Inject(PRODUCT_REPOSITORY) private readonly products: ProductRepository,
    @Inject(BATCH_REPOSITORY) private readonly batches: BatchRepository,
    @Inject(EVENT_PUBLISHER) private readonly events: EventPublisher,
    @Inject(ID_GENERATOR) private readonly ids: IdGenerator,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(ctx: RequestContext, input: ReverseMovementInput): Promise<ReversedMovement> {
    requireAction(ctx, Action.REVERSE_MOVEMENT);

    const original = await this.movements.findById(ctx.orgId, input.movementId);
    if (!original) throw new MovementNotFoundError();
    // I-13, checked here and held by the partial UNIQUE underneath.
    if (await this.movements.existsReversalOf(ctx.orgId, original.id)) {
      throw new AlreadyReversedError(original.id);
    }

    const at = this.clock.now();
    const reversal = original.reverse({
      id: this.ids.next() as MovementId,
      by: ctx.userId,
      at,
      reason: input.reason,
    });

    const found = await this.nodes.findManyByIds(ctx.orgId, [reversal.fromNodeId, reversal.toNodeId]);
    const fromNode = found.get(reversal.fromNodeId);
    const toNode = found.get(reversal.toNodeId);
    if (!fromNode || !toNode) throw new NodeNotFoundError();

    await this.guardSerial(ctx, reversal, fromNode, toNode);

    await this.movements.append(reversal);
    const prepared = { movement: reversal, deltas: deltasOf(reversal, fromNode, toNode), fromNode, toNode };
    const balances = await applyOrExplain(this.balances, ctx.orgId, prepared.deltas, found);

    await this.events.publish(movementEvents(this.ids, ctx, at, prepared, balances, { reversal: true }));
    return { reversal, balances };
  }

  /**
   * The compensation of a dispatch is an entry coming in from a TERMINAL, so it
   * can put a serial back on a shelf where the same serial has meanwhile been
   * received again — and nothing downstream would notice. The cheap test on the
   * two ends goes first so an ordinary reversal still costs no extra reads.
   */
  private async guardSerial(
    ctx: RequestContext, reversal: Movement, fromNode: Node, toNode: Node,
  ): Promise<void> {
    if (reversal.batchId === undefined || !entersFromBoundary(fromNode, toNode)) return;
    const product = await this.products.findById(ctx.orgId, reversal.productId);
    if (!product) throw new ProductNotFoundError();
    const batch = await this.batches.findById(ctx.orgId, reversal.batchId);
    await guardSerial(this.balances, ctx.orgId, product, batch ?? undefined, fromNode, toNode);
  }
}
