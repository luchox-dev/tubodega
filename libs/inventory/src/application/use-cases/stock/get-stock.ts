import { Inject, Injectable } from '@nestjs/common';
import type { Cursor, Page } from '@app/common';
import type { BatchId, ProductId } from '@app/catalog';
import { Action, requireAction, type RequestContext } from '@app/tenancy';
import { UnknownFilterNodeError } from '../../../domain/errors.js';
import type { NodeId } from '../../../domain/ids.js';
import type { StockPosition } from '../../../domain/stock-position.js';
import { NODE_REPOSITORY, type NodeRepository } from '../../ports/node.repository.js';
import { STOCK_BALANCE_REPOSITORY, type StockBalanceRepository } from '../../ports/stock-balance.repository.js';

export interface GetStockInput {
  readonly productId?: ProductId;
  readonly nodeId?: NodeId;
  /** A node id; resolved here to the path the repository filters by. */
  readonly under?: NodeId;
  readonly batchId?: BatchId;
  readonly custodialOnly?: boolean;
  readonly nonZeroOnly?: boolean;
}

export interface GetStockPage {
  readonly limit: number;
  readonly cursor?: Cursor;
}

/**
 * What is where. `custodialOnly` defaults to false but is what clients will
 * want almost always: without it the answer includes the running total of
 * TERMINAL:sale, which is not stock. The contract exposes the choice instead of
 * making it, because the query over the boundary is legitimate too — *"how much
 * of this have I sold?"* — and hiding it would force a separate endpoint.
 */
@Injectable()
export class GetStock {
  constructor(
    @Inject(STOCK_BALANCE_REPOSITORY) private readonly balances: StockBalanceRepository,
    @Inject(NODE_REPOSITORY) private readonly nodes: NodeRepository,
  ) {}

  async execute(ctx: RequestContext, input: GetStockInput, page: GetStockPage): Promise<Page<StockPosition>> {
    requireAction(ctx, Action.READ);
    const { under, ...filter } = input;

    if (under !== undefined) {
      // Same criterion as GET /v1/nodes (D-28): the 404 of this house is for the
      // resource named in the *path*, and an empty page is indistinguishable
      // from an empty subtree, so a mistyped uuid would read "nothing here".
      const root = await this.nodes.findById(ctx.orgId, under);
      if (!root) throw new UnknownFilterNodeError(under);
      // Aggregated, not paged: a subtree total is one row per (product, batch),
      // and there is nothing to page through once it is summed.
      const data = await this.balances.sumUnder(
        ctx.orgId, root.path,
        ...(filter.productId !== undefined ? [filter.productId] : []),
      );
      return { data, hasMore: false };
    }

    return this.balances.query(ctx.orgId, filter, page);
  }
}
