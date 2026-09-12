import { Inject, Injectable } from '@nestjs/common';
import { Action, requireAction, type RequestContext } from '@app/tenancy';
import { ProductNotFoundError } from '../../domain/errors.js';
import type { ProductId } from '../../domain/ids.js';
import type { Product } from '../../domain/product.js';
import { PRODUCT_REPOSITORY, type ProductRepository } from '../ports/product.repository.js';

@Injectable()
export class GetProduct {
  constructor(@Inject(PRODUCT_REPOSITORY) private readonly products: ProductRepository) {}

  async execute(ctx: RequestContext, id: ProductId): Promise<Product> {
    requireAction(ctx, Action.READ);
    const product = await this.products.findById(ctx.orgId, id);
    // I-6: another organization's product is not found, never forbidden —
    // a 403 would confirm that the id exists.
    if (!product) throw new ProductNotFoundError();
    return product;
  }
}
