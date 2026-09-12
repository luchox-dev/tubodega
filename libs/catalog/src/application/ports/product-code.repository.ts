import type { OrgId } from '@app/common';
import type { ProductCodeId, ProductId } from '../../domain/ids.js';
import type { ProductCode } from '../../domain/product-code.js';

export interface ProductCodeRepository {
  /** The hot path: every scan starts here (C-2). */
  findByValue(orgId: OrgId, value: string): Promise<ProductCode | null>;
  listByProduct(orgId: OrgId, productId: ProductId): Promise<ProductCode[]>;
  /** Raises CodeTakenError naming the product that already holds the value. */
  save(code: ProductCode): Promise<void>;
  delete(orgId: OrgId, id: ProductCodeId): Promise<boolean>;
}

export const PRODUCT_CODE_REPOSITORY = Symbol('ProductCodeRepository');
