import { Inject, Injectable } from '@nestjs/common';
import { UNIT_OF_WORK, type OrgId, type UnitOfWork } from '@app/common';
import {
  CodeTakenError,
  type ProductCode, type ProductCodeId, type ProductCodeRepository, type ProductId,
} from '@app/catalog';
import { ProductCodeDao } from '../../dao/product-code.dao.js';
import { ProductDao } from '../../dao/product.dao.js';
import { RecordNotFoundError, UniqueViolationError } from '../../dao/base/errors.js';
import { toProductCode } from './mapping.js';

@Injectable()
export class KyselyProductCodeRepository implements ProductCodeRepository {
  constructor(
    private readonly dao: ProductCodeDao,
    private readonly products: ProductDao,
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
  ) {}

  async findByValue(orgId: OrgId, value: string): Promise<ProductCode | null> {
    const row = await this.dao.findFirst(orgId, { where: { value } });
    return row ? toProductCode(row) : null;
  }

  async listByProduct(orgId: OrgId, productId: ProductId): Promise<ProductCode[]> {
    const rows = await this.dao.findMany(orgId, {
      where: { productId },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(toProductCode);
  }

  /**
   * C-2 is the unique index, and the savepoint is what makes its error usable.
   * A 23505 aborts the whole transaction: without rolling back to a savepoint
   * first, the query that reads *which* product holds the value would itself
   * fail with 25P02, and the import could not carry on with the next row
   * either (decision D-9). The savepoint belongs here, around the INSERT, and
   * not around the call: by the time the caller's catch runs it is too late.
   */
  async save(code: ProductCode): Promise<void> {
    try {
      await this.uow.run(() =>
        this.dao.create({
          id: code.id,
          orgId: code.orgId,
          productId: code.productId,
          value: code.value,
          kind: code.kind,
        }),
      );
    } catch (e) {
      if (e instanceof UniqueViolationError && e.constraint === 'product_code_org_id_value_key') {
        throw new CodeTakenError(code.value, await this.skuHolding(code.orgId, code.value));
      }
      throw e;
    }
  }

  async delete(orgId: OrgId, id: ProductCodeId): Promise<boolean> {
    try {
      await this.dao.delete(orgId, id);
      return true;
    } catch (e) {
      if (e instanceof RecordNotFoundError) return false;
      throw e;
    }
  }

  private async skuHolding(orgId: OrgId, value: string): Promise<string | undefined> {
    const existing = await this.dao.findFirst(orgId, { where: { value } });
    if (!existing) return undefined;
    const product = await this.products.findUnique(orgId, existing.productId, { select: ['sku'] });
    return product?.sku;
  }
}
