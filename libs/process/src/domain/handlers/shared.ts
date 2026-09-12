import { err, ok, type Result } from '@app/common';
import type { Product } from '@app/catalog';
import type { ProcessContext } from '../context.js';
import { IncompleteDraftError } from '../errors.js';
import type { HandlerDeps } from './handler.js';

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

export const asRecord = (raw: unknown): Record<string, unknown> | null => (isRecord(raw) ? raw : null);

/**
 * The product the scan put in the draft. Two handlers need it — the one that
 * decides about batches and the one that decides about decimals — and in every
 * factory template `item` comes before both. A template where it does not is
 * the only way to get here empty, and saying "the draft has no product" is a
 * truer answer than a null dereference.
 */
export async function productoDelBorrador(ctx: ProcessContext, deps: HandlerDeps): Promise<Result<Product>> {
  const id = ctx.draft.productId;
  if (id === undefined) return err(new IncompleteDraftError(['el producto']));
  const product = await deps.findProduct(deps.orgId, id);
  if (!product) return err(new IncompleteDraftError(['el producto']));
  return ok(product);
}
