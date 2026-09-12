import { Injectable } from '@nestjs/common';
import type { OrgId } from '@app/common';
import type {
  MediaId, MediaUploadRepository, ProductId, ProductMediaRepository,
  StagedUpload, StorageKey, StoredMedia,
} from '@app/catalog';
import { MediaUploadDao } from '../../dao/media-upload.dao.js';
import { ProductMediaDao } from '../../dao/product-media.dao.js';
import { RecordNotFoundError } from '../../dao/base/errors.js';

@Injectable()
export class KyselyMediaUploadRepository implements MediaUploadRepository {
  constructor(private readonly dao: MediaUploadDao) {}

  async stage(upload: {
    orgId: OrgId;
    storageKey: StorageKey;
    contentType: string;
    byteSize: number;
    uploadedBy: string;
  }): Promise<void> {
    await this.dao.create({
      id: crypto.randomUUID(),
      orgId: upload.orgId,
      storageKey: upload.storageKey,
      contentType: upload.contentType,
      byteSize: String(upload.byteSize),
      uploadedBy: upload.uploadedBy,
    });
  }

  /** One statement, and `claimed_at IS NULL` *is* the claim: a second attempt
   *  updates nothing, which is how a double claim becomes upload-not-found
   *  instead of a duplicated photo. */
  async claim(orgId: OrgId, keys: readonly StorageKey[]): Promise<StagedUpload[]> {
    const rows = await this.dao.claim(orgId, [...keys]);
    return rows.map((r) => ({
      storageKey: r.storageKey as StorageKey,
      contentType: r.contentType,
      byteSize: Number(r.byteSize),
    }));
  }

  async listUnclaimedBefore(date: Date): Promise<{ orgId: OrgId; storageKey: StorageKey }[]> {
    const rows = await this.dao.listUnclaimedBefore(date);
    return rows.map((r) => ({ orgId: r.orgId as OrgId, storageKey: r.storageKey as StorageKey }));
  }
}

@Injectable()
export class KyselyProductMediaRepository implements ProductMediaRepository {
  constructor(private readonly dao: ProductMediaDao) {}

  async listByProduct(orgId: OrgId, productId: ProductId): Promise<StoredMedia[]> {
    const rows = await this.dao.findMany(orgId, {
      where: { productId },
      orderBy: { position: 'asc' },
    });
    return rows.map((r) => ({
      id: r.id as MediaId,
      productId: r.productId as ProductId,
      storageKey: r.storageKey as StorageKey,
      contentType: r.contentType,
      byteSize: Number(r.byteSize),
      position: r.position,
    }));
  }

  async attach(orgId: OrgId, media: StoredMedia): Promise<void> {
    await this.dao.create({
      id: media.id,
      orgId,
      productId: media.productId,
      storageKey: media.storageKey,
      contentType: media.contentType,
      byteSize: String(media.byteSize),
      position: media.position,
    });
  }

  async remove(orgId: OrgId, productId: ProductId, mediaId: MediaId): Promise<StorageKey | null> {
    try {
      const row = await this.dao.delete(orgId, mediaId);
      // The id is unique per organization, so a mismatched product means the
      // caller pointed at somebody else's photo: not found, never forbidden.
      return row.productId === productId ? (row.storageKey as StorageKey) : null;
    } catch (e) {
      if (e instanceof RecordNotFoundError) return null;
      throw e;
    }
  }
}
