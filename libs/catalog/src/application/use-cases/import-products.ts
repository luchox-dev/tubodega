import { Inject, Injectable } from '@nestjs/common';
import {
  CLOCK, DomainError, EVENT_PUBLISHER, ID_GENERATOR,
  type Clock, type EventPublisher, type IdGenerator,
} from '@app/common';
import { Action, requireAction, type RequestContext } from '@app/tenancy';
import { CustomEntity, type TrackingMode } from '../../domain/enums.js';
import { Sku, type ProductCodeId, type ProductId } from '../../domain/ids.js';
import { Product } from '../../domain/product.js';
import { ProductCode } from '../../domain/product-code.js';
import { catalogEvent } from '../events.js';
import { CUSTOM_FIELD_REPOSITORY, type CustomFieldDefinitionRepository } from '../ports/custom-field.repository.js';
import { PRODUCT_CODE_REPOSITORY, type ProductCodeRepository } from '../ports/product-code.repository.js';
import { PRODUCT_REPOSITORY, type ProductRepository } from '../ports/product.repository.js';

/** A row of the spreadsheet. An absent column does not change an existing product. */
export interface ProductRow {
  readonly sku: string;
  readonly name?: string;
  readonly description?: string;
  readonly trackingMode?: TrackingMode;
  readonly uom?: string;
  readonly codes?: readonly string[];
  readonly customFields?: Readonly<Record<string, unknown>>;
}

export interface RowError {
  /** 1-indexed, as the user sees it in the spreadsheet. */
  readonly line: number;
  readonly sku?: string;
  /** The same `type` as problem+json, so the client can reuse its messages. */
  readonly type: string;
  readonly detail: string;
}

export interface ImportResult {
  readonly created: number;
  readonly updated: number;
  readonly errors: readonly RowError[];
}

/** D-11. Beyond this the request stops being an import and becomes an outage. */
export const MAX_IMPORT_ROWS = 1000;

export class ImportTooLargeError extends DomainError {
  readonly type = 'import-too-large';
  readonly status = 422;
  constructor(rows: number) {
    super(`El lote trae ${rows} filas y el máximo es ${MAX_IMPORT_ROWS}. Divídalo`);
  }
}

export class MissingSkuError extends DomainError {
  readonly type = 'validation-failed';
  readonly status = 422;
  constructor() {
    super('La fila no trae SKU, que es por donde se reconoce el producto');
  }
}

/**
 * This is the onboarding. The target user arrives with a spreadsheet, and the
 * evidence from the industry is that normalising SKUs between sheets is where
 * WMS projects die.
 *
 * Match by SKU, upsert row by row, and **one bad row does not abort the batch**.
 * An import of 500 products that fails whole because of row 347 is useless; one
 * that imports 499 and points at the bad one is a product you can use.
 */
@Injectable()
export class ImportProducts {
  constructor(
    @Inject(PRODUCT_REPOSITORY) private readonly products: ProductRepository,
    @Inject(PRODUCT_CODE_REPOSITORY) private readonly codes: ProductCodeRepository,
    @Inject(CUSTOM_FIELD_REPOSITORY) private readonly fields: CustomFieldDefinitionRepository,
    @Inject(EVENT_PUBLISHER) private readonly events: EventPublisher,
    @Inject(ID_GENERATOR) private readonly ids: IdGenerator,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(ctx: RequestContext, rows: readonly ProductRow[]): Promise<ImportResult> {
    requireAction(ctx, Action.MANAGE_CATALOG);
    if (rows.length > MAX_IMPORT_ROWS) throw new ImportTooLargeError(rows.length);

    const defs = await this.fields.listByEntity(ctx.orgId, CustomEntity.PRODUCT);
    const errors: RowError[] = [];

    // One round trip for every SKU in the batch instead of one per row.
    const parsed = rows.map((row) => ({ row, sku: Sku.of(row.sku ?? '') }));
    const known = await this.products.findManyBySkus(
      ctx.orgId,
      parsed.flatMap((p) => (p.sku.ok ? [p.sku.value] : [])),
    );

    let created = 0;
    let updated = 0;

    for (const [index, { row, sku }] of parsed.entries()) {
      const line = index + 1;
      const fail = (e: unknown, forSku?: string) => {
        const de = e as DomainError;
        errors.push({ line, ...(forSku ? { sku: forSku } : {}), type: de.type, detail: de.message });
      };

      if (!row.sku || row.sku.trim() === '') {
        fail(new MissingSkuError());
        continue;
      }
      if (!sku.ok) {
        fail(sku.error, row.sku);
        continue;
      }

      const existing = known.get(sku.value);
      const built = existing
        ? existing.update(
            {
              ...(row.name !== undefined ? { name: row.name } : {}),
              ...(row.description !== undefined ? { description: row.description } : {}),
              ...(row.trackingMode !== undefined ? { trackingMode: row.trackingMode } : {}),
              ...(row.uom !== undefined ? { uom: row.uom } : {}),
              ...(row.customFields !== undefined ? { customFields: row.customFields } : {}),
            },
            defs,
          )
        : Product.create(
            {
              id: this.ids.next() as ProductId,
              orgId: ctx.orgId,
              sku: sku.value,
              name: row.name ?? sku.value,
              ...(row.description !== undefined ? { description: row.description } : {}),
              trackingMode: row.trackingMode ?? ('QUANTITY' as TrackingMode),
              uom: row.uom ?? 'UNIT',
              ...(row.customFields !== undefined ? { customFields: row.customFields } : {}),
            },
            defs,
          );

      if (!built.ok) {
        fail(built.error, sku.value);
        continue;
      }

      try {
        await this.products.save(built.value, existing?.version);
        if (existing) updated++;
        else {
          created++;
          known.set(sku.value, built.value);
        }
      } catch (e) {
        fail(e, sku.value);
        continue;
      }

      for (const value of row.codes ?? []) {
        const code = ProductCode.create({
          id: this.ids.next() as ProductCodeId,
          orgId: ctx.orgId,
          productId: built.value.id,
          value,
          kind: 'OTHER' as ProductCode['kind'],
        });
        if (!code.ok) {
          fail(code.error, sku.value);
          continue;
        }
        // A code that is already there is not a reason to lose the product: the
        // row counted, and the collision is reported next to its line.
        try {
          const clash = await this.codes.findByValue(ctx.orgId, code.value.value);
          if (clash?.productId === built.value.id) continue;
          await this.codes.save(code.value);
        } catch (e) {
          fail(e, sku.value);
        }
      }
    }

    if (created + updated > 0) {
      await this.events.publish([
        catalogEvent(this.ids, 'product.updated', ctx.orgId, ctx.traceId, this.clock.now(), {
          imported: created + updated,
          created,
          updated,
        }),
      ]);
    }

    return { created, updated, errors };
  }
}
