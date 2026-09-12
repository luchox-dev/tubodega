import type { Cursor, OrgId, Page } from '@app/common';
import type { TrackingMode } from '../../domain/enums.js';
import type { ProductId, Sku } from '../../domain/ids.js';
import type { Product } from '../../domain/product.js';

/** What `GET /v1/products` may filter by; anything else is 400 (spec 03 §8). */
export interface ProductFilter {
  readonly active?: boolean;
  readonly trackingMode?: TrackingMode;
  /** Matches sku or name. */
  readonly q?: string;
}

export interface ProductPage {
  readonly limit: number;
  readonly cursor?: Cursor;
  readonly sort: { readonly field: 'name' | 'sku' | 'createdAt'; readonly dir: 'asc' | 'desc' };
}

export interface ProductRepository {
  findById(orgId: OrgId, id: ProductId): Promise<Product | null>;
  findBySku(orgId: OrgId, sku: Sku): Promise<Product | null>;
  /** For the import: one round trip instead of one per row. */
  findManyBySkus(orgId: OrgId, skus: readonly Sku[]): Promise<Map<string, Product>>;
  list(orgId: OrgId, filter: ProductFilter, page: ProductPage): Promise<Page<Product>>;
  /**
   * Insert or update by id with optimistic locking. Raises SkuTakenError on C-1.
   * Returns the version the row ended up with: the caller has to be able to
   * hand it back to the client, and only the repository knows it (D-31).
   */
  save(product: Product, expectedVersion?: number): Promise<number>;
  saveMany(products: readonly Product[]): Promise<void>;
}

export const PRODUCT_REPOSITORY = Symbol('ProductRepository');
