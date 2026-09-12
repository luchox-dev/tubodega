import { Inject, Injectable } from '@nestjs/common';
import { UNIT_OF_WORK, type OrgId, type Page, type UnitOfWork } from '@app/common';
import {
  SkuTakenError,
  type Product, type ProductFilter, type ProductId, type ProductPage,
  type ProductRepository, type Sku,
} from '@app/catalog';
import { ProductDao } from '../../dao/product.dao.js';
import { RecordNotFoundError, UniqueViolationError } from '../../dao/base/errors.js';
import { productValues, toProduct } from './mapping.js';

const translate = (sku: string) => (e: unknown): never => {
  if (e instanceof UniqueViolationError && e.constraint === 'product_org_id_sku_key') {
    throw new SkuTakenError(sku); // C-1
  }
  throw e;
};

@Injectable()
export class KyselyProductRepository implements ProductRepository {
  constructor(
    private readonly dao: ProductDao,
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
  ) {}

  async findById(orgId: OrgId, id: ProductId): Promise<Product | null> {
    const row = await this.dao.findUnique(orgId, id);
    return row ? toProduct(row) : null;
  }

  async findBySku(orgId: OrgId, sku: Sku): Promise<Product | null> {
    const row = await this.dao.findFirst(orgId, { where: { sku } });
    return row ? toProduct(row) : null;
  }

  async findManyBySkus(orgId: OrgId, skus: readonly Sku[]): Promise<Map<string, Product>> {
    const out = new Map<string, Product>();
    // In chunks: a thousand-row import must not build a thousand-parameter IN.
    for (let i = 0; i < skus.length; i += 500) {
      for (const row of await this.dao.findManyBySkus(orgId, [...skus.slice(i, i + 500)])) {
        out.set(row.sku, toProduct(row));
      }
    }
    return out;
  }

  /**
   * `q` is the documented escape hatch of spec 08 §5: an OR of two ILIKEs the
   * DSL has no operator for, mixed into its own AND.
   */
  async list(orgId: OrgId, filter: ProductFilter, page: ProductPage): Promise<Page<Product>> {
    const q = filter.q?.trim();
    const found = await this.dao.findPage(orgId, {
      take: page.limit,
      ...(page.cursor !== undefined ? { cursor: page.cursor } : {}),
      orderBy: { [page.sort.field]: page.sort.dir },
      where: {
        ...(filter.active !== undefined ? { active: filter.active } : {}),
        ...(filter.trackingMode !== undefined ? { trackingMode: filter.trackingMode } : {}),
        ...(q
          ? {
              AND: [
                (eb) =>
                  eb.or([
                    eb('product.sku', 'ilike', `%${q}%`),
                    eb('product.name', 'ilike', `%${q}%`),
                  ]),
              ],
            }
          : {}),
      },
    });
    return { ...found, data: found.data.map(toProduct) };
  }

  /**
   * Update first, insert if it was not there: the same shape as every other
   * repository of the house, and the only place the version is bumped.
   *
   * Both writes sit in a savepoint. A 23505 on the SKU aborts the transaction,
   * and the import has to be able to record the bad row and carry on with the
   * next one — which it cannot do inside an aborted transaction (D-9).
   */
  async save(product: Product, expectedVersion?: number): Promise<void> {
    const data = productValues(product);
    try {
      await this.uow.run(() =>
        this.dao.update(
          product.orgId,
          product.id,
          data,
          expectedVersion !== undefined ? { expectedVersion } : {},
        ),
      );
    } catch (e) {
      if (e instanceof RecordNotFoundError) {
        await this.uow
          .run(() => this.dao.create({ id: product.id, orgId: product.orgId, ...data }))
          .catch(translate(product.sku));
        return;
      }
      translate(product.sku)(e);
    }
  }

  async saveMany(products: readonly Product[]): Promise<void> {
    for (const p of products) await this.save(p);
  }
}
