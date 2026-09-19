import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import type { Cursor, OrgId } from '@app/common';
import { decodeCursor, encodeCursor } from '@app/common';
import { TransactionContext } from '../kysely/transaction.context.js';
import { InvalidCursorError } from './base/errors.js';
import { AbstractOrgAppendDao } from './base/org/abstract-org-append.dao.js';
import type { MovementModel } from '../models/index.js';

/** A check-out that has not fully come back, with what it still owes. */
export type OpenCustodyModel = MovementModel & { readonly pending: string };

/**
 * The ledger stops at the append family, and that is the point: a DAO of
 * `movement` that inherited `update` would have the method in its type and
 * someone would eventually call it. I-3 is a shape, not just a REVOKE.
 *
 * Only what the catalogue needs exists so far (C-8); the rest lands with the
 * ledger in wave 3.
 */
@Injectable()
export class MovementDao extends AbstractOrgAppendDao<'movement', string> {
  protected readonly table = 'movement' as const;

  constructor(ctx: TransactionContext) {
    super(ctx);
  }

  countByProduct(orgId: OrgId, productId: string): Promise<number> {
    return this.count(orgId, { productId });
  }

  /** I-13, read side. The partial UNIQUE is what actually holds it. */
  existsReversalOf(orgId: OrgId, id: string): Promise<boolean> {
    return this.exists(orgId, { reversesId: id });
  }

  /**
   * The pending-balance query of spec 04 §3.4. A check-in that was itself
   * compensated stops counting, and the loan goes back up: the goods never
   * really came back.
   */
  async settledQuantity(orgId: OrgId, checkOutId: string): Promise<string> {
    const row = await this.db
      .selectFrom('movement as s')
      .select(({ fn }) => fn.sum<string>('s.quantity').as('settled'))
      .where('s.orgId', '=', orgId)
      .where('s.settlesId', '=', checkOutId)
      .where(({ not, exists, selectFrom }) =>
        not(
          exists(
            selectFrom('movement as r')
              .select('r.id')
              .whereRef('r.orgId', '=', 's.orgId')
              .whereRef('r.reversesId', '=', 's.id'),
          ),
        ),
      )
      .executeTakeFirst();
    return row?.settled ?? '0';
  }

  /**
   * Open loans, **one row per check-out** — the query `settles_id` exists to
   * make possible. A check-out is an entry *into* a custody that is neither a
   * return nor a compensation, and that nobody has compensated.
   *
   * Keyset by hand: the generic one cannot carry the HAVING that drops the
   * loans already settled in full.
   */
  async openCustodies(
    orgId: OrgId,
    filter: { nodeId?: string; overdueBefore?: Date },
    page: { limit: number; cursor?: Cursor; dir: 'asc' | 'desc' },
  ): Promise<{ rows: OpenCustodyModel[]; hasMore: boolean }> {
    let after: [string, string] | null = null;
    if (page.cursor !== undefined) {
      const parts = decodeCursor(page.cursor);
      if (!parts || parts.length !== 2) throw new InvalidCursorError();
      after = [String(parts[0]), String(parts[1])];
    }

    const desc = page.dir === 'desc';
    const q = sql<OpenCustodyModel>`
      select c.*, (c.quantity - coalesce(sum(s.quantity), 0)) as pending
      from movement c
      left join movement s
        on s.org_id = c.org_id and s.settles_id = c.id
       and not exists (
             select 1 from movement r
             where r.org_id = s.org_id and r.reverses_id = s.id)
      where c.org_id = ${orgId}
        and c.to_node_kind = 'CUSTODY'
        and c.settles_id is null
        and c.reverses_id is null
        and not exists (
              select 1 from movement r2
              where r2.org_id = c.org_id and r2.reverses_id = c.id)
        ${filter.nodeId === undefined ? sql`` : sql`and c.to_node_id = ${filter.nodeId}`}
        ${filter.overdueBefore === undefined ? sql`` : sql`and c.due_at < ${filter.overdueBefore}`}
        ${after === null ? sql`` : desc
          ? sql`and (c.occurred_at, c.id) < (${after[0]}::timestamptz, ${after[1]}::uuid)`
          : sql`and (c.occurred_at, c.id) > (${after[0]}::timestamptz, ${after[1]}::uuid)`}
      group by c.id
      having (c.quantity - coalesce(sum(s.quantity), 0)) > 0
      order by c.occurred_at ${desc ? sql`desc` : sql`asc`}, c.id ${desc ? sql`desc` : sql`asc`}
      limit ${page.limit + 1}
    `;

    const found = await q.execute(this.db);
    const hasMore = found.rows.length > page.limit;
    return { rows: hasMore ? found.rows.slice(0, page.limit) : found.rows, hasMore };
  }

  /**
   * The cursor `openCustodies` reads back, built from the same two columns it
   * orders by.
   *
   * The second keyset of the system, and so the second place that truncates a
   * timestamp to the millisecond a JS `Date` can hold. Safe only while D-68
   * keeps `movement.occurred_at` at `timestamptz(3)` — D-67 left this column
   * out, reasoning that clients always send the instant through
   * `new Date(iso)`, which is a fact about today's writers and not about the
   * column.
   */
  static custodyCursor(row: OpenCustodyModel): Cursor {
    return encodeCursor([new Date(row.occurredAt as unknown as string).toISOString(), row.id]);
  }
}
