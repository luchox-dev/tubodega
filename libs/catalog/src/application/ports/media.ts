import type { OrgId } from '@app/common';
import type { MediaId, ProductId, StorageKey } from '../../domain/ids.js';

/** What a photo is once it has been stored. */
export interface StoredMedia {
  readonly id: MediaId;
  readonly productId: ProductId;
  readonly storageKey: StorageKey;
  readonly contentType: string;
  readonly byteSize: number;
  readonly position: number;
}

export interface StagedUpload {
  readonly storageKey: StorageKey;
  readonly contentType: string;
  readonly byteSize: number;
}

/**
 * A port because photo storage will change: local disk first, object storage
 * later. No use case should find out (spec 11 §5).
 */
export interface MediaStorage {
  put(orgId: OrgId, bytes: Buffer, contentType: string): Promise<StorageKey>;
  signedUrl(key: StorageKey, ttlSeconds: number): Promise<string>;
  delete(key: StorageKey): Promise<void>;
}

export interface MediaUploadRepository {
  stage(upload: {
    orgId: OrgId;
    storageKey: StorageKey;
    contentType: string;
    byteSize: number;
    uploadedBy: string;
  }): Promise<void>;
  /** Marks the keys as claimed and returns the ones it could claim. Anything
   *  missing from the result never existed or was already spoken for. */
  claim(orgId: OrgId, keys: readonly StorageKey[]): Promise<StagedUpload[]>;
  /** The 24 h purge of spec 07 §6; system context, it crosses organizations. */
  listUnclaimedBefore(date: Date): Promise<{ orgId: OrgId; storageKey: StorageKey }[]>;
}

export interface ProductMediaRepository {
  listByProduct(orgId: OrgId, productId: ProductId): Promise<StoredMedia[]>;
  attach(orgId: OrgId, media: StoredMedia): Promise<void>;
  /** Returns the storage key of what it removed, so the file can go too. */
  remove(orgId: OrgId, productId: ProductId, mediaId: MediaId): Promise<StorageKey | null>;
}

export const MEDIA_STORAGE = Symbol('MediaStorage');
export const MEDIA_UPLOAD_REPOSITORY = Symbol('MediaUploadRepository');
export const PRODUCT_MEDIA_REPOSITORY = Symbol('ProductMediaRepository');
