import { Inject, Injectable } from '@nestjs/common';
import { Action, requireAction, type RequestContext } from '@app/tenancy';
import type { Batch } from '../../domain/batch.js';
import { Sku } from '../../domain/ids.js';
import type { Product } from '../../domain/product.js';
import { BATCH_REPOSITORY, type BatchRepository } from '../ports/batch.repository.js';
import { PRODUCT_CODE_REPOSITORY, type ProductCodeRepository } from '../ports/product-code.repository.js';
import { PRODUCT_REPOSITORY, type ProductRepository } from '../ports/product.repository.js';

export interface Resolution {
  readonly product: Product;
  readonly batch?: Batch;
}

/**
 * The most frequent operation in the system: every scan goes through it.
 *
 * Three attempts, in order: the product codes, then a batch serial, then the
 * SKU. The operator can scan the label on the product, the label on one
 * particular unit, or type the SKU off a spreadsheet, and the system does the
 * right thing without asking what they typed. A lot code is deliberately not
 * resolved here: it is unique per product, not per organization, so without a
 * product it is ambiguous (spec 11 §4).
 *
 * Returns null instead of throwing: not finding a code is a normal outcome, and
 * the client needs to tell it apart in order to offer "create product".
 */
@Injectable()
export class ResolveCode {
  constructor(
    @Inject(PRODUCT_REPOSITORY) private readonly products: ProductRepository,
    @Inject(PRODUCT_CODE_REPOSITORY) private readonly codes: ProductCodeRepository,
    @Inject(BATCH_REPOSITORY) private readonly batches: BatchRepository,
  ) {}

  async execute(ctx: RequestContext, raw: string): Promise<Resolution | null> {
    requireAction(ctx, Action.READ);
    const value = raw.trim();
    if (value.length === 0) return null;

    const code = await this.codes.findByValue(ctx.orgId, value);
    if (code) {
      const product = await this.products.findById(ctx.orgId, code.productId);
      if (product) return { product };
    }

    const batch = await this.batches.findBySerial(ctx.orgId, value);
    if (batch) {
      const product = await this.products.findById(ctx.orgId, batch.productId);
      if (product) return { product, batch };
    }

    const sku = Sku.of(value);
    if (sku.ok) {
      const product = await this.products.findBySku(ctx.orgId, sku.value);
      if (product) return { product };
    }

    return null;
  }
}
