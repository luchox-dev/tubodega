import { Inject, Injectable } from '@nestjs/common';
import {
  CLOCK, EVENT_PUBLISHER, ID_GENERATOR, unwrap,
  type Clock, type EventPublisher, type IdGenerator,
} from '@app/common';
import { Action, requireAction, type RequestContext } from '@app/tenancy';
import { CustomEntity, type TrackingMode } from '../../domain/enums.js';
import { ProductNotFoundError, TrackingModeLockedError } from '../../domain/errors.js';
import type { ProductId } from '../../domain/ids.js';
import type { Product } from '../../domain/product.js';
import { catalogEvent } from '../events.js';
import { CUSTOM_FIELD_REPOSITORY, type CustomFieldDefinitionRepository } from '../ports/custom-field.repository.js';
import { MOVEMENT_COUNTER, type MovementCounter } from '../ports/ledger.js';
import { PRODUCT_REPOSITORY, type ProductRepository } from '../ports/product.repository.js';

export interface UpdateProductInput {
  readonly id: ProductId;
  readonly name?: string;
  readonly description?: string | null;
  readonly trackingMode?: TrackingMode;
  readonly uom?: string;
  readonly customFields?: Readonly<Record<string, unknown>>;
  /** From If-Match; the repository turns a mismatch into 409 stale-version. */
  readonly expectedVersion: number;
}

@Injectable()
export class UpdateProduct {
  constructor(
    @Inject(PRODUCT_REPOSITORY) private readonly products: ProductRepository,
    @Inject(CUSTOM_FIELD_REPOSITORY) private readonly fields: CustomFieldDefinitionRepository,
    @Inject(MOVEMENT_COUNTER) private readonly movements: MovementCounter,
    @Inject(EVENT_PUBLISHER) private readonly events: EventPublisher,
    @Inject(ID_GENERATOR) private readonly ids: IdGenerator,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(ctx: RequestContext, input: UpdateProductInput): Promise<Product> {
    requireAction(ctx, Action.MANAGE_CATALOG);
    const product = await this.products.findById(ctx.orgId, input.id);
    if (!product) throw new ProductNotFoundError();

    // C-8 / I-15. The ledger denormalises tracking_mode on every movement so a
    // CHECK can enforce I-8; changing it would desynchronise the history. The
    // way out for the user is a new product, not a rewritten past.
    if (input.trackingMode !== undefined && input.trackingMode !== product.trackingMode) {
      const count = await this.movements.countByProduct(ctx.orgId, product.id);
      if (count > 0) throw new TrackingModeLockedError(count);
    }

    const defs =
      input.customFields === undefined
        ? []
        : await this.fields.listByEntity(ctx.orgId, CustomEntity.PRODUCT);
    const next = unwrap(product.update(input, defs));

    await this.products.save(next, input.expectedVersion);
    await this.events.publish([
      catalogEvent(this.ids, 'product.updated', ctx.orgId, ctx.traceId, this.clock.now(), {
        productId: next.id,
        sku: next.sku,
      }),
    ]);
    return next;
  }
}
