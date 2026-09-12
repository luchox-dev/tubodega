// In-memory doubles for the catalogue ports. They keep the invariants the
// database keeps (C-1, C-2, C-5, C-6) so a use-case test fails for the same
// reason production would, and not one step later.
import { encodeCursor, type Cursor, type OrgId, type Page } from '@app/common';
import {
  CodeTakenError, LotCodeTakenError, SerialTakenError, SkuTakenError,
  type Batch, type CustomEntity, type CustomFieldDefinition, type FieldKey,
  type Product, type ProductCode,
} from '@app/catalog';
import type {
  BatchRepository, CustomFieldDefinitionRepository, MovementCounter, ProductCodeRepository,
  ProductFilter, ProductPage, ProductRepository, StockChecker, StockPosition,
} from '@app/catalog';

const key = (orgId: string, id: string) => `${orgId}:${id}`;

export class InMemoryProductRepository implements ProductRepository {
  readonly rows = new Map<string, Product>();

  async findById(orgId: OrgId, id: string): Promise<Product | null> {
    const p = this.rows.get(key(orgId, id));
    return p ?? null;
  }

  async findBySku(orgId: OrgId, sku: string): Promise<Product | null> {
    for (const p of this.rows.values()) if (p.orgId === orgId && p.sku === sku) return p;
    return null;
  }

  async findManyBySkus(orgId: OrgId, skus: readonly string[]): Promise<Map<string, Product>> {
    const wanted = new Set(skus);
    const out = new Map<string, Product>();
    for (const p of this.rows.values()) if (p.orgId === orgId && wanted.has(p.sku)) out.set(p.sku, p);
    return out;
  }

  async list(orgId: OrgId, filter: ProductFilter, page: ProductPage): Promise<Page<Product>> {
    const q = filter.q?.toLowerCase();
    const all = [...this.rows.values()]
      .filter((p) => p.orgId === orgId)
      .filter((p) => filter.active === undefined || p.active === filter.active)
      .filter((p) => filter.trackingMode === undefined || p.trackingMode === filter.trackingMode)
      .filter((p) => q === undefined || p.sku.toLowerCase().includes(q) || p.name.toLowerCase().includes(q))
      .sort((a, b) => (a.sku < b.sku ? -1 : 1));
    const data = all.slice(0, page.limit);
    const hasMore = all.length > page.limit;
    return { data, hasMore, ...(hasMore ? { nextCursor: encodeCursor([data.at(-1)!.id]) } : {}) };
  }

  async save(product: Product): Promise<void> {
    for (const p of this.rows.values()) {
      if (p.orgId === product.orgId && p.sku === product.sku && p.id !== product.id) {
        throw new SkuTakenError(product.sku);
      }
    }
    this.rows.set(key(product.orgId, product.id), product);
  }

  async saveMany(products: readonly Product[]): Promise<void> {
    for (const p of products) await this.save(p);
  }
}

export class InMemoryProductCodeRepository implements ProductCodeRepository {
  readonly rows = new Map<string, ProductCode>();
  /** So the double can name the product holding a value, like the repository does. */
  skuOf: (productId: string) => string | undefined = () => undefined;

  async findByValue(orgId: OrgId, value: string): Promise<ProductCode | null> {
    for (const c of this.rows.values()) if (c.orgId === orgId && c.value === value) return c;
    return null;
  }

  async listByProduct(orgId: OrgId, productId: string): Promise<ProductCode[]> {
    return [...this.rows.values()].filter((c) => c.orgId === orgId && c.productId === productId);
  }

  async save(code: ProductCode): Promise<void> {
    const clash = await this.findByValue(code.orgId, code.value);
    if (clash && clash.id !== code.id) throw new CodeTakenError(code.value, this.skuOf(clash.productId));
    this.rows.set(key(code.orgId, code.id), code);
  }

  async delete(orgId: OrgId, id: string): Promise<boolean> {
    return this.rows.delete(key(orgId, id));
  }
}

export class InMemoryBatchRepository implements BatchRepository {
  readonly rows = new Map<string, Batch>();

