import { ok, type OrgId, type Result } from '@app/common';
import { CustomFieldValues, type CustomFieldDefinition } from './custom-field.js';
import { TrackingMode, type UnitOfMeasure } from './enums.js';
import { Sku, Uom, type ProductId } from './ids.js';

export class Product {
  private constructor(
    readonly id: ProductId,
    readonly orgId: OrgId,
    readonly sku: Sku,
    readonly name: string,
    readonly description: string | undefined,
    readonly trackingMode: TrackingMode,
    readonly uom: UnitOfMeasure,
    readonly active: boolean,
    readonly customFields: CustomFieldValues,
    readonly version: number,
  ) {}

  static create(
    input: {
      id: ProductId;
      orgId: OrgId;
      sku: string;
      name: string;
      description?: string;
      trackingMode: TrackingMode;
      uom: string;
      customFields?: Readonly<Record<string, unknown>>;
    },
    defs: readonly CustomFieldDefinition[] = [],
  ): Result<Product> {
    const sku = Sku.of(input.sku);
    if (!sku.ok) return sku;
    const uom = Uom.of(input.uom);
    if (!uom.ok) return uom;
    const custom = CustomFieldValues.build(defs, input.customFields ?? {});
    if (!custom.ok) return custom;

    return ok(
      new Product(
        input.id,
        input.orgId,
        sku.value,
        input.name.trim(),
        input.description?.trim() || undefined,
        input.trackingMode,
        uom.value,
        true,
        custom.value,
        1,
      ),
    );
  }

  static rehydrate(p: {
    id: ProductId;
    orgId: OrgId;
    sku: Sku;
    name: string;
    description?: string;
    trackingMode: TrackingMode;
    uom: UnitOfMeasure;
    active: boolean;
    customFields: CustomFieldValues;
    version: number;
  }): Product {
    return new Product(
      p.id,
      p.orgId,
      p.sku,
      p.name,
      p.description,
      p.trackingMode,
      p.uom,
      p.active,
      p.customFields,
      p.version,
    );
  }

  /** Whether every unit must be identified one by one (spec 02 §4). */
  requiresBatch(): boolean {
    return this.trackingMode !== TrackingMode.QUANTITY;
  }

  /**
   * Whether the change is allowed when the product already has movements is
   * C-8, and lives in the use case: only it can ask the ledger. The version is
   * bumped by the repository, not here.
   */
  update(
    patch: {
      name?: string;
      description?: string | null;
      trackingMode?: TrackingMode;
      uom?: string;
      customFields?: Readonly<Record<string, unknown>>;
    },
    defs: readonly CustomFieldDefinition[] = [],
  ): Result<Product> {
    const uom = patch.uom === undefined ? ok(this.uom) : Uom.of(patch.uom);
    if (!uom.ok) return uom;
    const custom =
      patch.customFields === undefined
        ? ok(this.customFields)
        : CustomFieldValues.build(defs, patch.customFields);
    if (!custom.ok) return custom;

    return ok(
      new Product(
        this.id,
        this.orgId,
        this.sku,
        patch.name?.trim() ?? this.name,
        patch.description === null ? undefined : (patch.description?.trim() ?? this.description),
        patch.trackingMode ?? this.trackingMode,
        uom.value,
        this.active,
        custom.value,
        this.version,
      ),
    );
  }

  /**
   * The version the row ended up with. The entity deliberately does not bump it
   * — the repository is the only writer that knows — but what comes back from a
   * write has to carry the new one, or a client that PATCHes twice using the
   * version it was just handed gets a spurious 409 (decision D-31).
   */
  withVersion(version: number): Product {
    return new Product(
      this.id,
      this.orgId,
      this.sku,
      this.name,
      this.description,
      this.trackingMode,
      this.uom,
      this.active,
      this.customFields,
      version,
    );
  }

  rename(name: string): Product {
    return new Product(
      this.id,
      this.orgId,
      this.sku,
      name.trim(),
      this.description,
      this.trackingMode,
      this.uom,
      this.active,
      this.customFields,
      this.version,
    );
  }

  /** Whether it still has stock is C-9, and the use case answers it. */
  deactivate(): Product {
    return new Product(
      this.id,
      this.orgId,
      this.sku,
      this.name,
      this.description,
      this.trackingMode,
      this.uom,
      false,
      this.customFields,
      this.version,
    );
  }
}
