import { Inject, Injectable } from '@nestjs/common';
import { Action, requireAction, type RequestContext } from '@app/tenancy';
import { CodeNotFoundError, ProductNotFoundError } from '../../domain/errors.js';
import type { ProductCodeId, ProductId } from '../../domain/ids.js';
import { PRODUCT_CODE_REPOSITORY, type ProductCodeRepository } from '../ports/product-code.repository.js';
import { PRODUCT_REPOSITORY, type ProductRepository } from '../ports/product.repository.js';

@Injectable()
export class RemoveProductCode {
  constructor(
    @Inject(PRODUCT_REPOSITORY) private readonly products: ProductRepository,
    @Inject(PRODUCT_CODE_REPOSITORY) private readonly codes: ProductCodeRepository,
  ) {}

  async execute(ctx: RequestContext, productId: ProductId, codeId: ProductCodeId): Promise<void> {
    requireAction(ctx, Action.MANAGE_CATALOG);
    const product = await this.products.findById(ctx.orgId, productId);
    if (!product) throw new ProductNotFoundError();
    const removed = await this.codes.delete(ctx.orgId, codeId);
    if (!removed) throw new CodeNotFoundError(codeId);
  }
}