  async findById(orgId: OrgId, id: string): Promise<Batch | null> {
    return this.rows.get(key(orgId, id)) ?? null;
  }

  async findBySerial(orgId: OrgId, serial: string): Promise<Batch | null> {
    for (const b of this.rows.values()) if (b.orgId === orgId && b.serial === serial) return b;
    return null;
  }

  async findByLotCode(orgId: OrgId, productId: string, lotCode: string): Promise<Batch | null> {
    for (const b of this.rows.values()) {
      if (b.orgId === orgId && b.productId === productId && b.lotCode === lotCode) return b;
    }
    return null;
  }

  async listByProduct(orgId: OrgId, productId: string): Promise<Batch[]> {
    return [...this.rows.values()].filter((b) => b.orgId === orgId && b.productId === productId);
  }

  async listExpiringBefore(orgId: OrgId, date: Date): Promise<Batch[]> {
    return [...this.rows.values()].filter(
      (b) => b.orgId === orgId && b.expiresAt !== undefined && b.expiresAt <= date,
    );
  }

  async save(batch: Batch): Promise<void> {
    if (batch.serial !== undefined) {
      const clash = await this.findBySerial(batch.orgId, batch.serial);
      if (clash && clash.id !== batch.id) throw new SerialTakenError(batch.serial);
    }
    if (batch.lotCode !== undefined) {
      const clash = await this.findByLotCode(batch.orgId, batch.productId, batch.lotCode);
      if (clash && clash.id !== batch.id) throw new LotCodeTakenError(batch.lotCode);
    }
    this.rows.set(key(batch.orgId, batch.id), batch);
  }
}

export class InMemoryCustomFieldRepository implements CustomFieldDefinitionRepository {
  readonly rows = new Map<string, CustomFieldDefinition>();
  missing = 0;
  used = 0;

  async findById(orgId: OrgId, id: string): Promise<CustomFieldDefinition | null> {
    return this.rows.get(key(orgId, id)) ?? null;
  }

  async listByEntity(orgId: OrgId, entity: CustomEntity): Promise<CustomFieldDefinition[]> {
    return [...this.rows.values()]
      .filter((d) => d.orgId === orgId && d.entity === entity)
      .sort((a, b) => a.position - b.position);
  }

  async countEntitiesMissing(): Promise<number> {
    return this.missing;
  }

  async countEntitiesWith(): Promise<number> {
    return this.used;
  }

  async save(def: CustomFieldDefinition): Promise<void> {
    this.rows.set(key(def.orgId, def.id), def);
  }

  /** Convenience for arranging: put a definition in without going through a use case. */
  add(def: CustomFieldDefinition): CustomFieldDefinition {
    this.rows.set(key(def.orgId, def.id), def);
    return def;
  }
}

export class FakeMovementCounter implements MovementCounter {
  constructor(public count = 0) {}
  async countByProduct(): Promise<number> {
    return this.count;
  }
}

export class FakeStockChecker implements StockChecker {
  constructor(public nodes: StockPosition[] = []) {}
  async hasStock(): Promise<{ has: boolean; nodes: StockPosition[] }> {
    return { has: this.nodes.length > 0, nodes: this.nodes };
  }
}

/** The unit of work a use case sees: a savepoint is just a nested call here. */
export const fakeUow = { run: <T>(fn: () => Promise<T>) => fn() };

let seq = 0;
export const fakeIds = { next: () => `018f0000-0000-7000-8000-${String(++seq).padStart(12, '0')}` };
export const fixedClock = { now: () => new Date('2026-09-12T12:00:00.000Z') };

export class RecordingEventPublisher {
  readonly published: { type: string; data: Record<string, unknown> }[] = [];
  async publish(events: readonly { type: string; data: Readonly<Record<string, unknown>> }[]): Promise<void> {
    for (const e of events) this.published.push({ type: e.type, data: { ...e.data } });
  }
  types(): string[] {
    return this.published.map((e) => e.type);
  }
}

export const unusedCursor = undefined as Cursor | undefined;
export type { FieldKey };
