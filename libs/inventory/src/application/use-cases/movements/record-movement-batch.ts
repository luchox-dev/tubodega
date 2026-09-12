import { Inject, Injectable } from '@nestjs/common';
import {
  CLOCK, EVENT_PUBLISHER, ID_GENERATOR,
  type Clock, type DomainEvent, type EventPublisher, type IdGenerator,
} from '@app/common';
import { Action, requireAction, type RequestContext } from '@app/tenancy';
import { BatchTooLargeError } from '../../../domain/errors.js';
import type { Movement } from '../../../domain/movement.js';
import type { Node } from '../../../domain/node.js';
import type { StockPosition } from '../../../domain/stock-position.js';
import { MOVEMENT_REPOSITORY, type MovementRepository } from '../../ports/movement.repository.js';
import {
  STOCK_BALANCE_REPOSITORY, type BalanceDelta, type StockBalanceRepository,
} from '../../ports/stock-balance.repository.js';
import {
  RecordMovement, applyOrExplain, movementEvents,
  type PreparedMovement, type RecordMovementInput,
} from './record-movement.js';

/** Spec 12 §4.2. What a spreadsheet of opening balances weighs, and no more. */
export const MAX_BATCH_MOVEMENTS = 500;

export interface RecordMovementBatchInput {
  readonly movements: readonly RecordMovementInput[];
}

export interface RecordedBatch {
  readonly movements: Movement[];
  readonly balances: StockPosition[];
}

const naturalKey = (d: { nodeId: string; productId: string; batchId?: string }) =>
  `${d.nodeId}|${d.productId}|${d.batchId ?? ''}`;

/**
 * **All or nothing, in one transaction.** What the opening-balance import uses,
 * and what the CONFIRM of spec 13 will use — which in the MVP emits a single
 * movement per instance, but comes through here so that the day a process emits
 * several there is no door to change.
 */
@Injectable()
export class RecordMovementBatch {
  constructor(
    private readonly record: RecordMovement,
    @Inject(MOVEMENT_REPOSITORY) private readonly movements: MovementRepository,
    @Inject(STOCK_BALANCE_REPOSITORY) private readonly balances: StockBalanceRepository,
    @Inject(EVENT_PUBLISHER) private readonly events: EventPublisher,
    @Inject(ID_GENERATOR) private readonly ids: IdGenerator,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(ctx: RequestContext, input: RecordMovementBatchInput): Promise<RecordedBatch> {
    requireAction(ctx, Action.RECORD_MOVEMENT);
    if (input.movements.length > MAX_BATCH_MOVEMENTS) {
      throw new BatchTooLargeError(input.movements.length, MAX_BATCH_MOVEMENTS);
    }

    // One recordedAt for the whole request: they were all written at once, and
    // giving them different clock readings would be a lie about the same fact.
    const recordedAt = this.clock.now();
    const placedSerials = new Set<string>();
    const prepared: PreparedMovement[] = [];
    for (const one of input.movements) {
      prepared.push(await this.record.assemble(ctx, one, recordedAt, placedSerials));
    }

    await this.movements.appendMany(prepared.map((p) => p.movement));

    // Decision D-39: the deltas of the N movements are added up by natural key
    // and applied **once**. N separate calls would be N savepoints, and two
    // lines onto the same bin would block on each other inside the very same
    // transaction.
    const nodes = new Map<string, Node>();
    const totals = new Map<string, BalanceDelta>();
    for (const p of prepared) {
      nodes.set(p.fromNode.id, p.fromNode);
      nodes.set(p.toNode.id, p.toNode);
      for (const d of p.deltas) {
        const seen = totals.get(naturalKey(d));
        totals.set(naturalKey(d), seen === undefined ? d : { ...seen, delta: seen.delta.plus(d.delta) });
      }
    }

    const balances = await applyOrExplain(this.balances, ctx.orgId, [...totals.values()], nodes);

    // Each movement announces itself, with the balances its own two ends ended
    // up at: a consumer routes per fact, not per request.
    const published: DomainEvent[] = [];
    for (const p of prepared) {
      const mine = p.deltas
        .map((d) => balances.find((b) => naturalKey(b) === naturalKey(d)))
        .filter((b): b is StockPosition => b !== undefined);
      published.push(...movementEvents(this.ids, ctx, recordedAt, p, mine));
    }
    await this.events.publish(published);

    return { movements: prepared.map((p) => p.movement), balances };
  }
}
