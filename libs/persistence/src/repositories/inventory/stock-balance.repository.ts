import { Injectable } from '@nestjs/common';
import type { OrgId } from '@app/common';
import type { StockBalanceRepository, StockPositionRow, StockScope } from '@app/inventory';
import { StockBalanceDao } from '../../dao/stock-balance.dao.js';

/**
 * The read half of spec 12 §5: what N-3 needs to refuse a deactivation. The
 * rest of the port — query, find, sumUnder, applyDelta — returns positions
 * carrying `Quantity`, and `Quantity` belongs to the ledger (wave 3).
 */
@Injectable()
export class KyselyStockBalanceRepository implements StockBalanceRepository {
  constructor(private readonly dao: StockBalanceDao) {}

  async hasAnyStock(orgId: OrgId, scope: StockScope): Promise<boolean> {
    // LIMIT 1: the question is "is there any", not "how much".
    return (await this.positionsIn(orgId, scope, 1)).length > 0;
  }

  async positionsIn(orgId: OrgId, scope: StockScope, cap: number): Promise<readonly StockPositionRow[]> {
    if (scope.nodeId === undefined) return [];
    const rows = await this.dao.positionsOfNode(orgId, scope.nodeId, cap);
    return scope.productId === undefined ? rows : rows.filter((r) => r.productId === scope.productId);
  }
}
