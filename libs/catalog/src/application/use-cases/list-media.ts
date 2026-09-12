import { Inject, Injectable } from '@nestjs/common';
import { Action, requireAction, type RequestContext } from '@app/tenancy';
import { ProductNotFoundError } from '../../domain/errors.js';
import type { ProductId } from '../../domain/ids.js';
import {
  PRODUCT_MEDIA_REPOSITORY, type ProductMediaRepository, type StoredMedia,
} from '../ports/media.js';
import { PRODUCT_REPOSITORY, type ProductRepository } from '../ports/product.repository.js';

@Injectable()
export class ListMedia {
  constructor(
    @Inject(PRODUCT_REPOSITORY) private readonly products: ProductRepository,
    @Inject(PRODUCT_MEDIA_REPOSITORY) private readonly media: ProductMediaRepository,
  ) {}

  async execute(ctx: RequestContext, productId: ProductId): Promise<StoredMedia[]> {
    requireAction(ctx, Action.READ);
    const product = await this.products.findById(ctx.orgId, productId);
    if (!product) throw new ProductNotFoundError();
    return this.media.listByProduct(ctx.orgId, productId);
  }
}
