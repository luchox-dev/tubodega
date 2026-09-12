import { Inject, Injectable } from '@nestjs/common';
import type { Cursor, Page } from '@app/common';
import { Action, requireAction, type RequestContext } from '@app/tenancy';
import type { TrackingMode } from '../../domain/enums.js';
import type { Product } from '../../domain/product.js';
import { PRODUCT_REPOSITORY, type ProductPage, type ProductRepository } from '../ports/product.repository.js';

export interface ListProductsInput {
  readonly active?: boolean;
  readonly trackingMode?: TrackingMode;
  readonly q?: string;
  readonly limit: number;
  readonly cursor?: Cursor;
  readonly sort: ProductPage['sort'];
}

@Injectable()
export class ListProducts {
  constructor(@Inject(PRODUCT_REPOSITORY) private readonly products: ProductRepository) {}

  async execute(ctx: RequestContext, input: ListProductsInput): Promise<Page<Product>> {
    requireAction(ctx, Action.READ);
    const { limit, cursor, sort, ...filter } = input;
    return this.products.list(ctx.orgId, filter, { limit, cursor, sort });
  }
}
