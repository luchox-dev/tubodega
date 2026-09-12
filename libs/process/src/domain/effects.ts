import type { ProductId, StorageKey } from '@app/catalog';
import type { BatchDraft, MovementDraft } from './drafts.js';

/**
 * What the engine produces and the effect applier — in `application/` — runs by
 * calling the public use cases of the other modules, inside the transaction of
 * the request, **in this order**: `CREATE_BATCH` first, `EMIT_MOVEMENTS` next,
 * `ATTACH_MEDIA` last.
 *
 * `feeds` says which draft the new batch feeds: it is the index inside
 * `EMIT_MOVEMENTS.drafts`, and the applier writes the id of the freshly created
 * `Batch` into that draft's `batchId` before emitting anything. Without that
 * link the order of the two effects buys nothing — the `batchId` would have
 * nowhere to land. Today it is always `0`, because an instance produces one
 * line (spec 13 §3); the day of multi-line the field is already there and the
 * applier does not change.
 *
 * There is no alert effect, on purpose. Alerts are raised by reconciliation
 * (spec 14 §4), and one a process inserted would be resolved away on the next
 * pass; besides, `process` does not depend on `alerts`, so an effect carrying
 * one of its types would be a cycle.
 */
export type Effect =
  | { readonly kind: 'CREATE_BATCH'; readonly draft: BatchDraft; readonly feeds: number }
  | { readonly kind: 'EMIT_MOVEMENTS'; readonly drafts: readonly MovementDraft[] }
  | { readonly kind: 'ATTACH_MEDIA'; readonly productId: ProductId; readonly storageKeys: readonly StorageKey[] };
