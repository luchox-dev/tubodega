import { ok, type OrgId, type Result } from '@app/common';
import type { CodeKind } from './enums.js';
import { CodeValue, type ProductCodeId, type ProductId } from './ids.js';

/** What a scanner reads. Unique per organization, never per product: the
 *  scanner does not know which product it is pointing at (C-2). */
export class ProductCode {
  private constructor(
    readonly id: ProductCodeId,
    readonly orgId: OrgId,
    readonly productId: ProductId,
    readonly value: string,
    readonly kind: CodeKind,
  ) {}

  static create(input: {
    id: ProductCodeId;
    orgId: OrgId;
    productId: ProductId;
    value: string;
    kind: CodeKind;
  }): Result<ProductCode> {
    const value = CodeValue.of(input.value);
    if (!value.ok) return value;
    return ok(new ProductCode(input.id, input.orgId, input.productId, value.value, input.kind));
  }

  static rehydrate(p: {
    id: ProductCodeId;
    orgId: OrgId;
    productId: ProductId;
    value: string;
    kind: CodeKind;
  }): ProductCode {
    return new ProductCode(p.id, p.orgId, p.productId, p.value, p.kind);
  }
}
