import { Injectable } from '@nestjs/common';
import type { OrgId } from '@app/common';
import type { ProductId, StockChecker, StockPosition } from '@app/catalog';
import { StockBalanceDao } from '@app/persistence';

/**
 * C-9, and it answers *where* rather than just *whether*: the error has to tell
 * the user what to empty before retiring the product (decision D-3). The path
 * comes from a join against `node`, which exists from the full_schema
 * migration — the nodes' own library arrives in the next plan (D-18).
 */
@Injectable()
export class StockCheckerAdapter implements StockChecker {
  constructor(private readonly balances: StockBalanceDao) {}

  async hasStock(orgId: OrgId, productId: ProductId): Promise<{ has: boolean; nodes: StockPosition[] }> {
    const nodes = await this.balances.positionsOfProduct(orgId, productId);
    return { has: nodes.length > 0, nodes: [...nodes] };
  }
}
