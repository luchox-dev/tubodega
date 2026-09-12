import { Inject, Injectable } from '@nestjs/common';
import { Action, requireAction, type RequestContext } from '@app/tenancy';
import { ProductNotFoundError } from '../../domain/errors.js';
import type { ProductId } from '../../domain/ids.js';
import type { ProductCode } from '../../domain/product-code.js';
import { PRODUCT_CODE_REPOSITORY, type ProductCodeRepository } from '../ports/product-code.repository.js';
import { PRODUCT_REPOSITORY, type ProductRepository } from '../ports/product.repository.js';

@Injectable()
export class ListCodes {
  constructor(
    @Inject(PRODUCT_REPOSITORY) private readonly products: ProductRepository,
    @Inject(PRODUCT_CODE_REPOSITORY) private readonly codes: ProductCodeRepository,
  ) {}

  async execute(ctx: RequestContext, productId: ProductId): Promise<ProductCode[]> {
    requireAction(ctx, Action.READ);
    const product = await this.products.findById(ctx.orgId, productId);
    if (!product) throw new ProductNotFoundError();
    return this.codes.listByProduct(ctx.orgId, productId);
  }
}
