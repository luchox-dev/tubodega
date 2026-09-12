import { Inject, Injectable } from '@nestjs/common';
import {
  CLOCK, EVENT_PUBLISHER, ID_GENERATOR,
  type Clock, type EventPublisher, type IdGenerator,
} from '@app/common';
import { Action, requireAction, type RequestContext } from '@app/tenancy';
import { ProductHasStockError, ProductNotFoundError } from '../../domain/errors.js';
import type { ProductId } from '../../domain/ids.js';
import { catalogEvent } from '../events.js';
import { STOCK_CHECKER, type StockChecker } from '../ports/ledger.js';
import { PRODUCT_REPOSITORY, type ProductRepository } from '../ports/product.repository.js';

@Injectable()
export class DeactivateProduct {
  constructor(
    @Inject(PRODUCT_REPOSITORY) private readonly products: ProductRepository,
    @Inject(STOCK_CHECKER) private readonly stock: StockChecker,
    @Inject(EVENT_PUBLISHER) private readonly events: EventPublisher,
    @Inject(ID_GENERATOR) private readonly ids: IdGenerator,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(ctx: RequestContext, id: ProductId): Promise<void> {
    requireAction(ctx, Action.MANAGE_CATALOG);
    const product = await this.products.findById(ctx.orgId, id);
    if (!product) throw new ProductNotFoundError();
    if (!product.active) return;

    // C-9: having stock of something the catalogue declares retired is the
    // incoherent state this prevents.
    const stock = await this.stock.hasStock(ctx.orgId, id);
    if (stock.has) throw new ProductHasStockError(stock.nodes);

    await this.products.save(product.deactivate(), product.version);
    await this.events.publish([
      catalogEvent(this.ids, 'product.deactivated', ctx.orgId, ctx.traceId, this.clock.now(), {
        productId: product.id,
        sku: product.sku,
      }),
    ]);
  }
}
