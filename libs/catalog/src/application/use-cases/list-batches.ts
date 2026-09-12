import { Inject, Injectable } from '@nestjs/common';
import { Action, requireAction, type RequestContext } from '@app/tenancy';
import type { Batch } from '../../domain/batch.js';
import { ProductNotFoundError } from '../../domain/errors.js';
import type { ProductId } from '../../domain/ids.js';
import { BATCH_REPOSITORY, type BatchRepository } from '../ports/batch.repository.js';
import { PRODUCT_REPOSITORY, type ProductRepository } from '../ports/product.repository.js';

@Injectable()
export class ListBatches {
  constructor(
    @Inject(PRODUCT_REPOSITORY) private readonly products: ProductRepository,
    @Inject(BATCH_REPOSITORY) private readonly batches: BatchRepository,
  ) {}

  async execute(ctx: RequestContext, productId: ProductId): Promise<Batch[]> {
    requireAction(ctx, Action.READ);
    const product = await this.products.findById(ctx.orgId, productId);
    if (!product) throw new ProductNotFoundError();
    return this.batches.listByProduct(ctx.orgId, productId);
  }
}
