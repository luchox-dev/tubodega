import type { OrgId } from '@app/common';
import type { NodeId } from '../../domain/ids.js';

/**
 * The read row, not the entity of spec 12 §2: that one carries `Quantity`, and
 * `Quantity` belongs to the ledger (wave 3). Plan 4 declares only the two reads
 * N-3 needs; `query`, `find`, `sumUnder` and `applyDelta` arrive with it.
 */
export interface StockPositionRow {
  readonly productId: string;
  readonly batchId?: string;
  readonly quantity: string;
}

export interface StockScope {
  readonly productId?: string;
  readonly nodeId?: NodeId;
}

export interface StockBalanceRepository {
  /** C-9 and N-3: is there any, without asking how much. */
  hasAnyStock(orgId: OrgId, scope: StockScope): Promise<boolean>;
  /**
   * What blocks a deactivation. Capped, because one shelf can legitimately hold
   * thousands of (product, batch) positions and the error has to stay an error
   * rather than become a dump.
   */
  positionsIn(orgId: OrgId, scope: StockScope, cap: number): Promise<readonly StockPositionRow[]>;
}

export const STOCK_BALANCE_REPOSITORY = Symbol('StockBalanceRepository');
