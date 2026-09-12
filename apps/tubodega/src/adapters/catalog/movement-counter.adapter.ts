import { Injectable } from '@nestjs/common';
import type { OrgId } from '@app/common';
import type { MovementCounter, ProductId } from '@app/catalog';
import { MovementDao } from '@app/persistence';

/**
 * C-8 / I-15 answered by the ledger. The port is declared by `catalog` and
 * implemented here rather than in `libs/catalog`, so the catalogue never
 * depends on inventory or on persistence (rules R-2 and R-4). Until the ledger
 * lands in wave 3 the table is empty, and an empty answer is the honest one: a
 * product with no movements may change its tracking mode.
 */
@Injectable()
export class MovementCounterAdapter implements MovementCounter {
  constructor(private readonly movements: MovementDao) {}

  countByProduct(orgId: OrgId, productId: ProductId): Promise<number> {
    return this.movements.countByProduct(orgId, productId);
  }
}
