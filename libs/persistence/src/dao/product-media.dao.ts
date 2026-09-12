import { Injectable } from '@nestjs/common';
import { TransactionContext } from '../kysely/transaction.context.js';
import { AbstractOrgDao } from './base/org/abstract-org.dao.js';

@Injectable()
export class ProductMediaDao extends AbstractOrgDao<'productMedia', string> {
  protected readonly table = 'productMedia' as const;

  constructor(ctx: TransactionContext) {
    super(ctx);
  }
}
