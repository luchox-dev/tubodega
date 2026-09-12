import { Inject, Injectable } from '@nestjs/common';
import { ID_GENERATOR, unwrap, type IdGenerator } from '@app/common';
import { Action, requireAction, type RequestContext } from '@app/tenancy';
import type { CodeKind } from '../../domain/enums.js';
import { ProductNotFoundError } from '../../domain/errors.js';
import type { ProductCodeId, ProductId } from '../../domain/ids.js';
import { ProductCode } from '../../domain/product-code.js';
import { PRODUCT_CODE_REPOSITORY, type ProductCodeRepository } from '../ports/product-code.repository.js';
import { PRODUCT_REPOSITORY, type ProductRepository } from '../ports/product.repository.js';

export interface AddProductCodeInput {
  readonly productId: ProductId;
  readonly value: string;
  readonly kind: CodeKind;
}

@Injectable()
export class AddProductCode {
  constructor(
    @Inject(PRODUCT_REPOSITORY) private readonly products: ProductRepository,
    @Inject(PRODUCT_CODE_REPOSITORY) private readonly codes: ProductCodeRepository,
    @Inject(ID_GENERATOR) private readonly ids: IdGenerator,
  ) {}

  async execute(ctx: RequestContext, input: AddProductCodeInput): Promise<ProductCode> {
    requireAction(ctx, Action.MANAGE_CATALOG);
    const product = await this.products.findById(ctx.orgId, input.productId);
    if (!product) throw new ProductNotFoundError();

    const code = unwrap(
      ProductCode.create({
        id: this.ids.next() as ProductCodeId,
        orgId: ctx.orgId,
        productId: product.id,
        value: input.value,
        kind: input.kind,
      }),
    );
    // C-2 is the unique index; the repository turns its 23505 into code-taken
    // naming the product that already holds the value.
    await this.codes.save(code);
    return code;
  }
}
