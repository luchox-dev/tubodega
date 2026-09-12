import type { OrgId } from '@app/common';
import type { ProductId } from '../../domain/ids.js';

/**
 * What the catalogue needs to know about the ledger, and nothing more.
 * `inventory` implements both (spec 11 §5): the module above declares what it
 * needs to know, the one below implements it, and the direction of the
 * dependency holds — the same trick as OrgProvisioner in tenancy.
 */

/** C-8 / I-15: the tracking mode of a product with movements does not change. */
export interface MovementCounter {
  countByProduct(orgId: OrgId, productId: ProductId): Promise<number>;
}

export interface StockPosition {
  readonly nodeId: string;
  readonly path: string;
  readonly quantity: string;
}

/** C-9. Returns where the stock is, not just whether there is any: the error
 *  has to tell the user what to empty (decision D-3). */
export interface StockChecker {
  hasStock(orgId: OrgId, productId: ProductId): Promise<{ has: boolean; nodes: StockPosition[] }>;
}

export const MOVEMENT_COUNTER = Symbol('MovementCounter');
export const STOCK_CHECKER = Symbol('StockChecker');
