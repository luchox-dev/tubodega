import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import type { OrgId } from '@app/common';
import { TransactionContext } from '../kysely/transaction.context.js';
import { AbstractOrgDao } from './base/org/abstract-org.dao.js';

@Injectable()
export class BatchDao extends AbstractOrgDao<'batch', string> {
  protected readonly table = 'batch' as const;

  constructor(ctx: TransactionContext) {
    super(ctx);
  }

  countByCustomKey(orgId: OrgId, key: string, present: boolean): Promise<number> {
    const has = sql<boolean>`custom_fields ? ${key}`;
    return this.db
      .selectFrom('batch')
      .select((eb) => eb.fn.countAll<string>().as('n'))
      .where('orgId', '=', orgId)
      .where(present ? has : sql<boolean>`not (${has})`)
      .executeTakeFirstOrThrow()
      .then((r) => Number(r.n));
  }
}
