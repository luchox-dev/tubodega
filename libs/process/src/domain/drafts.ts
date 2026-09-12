import type { BatchId, ProductId } from '@app/catalog';
import type { NodeId, Quantity } from '@app/inventory';

/** A batch that does not exist yet; `CONFIRM` creates it before moving anything. */
export interface BatchDraft {
  readonly productId: ProductId;
  readonly lotCode?: string;
  readonly serial?: string;
  readonly expiresAt?: Date;
}

/**
 * The intent a process accumulates. Every field is optional because it gets
 * filled along the way — the scan puts the product, the quantity step the
 * quantity, the location step the destination — and only `CONFIRM` checks that
 * it is complete and turns it into a real `Movement`.
 *
 * **There is no `occurredAt`.** The effect applier puts it with the `Clock`
 * when it builds the `RecordMovementInput`, which does demand one: the time of
 * the entry is the instant it is confirmed, not one the engine has been
 * dragging since the instance opened — and an instance can have been open
 * since yesterday.
 *
 * There is no `storageKeys` either. Photo keys are not part of the movement:
 * they feed a different effect, and over a product rather than a position.
 */
export interface MovementDraft {
  readonly productId?: ProductId;
  readonly batchId?: BatchId;
  readonly fromNodeId?: NodeId;
  readonly toNodeId?: NodeId;
  readonly quantity?: Quantity;
  readonly reason?: string;
  readonly dueAt?: Date;
  readonly newBatch?: BatchDraft;
}
