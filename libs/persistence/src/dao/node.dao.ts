import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import type { OrgId } from '@app/common';
import { TransactionContext } from '../kysely/transaction.context.js';
import { AbstractOrgDao } from './base/org/abstract-org.dao.js';

/**
 * The nodes themselves arrive with `libs/inventory` in the next plan. What
 * exists here is only what the catalogue needs: counting custom values for
 * C-10 over the NODE entity.
 */
@Injectable()
export class NodeDao extends AbstractOrgDao<'node', string> {
  protected readonly table = 'node' as const;
  protected override readonly versioned = true;

  constructor(ctx: TransactionContext) {
    super(ctx);
  }

  countByCustomKey(orgId: OrgId, key: string, present: boolean): Promise<number> {
    const has = sql<boolean>`custom_fields ? ${key}`;
    return this.db
      .selectFrom('node')
      .select((eb) => eb.fn.countAll<string>().as('n'))
      .where('orgId', '=', orgId)
      .where(present ? has : sql<boolean>`not (${has})`)
      .executeTakeFirstOrThrow()
      .then((r) => Number(r.n));
  }
}
