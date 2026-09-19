import { Inject, Injectable } from '@nestjs/common';
import { CLOCK, type Clock, type OrgId } from '@app/common';
import {
  BATCH_REPOSITORY, PRODUCT_REPOSITORY, ResolveCode,
  type BatchRepository, type ProductId, type ProductRepository,
} from '@app/catalog';
import { NODE_REPOSITORY, type NodeCode, type NodeId, type NodeRepository } from '@app/inventory';
import type { RequestContext } from '@app/tenancy';
import type { HandlerDeps } from '../domain/handlers/handler.js';

/**
 * The seven entries of `HandlerDeps`, built out of the repositories and use
 * cases of `catalog` and `inventory` — **no bridge ports** (spec 13 §8, D-46).
 * Five of them are the repository method, bound as it is: the signatures are
 * already exactly the ones the handlers want, and a port that re-exported them
 * would be a file that ages apart from the one it copies.
 *
 * `resolveCode` is the one that needs a wrapper, and that is why this is a
 * factory and not a constant: `ResolveCode.execute(ctx, raw)` takes a
 * `RequestContext` — it checks `READ` — while the handler's dep is
 * `(orgId, raw)`. Closing over the ctx is what reconciles the two (D-65).
 */
@Injectable()
export class HandlerDepsFactory {
  constructor(
    private readonly resolve: ResolveCode,
    @Inject(NODE_REPOSITORY) private readonly nodes: NodeRepository,
    @Inject(PRODUCT_REPOSITORY) private readonly products: ProductRepository,
    @Inject(BATCH_REPOSITORY) private readonly batches: BatchRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  for(ctx: RequestContext): HandlerDeps {
    return {
      // The organization the six reads are scoped by. A handler has no other
      // way to know it: `ProcessContext` deliberately carries no tenancy, and
      // `validate` takes no instance (D-53).
      orgId: ctx.orgId,
      resolveCode: (_orgId: OrgId, raw: string) => this.resolve.execute(ctx, raw),
      findNode: (orgId: OrgId, id: NodeId) => this.nodes.findById(orgId, id),
      findNodeByCode: (orgId: OrgId, code: string) => this.nodes.findByCode(orgId, code as NodeCode),
      findProduct: (orgId: OrgId, id: ProductId) => this.products.findById(orgId, id),
      findBatchByLot: (orgId: OrgId, productId: ProductId, lotCode: string) =>
        this.batches.findByLotCode(orgId, productId, lotCode),
      findBatchBySerial: (orgId: OrgId, serial: string) => this.batches.findBySerial(orgId, serial),
      clock: this.clock,
    };
  }
}
