import { Inject, Injectable } from '@nestjs/common';
import { CLOCK, type Clock, type ProcessInstanceId } from '@app/common';
import { AttachMedia, CreateBatch, type BatchId } from '@app/catalog';
import { RecordMovementBatch, type Movement, type RecordMovementInput } from '@app/inventory';
import type { RequestContext } from '@app/tenancy';
import type { Effect } from '../domain/effects.js';
import type { MovementDraft } from '../domain/drafts.js';

/**
 * The engine produces effects; this runs them, by calling the **public use
 * cases** of the other modules with their invariants intact — inside the
 * transaction of the request, which is what makes P-7 true (spec 13 §4.3).
 *
 * The order is `CREATE_BATCH` → `EMIT_MOVEMENTS` → `ATTACH_MEDIA`, and it is
 * not cosmetic: the movement needs the id of a batch that does not exist yet.
 *
 * It is also the only place that knows two things the draft deliberately does
 * not carry: `occurredAt`, which is the instant of confirming and not one the
 * engine has been dragging since the instance opened (spec 13 §2); and the
 * `processInstanceId`, which is what finally fills the column `full_schema`
 * has been holding open since plan 5.
 */
@Injectable()
export class EffectApplier {
  constructor(
    private readonly createBatch: CreateBatch,
    private readonly recordMovements: RecordMovementBatch,
    private readonly attachMedia: AttachMedia,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async apply(
    ctx: RequestContext, instanceId: ProcessInstanceId, effects: readonly Effect[],
  ): Promise<Movement[]> {
    // A mutable copy of the drafts, because CREATE_BATCH writes into one of
    // them by index. Nothing outside this method sees it.
    const drafts: MovementDraft[] = [
      ...(effects.find((e) => e.kind === 'EMIT_MOVEMENTS')?.drafts ?? []),
    ];

    for (const effect of effects) {
      if (effect.kind !== 'CREATE_BATCH') continue;
      // `CreateBatch` demands the `CREATE_BATCH` action, which the OPERATOR
      // has: whoever confirms a receipt is the operator (spec 13 §4.3).
      const batch = await this.createBatch.execute(ctx, {
        productId: effect.draft.productId,
        ...(effect.draft.lotCode !== undefined ? { lotCode: effect.draft.lotCode } : {}),
        ...(effect.draft.serial !== undefined ? { serial: effect.draft.serial } : {}),
        ...(effect.draft.expiresAt !== undefined ? { expiresAt: effect.draft.expiresAt } : {}),
      });
      // `feeds` is the index inside EMIT_MOVEMENTS.drafts. Without this link
      // the order of the two effects buys nothing — the batchId would have
      // nowhere to land. Today it is always 0 (spec 13 §3).
      const fed = drafts[effect.feeds];
      if (fed) drafts[effect.feeds] = { ...fed, batchId: batch.id as BatchId };
    }

    let movements: Movement[] = [];
    if (drafts.length > 0) {
      // `RecordMovementBatch` and not `RecordMovement`, even though today an
      // instance produces one line: it is the door the multi-line day already
      // receives a list through, and the one that makes the all-or-nothing of
      // P-7 true with a single `applyDelta`. No idempotency key — the request
      // that completes the step already has one (spec 07 §5).
      const recorded = await this.recordMovements.execute(ctx, {
        movements: drafts.map((d) => this.toInput(d, instanceId)),
      });
      movements = recorded.movements;
    }

    for (const effect of effects) {
      if (effect.kind !== 'ATTACH_MEDIA') continue;
      // The `storageKeys` form, which is the one that demands RECORD_MOVEMENT
      // and not MANAGE_CATALOG (D-14) — and the one that raises the
      // `upload-not-found` of spec 13 §12, because claiming is where the race
      // actually is (D-58).
      await this.attachMedia.execute(ctx, {
        productId: effect.productId,
        storageKeys: effect.storageKeys,
      });
    }

    return movements;
  }

  private toInput(draft: MovementDraft, instanceId: ProcessInstanceId): RecordMovementInput {
    // Non-null assertions would be a lie here: `CONFIRM` already refused the
    // incomplete draft with `incomplete-draft`, so by now the four are there.
    // The casts say "checked upstream" and the e2e proves it end to end.
    return {
      productId: draft.productId!,
      fromNodeId: draft.fromNodeId!,
      toNodeId: draft.toNodeId!,
      quantity: draft.quantity!.toString(),
      occurredAt: this.clock.now(),
      processInstanceId: instanceId,
      ...(draft.batchId !== undefined ? { batchId: draft.batchId } : {}),
      ...(draft.reason !== undefined ? { reason: draft.reason } : {}),
      ...(draft.dueAt !== undefined ? { dueAt: draft.dueAt } : {}),
    };
  }
}
