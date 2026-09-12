import { Injectable } from '@nestjs/common';
import { TransactionContext } from '../kysely/transaction.context.js';
import { AbstractOrgDao } from './base/org/abstract-org.dao.js';

@Injectable()
export class ProductCodeDao extends AbstractOrgDao<'productCode', string> {
  protected readonly table = 'productCode' as const;

  constructor(ctx: TransactionContext) {
    super(ctx);
  }
}
