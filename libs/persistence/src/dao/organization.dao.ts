import { Injectable } from '@nestjs/common';
import { TransactionContext } from '../kysely/transaction.context.js';
import type { OrganizationModel } from '../models/index.js';
import { AbstractBaseDao } from './base/abstract-base.dao.js';

/**
 * `organization` is the root of isolation: no org_id, no RLS, and therefore
 * outside the Org family. Access is always by identifier resolved from the
 * token (spec 10 §6).
 */
@Injectable()
export class OrganizationDao extends AbstractBaseDao<'organization', string> {
  protected readonly table = 'organization' as const;
  protected override readonly versioned = true;

  constructor(ctx: TransactionContext) {
    super(ctx);
  }

  /** By a unique other than the primary key, so it is a concrete method (spec 08 §4). */
  findBySlug(slug: string): Promise<OrganizationModel | null> {
    return this.findFirst({ where: { slug } });
  }
}
