import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import type { OrgId } from '@app/common';
import { TransactionContext } from '../kysely/transaction.context.js';
import { escapeLike } from './base/where.js';
import { AbstractOrgDao } from './base/org/abstract-org.dao.js';
import type { NodeModel } from '../models/index.js';
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

  /**
   * The strict subtree, ordered by path. The trailing separator is the whole
   * point: without it 'BOD-A/Z1' would drag 'BOD-A/Z10' along, which is not its
   * descendant. `escapeLike` covers the other half — '%' and '_' are legal in a
   * code and are wildcards in a LIKE — and Postgres takes '\\' as the default
   * escape, so no ESCAPE clause is needed. Postgres still extracts the constant
   * prefix through the backslashes, so node_org_id_path_idx is used.
   */
  listUnder(orgId: OrgId, prefix: string, limit: number, onlyActive = false): Promise<NodeModel[]> {
    let q = this.db
      .selectFrom('node')
      .selectAll()
      .where('orgId', '=', orgId)
      .where('path', 'like', `${escapeLike(prefix)}/%`);
    if (onlyActive) q = q.where('active', '=', true);
    return q.orderBy('path').limit(limit).execute();
  }

  /**
   * N-2, in one statement. Two details that are not cosmetic:
   *
   * - The pattern carries the trailing separator, for the reason above.
   * - `substring(path from n)`, not `replace(path, old, new)`: replace rewrites
   *   every occurrence, so a path like 'BOD-A/Z1/BOD-A' would be corrupted.
   *
   * Only strict descendants: the moved node itself goes through `save()`, the
   * only writer that knows about parent_id and optimistic locking. The version
   * is bumped because the row really did change — a client holding the old one
   * holds a node whose place it no longer knows, and its If-Match must fail.
   */
  async updateSubtreePaths(orgId: OrgId, oldPrefix: string, newPrefix: string): Promise<number> {
    const res = await this.db
      .updateTable('node')
      .set({
        // substring() is 1-based: start right after the old prefix. Both casts
        // are load-bearing: without `::int` the driver sends the offset as an
        // untyped parameter, Postgres resolves `substring(text from text)` —
        // the *regex* overload — and a prefix that is not a regex match makes
        // the whole path NULL.
        path: sql<string>`${newPrefix}::text || substring("path" from ${oldPrefix.length + 1}::int)`,
        version: sql<number>`version + 1`,
        updatedAt: sql<Date>`now()`,
      })
      .where('orgId', '=', orgId)
      .where('path', 'like', `${escapeLike(oldPrefix)}/%`)
      .executeTakeFirst();
    return Number(res.numUpdatedRows ?? 0);
  }
}
