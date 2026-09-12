import { Inject, Injectable } from '@nestjs/common';
import { ID_GENERATOR, type IdGenerator } from '@app/common';
import { Action, requireAction, type RequestContext } from '@app/tenancy';
import { ProductNotFoundError } from '../../domain/errors.js';
import {
  ALLOWED_MEDIA_TYPES, MAX_MEDIA_BYTES, MediaTooLargeError,
  UnsupportedMediaTypeError, UploadNotFoundError,
} from '../../domain/media-errors.js';
import type { MediaId, ProductId, StorageKey } from '../../domain/ids.js';
import {
  MEDIA_STORAGE, MEDIA_UPLOAD_REPOSITORY, PRODUCT_MEDIA_REPOSITORY,
  type MediaStorage, type MediaUploadRepository, type ProductMediaRepository, type StoredMedia,
} from '../ports/media.js';
import { PRODUCT_REPOSITORY, type ProductRepository } from '../ports/product.repository.js';

export type AttachMediaInput =
  /** Claiming keys already in the waiting room: RECORD_MOVEMENT (D-14). */
  | { readonly productId: ProductId; readonly storageKeys: readonly StorageKey[] }
  /** Uploading straight onto the product: MANAGE_CATALOG. */
  | { readonly productId: ProductId; readonly files: readonly { bytes: Buffer; contentType: string }[] };

@Injectable()
export class AttachMedia {
  constructor(
    @Inject(PRODUCT_REPOSITORY) private readonly products: ProductRepository,
    @Inject(PRODUCT_MEDIA_REPOSITORY) private readonly media: ProductMediaRepository,
    @Inject(MEDIA_UPLOAD_REPOSITORY) private readonly uploads: MediaUploadRepository,
    @Inject(MEDIA_STORAGE) private readonly storage: MediaStorage,
    @Inject(ID_GENERATOR) private readonly ids: IdGenerator,
  ) {}

  async execute(ctx: RequestContext, input: AttachMediaInput): Promise<StoredMedia[]> {
    const claiming = 'storageKeys' in input;
    // The operator who took the photos may claim their own keys; putting a new
    // file into the catalogue is a catalogue change (D-14).
    requireAction(ctx, claiming ? Action.RECORD_MOVEMENT : Action.MANAGE_CATALOG);

    const product = await this.products.findById(ctx.orgId, input.productId);
    if (!product) throw new ProductNotFoundError();

    const existing = await this.media.listByProduct(ctx.orgId, input.productId);
    let position = existing.length;
    const attached: StoredMedia[] = [];

    if (claiming) {
      const claimed = await this.uploads.claim(ctx.orgId, input.storageKeys);
      const got = new Set(claimed.map((c) => c.storageKey as string));
      const lost = input.storageKeys.filter((k) => !got.has(k));
      // Reporting before attaching anything: a half-done claim would leave the
      // caller unable to tell which keys still exist.
      if (lost.length > 0) throw new UploadNotFoundError(lost);

      for (const upload of claimed) {
        const stored: StoredMedia = {
          id: this.ids.next() as MediaId,
          productId: product.id,
          storageKey: upload.storageKey,
          contentType: upload.contentType,
          byteSize: upload.byteSize,
          position: position++,
        };
        await this.media.attach(ctx.orgId, stored);
        attached.push(stored);
      }
      return attached;
    }

    for (const file of input.files) {
      if (!(ALLOWED_MEDIA_TYPES as readonly string[]).includes(file.contentType)) {
        throw new UnsupportedMediaTypeError(file.contentType);
      }
      if (file.bytes.byteLength > MAX_MEDIA_BYTES) throw new MediaTooLargeError();

      const storageKey = await this.storage.put(ctx.orgId, file.bytes, file.contentType);
      const stored: StoredMedia = {
        id: this.ids.next() as MediaId,
        productId: product.id,
        storageKey,
        contentType: file.contentType,
        byteSize: file.bytes.byteLength,
        position: position++,
      };
      await this.media.attach(ctx.orgId, stored);
      attached.push(stored);
    }
    return attached;
  }
}
