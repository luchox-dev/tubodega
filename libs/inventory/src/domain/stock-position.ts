import type { BatchId, ProductId } from '@app/catalog';
import type { NodeId } from './ids.js';
import type { NodeKind } from './node.js';
import type { Quantity } from './quantity.js';

/**
 * How much of one thing sits in one place, derived from the ledger and kept in
 * the same transaction (I-5). Its natural key is
 * `(orgId, nodeId, productId, batchId)`, and that is how the domain sees it —
 * the surrogate `id` of the row exists only because Prisma demands a unique key
 * of NOT NULL columns (spec 04 §3.5) and nothing reads it.
 */
export interface StockPosition {
  readonly nodeId: NodeId;
  readonly productId: ProductId;
  readonly batchId?: BatchId;
  readonly nodeKind: NodeKind;
  readonly quantity: Quantity;
}
