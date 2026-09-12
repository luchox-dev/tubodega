import { Inject, Injectable } from '@nestjs/common';
import { UNIT_OF_WORK, type OrgId, type Page, type UnitOfWork } from '@app/common';
import type { BatchId, ProductId } from '@app/catalog';
import {
  InsufficientStockSignal, Quantity,
  type BalanceDelta, type NodeId, type NodePath, type StockBalanceRepository,
  type StockPage, type StockPosition, type StockPositionRow, type StockQuery, type StockScope,
} from '@app/inventory';
import { StockBalanceDao } from '../../dao/stock-balance.dao.js';
import { CheckViolationError } from '../../dao/base/errors.js';
import { toStockPosition } from './mapping.js';

/** I-4, by the name the migration gave it (decision D-33). */
const I4_CONSTRAINT = 'stock_balance_i4_non_negative';

const naturalOrder = (a: BalanceDelta, b: BalanceDelta): number => {
  const key = (d: BalanceDelta) => `${d.nodeId}|${d.productId}|${d.batchId ?? ''}`;
  return key(a) < key(b) ? -1 : 1;
};

@Injectable()
export class KyselyStockBalanceRepository implements StockBalanceRepository {
  constructor(
    private readonly dao: StockBalanceDao,
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
  ) {}

  async hasAnyStock(orgId: OrgId, scope: StockScope): Promise<boolean> {
    // LIMIT 1: the question is "is there any", not "how much".
    return (await this.positionsIn(orgId, scope, 1)).length > 0;
  }

  async positionsIn(orgId: OrgId, scope: StockScope, cap: number): Promise<readonly StockPositionRow[]> {
    if (scope.nodeId === undefined) return [];
    const rows = await this.dao.positionsOfNode(orgId, scope.nodeId, cap);
    return scope.productId === undefined ? rows : rows.filter((r) => r.productId === scope.productId);
  }

  async find(
    orgId: OrgId, nodeId: NodeId, productId: ProductId, batchId?: BatchId,
  ): Promise<StockPosition | null> {
    const row = await this.dao.findPosition(orgId, nodeId, productId, batchId ?? null);
    return row ? toStockPosition(row) : null;
  }

  async query(orgId: OrgId, q: StockQuery, page: StockPage): Promise<Page<StockPosition>> {
    const found = await this.dao.findPage(orgId, {
      take: page.limit,
      ...(page.cursor !== undefined ? { cursor: page.cursor } : {}),
      orderBy: { nodeId: 'asc' },
      where: {
        ...(q.productId !== undefined ? { productId: q.productId } : {}),
        ...(q.nodeId !== undefined ? { nodeId: q.nodeId } : {}),
        ...(q.batchId !== undefined ? { batchId: q.batchId } : {}),
        // A SOURCE or a TERMINAL is a boundary, and its balance is a running
        // total rather than goods on a shelf.
        ...(q.custodialOnly === true ? { nodeKind: { in: ['INTERNAL', 'CUSTODY'] as const } } : {}),
        // Both partial indexes are `WHERE quantity <> 0`, which is this predicate.
        ...(q.nonZeroOnly === false ? {} : { quantity: { not: '0' } }),
      },
    });
    return { ...found, data: found.data.map(toStockPosition) };
  }

  async sumUnder(orgId: OrgId, path: NodePath, productId?: ProductId): Promise<StockPosition[]> {
    const rows = await this.dao.sumUnder(orgId, path, productId);
    return rows.map((r) => ({
      // A subtree total belongs to no single node; the caller groups by product.
      nodeId: '' as NodeId,
      productId: r.productId as ProductId,
      ...(r.batchId !== null ? { batchId: r.batchId as BatchId } : {}),
      nodeKind: 'INTERNAL' as never,
      quantity: Quantity.rehydrate(r.quantity),
    }));
  }

  async custodialTotal(orgId: OrgId, batchId: BatchId): Promise<Quantity> {
    return Quantity.rehydrate(await this.dao.custodialTotal(orgId, batchId));
  }

  /**
   * The write that decides whether a dispatch happens. Deliberately **not** a
   * prior SELECT: a SELECT followed by an INSERT has a window in which another
   * transaction consumes the stock, and the result is a negative balance under
   * concurrency. The CHECK has no window.
   *
   * The upserts go inside a `run()` — a SAVEPOINT — because after a CHECK
   * violation Postgres leaves the transaction aborted and will not take even a
   * SELECT. With it, only the upserts roll back, the balance can still be read,
   * and `insufficient-stock` can carry `available`.
   *
   * The order is **the natural key**, and that it is this class's job and not
   * the caller's is what makes it impossible for a use case to cause a deadlock
   * by carelessness (spec 12 §5).
   */
  async applyDelta(orgId: OrgId, deltas: readonly BalanceDelta[]): Promise<StockPosition[]> {
    const ordered = [...deltas].sort(naturalOrder);
    // Which delta was in flight: the Postgres error names the constraint, never
    // the row, so the position has to be remembered on this side.
    let inFlight: BalanceDelta | undefined;

    try {
      return await this.uow.run(async () => {
        const out: StockPosition[] = [];
        for (const d of ordered) {
          inFlight = d;
          out.push(
            toStockPosition(
              await this.dao.upsertDelta({
                orgId,
                nodeId: d.nodeId,
                productId: d.productId,
                batchId: d.batchId ?? null,
                nodeKind: d.nodeKind as never,
                delta: d.delta.toString(),
              }),
            ),
          );
        }
        return out;
      });
    } catch (e) {
      if (!(e instanceof CheckViolationError) || e.constraint !== I4_CONSTRAINT || !inFlight) throw e;
      // The savepoint has already rolled back by the time we get here, so the
      // transaction is usable and this read returns what is really available.
      const current = await this.find(orgId, inFlight.nodeId, inFlight.productId, inFlight.batchId);
      throw new InsufficientStockSignal({
        nodeId: inFlight.nodeId,
        productId: inFlight.productId,
        ...(inFlight.batchId !== undefined ? { batchId: inFlight.batchId } : {}),
        available: current?.quantity ?? Quantity.zero(),
      });
    }
  }
}
