import { Inject, Injectable } from '@nestjs/common';
import { Action, requireAction, type RequestContext } from '@app/tenancy';
import { ProductNotFoundError } from '../../domain/errors.js';
import { MediaNotFoundError } from '../../domain/media-errors.js';
import type { MediaId, ProductId } from '../../domain/ids.js';
import {
  MEDIA_STORAGE, PRODUCT_MEDIA_REPOSITORY,
  type MediaStorage, type ProductMediaRepository,
} from '../ports/media.js';
import { PRODUCT_REPOSITORY, type ProductRepository } from '../ports/product.repository.js';

@Injectable()
export class RemoveMedia {
  constructor(
    @Inject(PRODUCT_REPOSITORY) private readonly products: ProductRepository,
    @Inject(PRODUCT_MEDIA_REPOSITORY) private readonly media: ProductMediaRepository,
    @Inject(MEDIA_STORAGE) private readonly storage: MediaStorage,
  ) {}

  async execute(ctx: RequestContext, productId: ProductId, mediaId: MediaId): Promise<void> {
    requireAction(ctx, Action.MANAGE_CATALOG);
    const product = await this.products.findById(ctx.orgId, productId);
    if (!product) throw new ProductNotFoundError();

    const key = await this.media.remove(ctx.orgId, productId, mediaId);
    if (!key) throw new MediaNotFoundError();
    // The row goes first and the file after: an orphan file costs disk, an
    // orphan row costs a broken image on every product page.
    await this.storage.delete(key);
  }
}
