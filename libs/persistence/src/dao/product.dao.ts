import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import type { OrgId } from '@app/common';
import { TransactionContext } from '../kysely/transaction.context.js';
import { AbstractOrgDao } from './base/org/abstract-org.dao.js';
import type { ProductModel } from '../models/index.js';

@Injectable()
export class ProductDao extends AbstractOrgDao<'product', string> {
  protected readonly table = 'product' as const;
  protected override readonly versioned = true;

  constructor(ctx: TransactionContext) {
    super(ctx);
  }

  /** The import asks for a whole sheet's worth of SKUs at once. */
  findManyBySkus(orgId: OrgId, skus: readonly string[]): Promise<ProductModel[]> {
    if (skus.length === 0) return Promise.resolve([]);
    return this.db
      .selectFrom('product')
      .selectAll()
      .where('orgId', '=', orgId)
      .where('sku', 'in', [...skus])
      .execute();
  }

  /** C-10 and D-10: how many products lack, or hold, a value for a custom key.
   *  `custom_fields ? key` is exactly what the GIN index answers. */
  countByCustomKey(orgId: OrgId, key: string, present: boolean): Promise<number> {
    const has = sql<boolean>`custom_fields ? ${key}`;
    return this.db
      .selectFrom('product')
      .select((eb) => eb.fn.countAll<string>().as('n'))
      .where('orgId', '=', orgId)
      .where(present ? has : sql<boolean>`not (${has})`)
      .executeTakeFirstOrThrow()
      .then((r) => Number(r.n));
  }
}
