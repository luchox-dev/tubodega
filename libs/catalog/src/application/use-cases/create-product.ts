import { Inject, Injectable } from '@nestjs/common';
import {
  CLOCK, EVENT_PUBLISHER, ID_GENERATOR, UNIT_OF_WORK, unwrap,
  type Clock, type EventPublisher, type IdGenerator, type UnitOfWork,
} from '@app/common';
import { Action, requireAction, type RequestContext } from '@app/tenancy';
import { CustomEntity, type CodeKind, type TrackingMode } from '../../domain/enums.js';
import { type ProductCodeId, type ProductId } from '../../domain/ids.js';
import { Product } from '../../domain/product.js';
import { ProductCode } from '../../domain/product-code.js';
import { catalogEvent } from '../events.js';
import { CUSTOM_FIELD_REPOSITORY, type CustomFieldDefinitionRepository } from '../ports/custom-field.repository.js';
import { PRODUCT_CODE_REPOSITORY, type ProductCodeRepository } from '../ports/product-code.repository.js';
import { PRODUCT_REPOSITORY, type ProductRepository } from '../ports/product.repository.js';

export interface CreateProductInput {
  readonly sku: string;
  readonly name: string;
  readonly description?: string;
  readonly trackingMode: TrackingMode;
  readonly uom: string;
  readonly codes?: readonly { readonly value: string; readonly kind: CodeKind }[];
  readonly customFields?: Readonly<Record<string, unknown>>;
}

@Injectable()
export class CreateProduct {
  constructor(
    @Inject(PRODUCT_REPOSITORY) private readonly products: ProductRepository,
    @Inject(PRODUCT_CODE_REPOSITORY) private readonly codes: ProductCodeRepository,
    @Inject(CUSTOM_FIELD_REPOSITORY) private readonly fields: CustomFieldDefinitionRepository,
    @Inject(EVENT_PUBLISHER) private readonly events: EventPublisher,
    @Inject(ID_GENERATOR) private readonly ids: IdGenerator,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
  ) {}

  async execute(ctx: RequestContext, input: CreateProductInput): Promise<Product> {
    requireAction(ctx, Action.MANAGE_CATALOG);
    const defs = await this.fields.listByEntity(ctx.orgId, CustomEntity.PRODUCT);
    const product = unwrap(
      Product.create({ id: this.ids.next() as ProductId, orgId: ctx.orgId, ...input }, defs),
    );

    await this.products.save(product);
    for (const raw of input.codes ?? []) {
      const code = unwrap(
        ProductCode.create({
          id: this.ids.next() as ProductCodeId,
          orgId: ctx.orgId,
          productId: product.id,
          value: raw.value,
          kind: raw.kind,
        }),
      );
      // Each code in its own savepoint: a 23505 aborts the transaction, and
      // without one the repository could not read which product holds it
      // in order to name it in the error (decision D-9).
      await this.uow.run(() => this.codes.save(code));
    }

    await this.events.publish([
      catalogEvent(this.ids, 'product.created', ctx.orgId, ctx.traceId, this.clock.now(), {
        productId: product.id,
        sku: product.sku,
        trackingMode: product.trackingMode,
      }),
    ]);
    return product;
  }
}
