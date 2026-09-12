import { err, ok, type OrgId, type Result } from '@app/common';
import { CustomFieldValues, type CustomFieldDefinition } from './custom-field.js';
import { TrackingMode } from './enums.js';
import { BatchNotAllowedError, BatchRequiredError } from './errors.js';
import type { BatchId, ProductId } from './ids.js';
import type { Product } from './product.js';

const DAY_MS = 86_400_000;

export class Batch {
  private constructor(
    readonly id: BatchId,
    readonly orgId: OrgId,
    readonly productId: ProductId,
    readonly lotCode: string | undefined,
    readonly serial: string | undefined,
    readonly expiresAt: Date | undefined,
    readonly customFields: CustomFieldValues,
  ) {}

  /** C-3 and C-4 in one place: the product decides what a batch of it is. */
  static create(
    input: {
      id: BatchId;
      product: Product;
      lotCode?: string;
      serial?: string;
      expiresAt?: Date;
      customFields?: Readonly<Record<string, unknown>>;
    },
    defs: readonly CustomFieldDefinition[] = [],
  ): Result<Batch> {
    const { product } = input;
    const lotCode = input.lotCode?.trim() || undefined;
    const serial = input.serial?.trim() || undefined;

    if (product.trackingMode === TrackingMode.QUANTITY) {
      return err(new BatchNotAllowedError(product.sku));
    }
    if (product.trackingMode === TrackingMode.LOT && !lotCode) {
      return err(new BatchRequiredError(product.sku, 'LOT'));
    }
    if (product.trackingMode === TrackingMode.SERIAL && !serial) {
      return err(new BatchRequiredError(product.sku, 'SERIAL'));
    }

    const custom = CustomFieldValues.build(defs, input.customFields ?? {});
    if (!custom.ok) return custom;

    return ok(
      new Batch(input.id, product.orgId, product.id, lotCode, serial, input.expiresAt, custom.value),
    );
  }

  static rehydrate(p: {
    id: BatchId;
    orgId: OrgId;
    productId: ProductId;
    lotCode?: string;
    serial?: string;
    expiresAt?: Date;
    customFields: CustomFieldValues;
  }): Batch {
    return new Batch(p.id, p.orgId, p.productId, p.lotCode, p.serial, p.expiresAt, p.customFields);
  }

  /** A batch without an expiry date never expires. */
  isExpired(at: Date): boolean {
    return this.expiresAt !== undefined && this.expiresAt.getTime() <= at.getTime();
  }

  /** True from the moment it enters the window, and it stays true once expired:
   *  an alert that stops firing the day the milk goes bad helps nobody. */
  expiresWithin(days: number, at: Date): boolean {
    if (this.expiresAt === undefined) return false;
    return this.expiresAt.getTime() <= at.getTime() + days * DAY_MS;
  }
}
