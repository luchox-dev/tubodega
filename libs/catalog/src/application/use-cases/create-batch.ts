import { Inject, Injectable } from '@nestjs/common';
import {
  CLOCK, EVENT_PUBLISHER, ID_GENERATOR, unwrap,
  type Clock, type EventPublisher, type IdGenerator,
} from '@app/common';
import { Action, requireAction, type RequestContext } from '@app/tenancy';
import { Batch } from '../../domain/batch.js';
import { CustomEntity } from '../../domain/enums.js';
import { ProductNotFoundError } from '../../domain/errors.js';
import type { BatchId, ProductId } from '../../domain/ids.js';
import { catalogEvent } from '../events.js';
import { BATCH_REPOSITORY, type BatchRepository } from '../ports/batch.repository.js';
import { CUSTOM_FIELD_REPOSITORY, type CustomFieldDefinitionRepository } from '../ports/custom-field.repository.js';
import { PRODUCT_REPOSITORY, type ProductRepository } from '../ports/product.repository.js';

export interface CreateBatchInput {
  readonly productId: ProductId;
  readonly lotCode?: string;
  readonly serial?: string;
  readonly expiresAt?: Date;
  readonly customFields?: Readonly<Record<string, unknown>>;
}

/**
 * The one catalogue write an OPERATOR may do, and it is open on purpose: a new
 * lot arrives with the goods, and demanding an administrator to identify the
 * consignment would stop every delivery of perishables at the dock. Defining
 * the product itself stays MANAGE_CATALOG (spec 11 §4).
 */
@Injectable()
export class CreateBatch {
  constructor(
    @Inject(PRODUCT_REPOSITORY) private readonly products: ProductRepository,
    @Inject(BATCH_REPOSITORY) private readonly batches: BatchRepository,
    @Inject(CUSTOM_FIELD_REPOSITORY) private readonly fields: CustomFieldDefinitionRepository,
    @Inject(EVENT_PUBLISHER) private readonly events: EventPublisher,
    @Inject(ID_GENERATOR) private readonly ids: IdGenerator,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(ctx: RequestContext, input: CreateBatchInput): Promise<Batch> {
    requireAction(ctx, Action.CREATE_BATCH);
    const product = await this.products.findById(ctx.orgId, input.productId);
    if (!product) throw new ProductNotFoundError();

    const defs = await this.fields.listByEntity(ctx.orgId, CustomEntity.BATCH);
    // C-3 and C-4 are decided by the product, inside Batch.create.
    const batch = unwrap(Batch.create({ id: this.ids.next() as BatchId, product, ...input }, defs));

    // C-5 and C-6 are the partial unique indexes; the repository translates them.
    await this.batches.save(batch);
    await this.events.publish([
      catalogEvent(this.ids, 'batch.created', ctx.orgId, ctx.traceId, this.clock.now(), {
        batchId: batch.id,
        productId: product.id,
        lotCode: batch.lotCode ?? null,
        serial: batch.serial ?? null,
      }),
    ]);
    return batch;
  }
}
