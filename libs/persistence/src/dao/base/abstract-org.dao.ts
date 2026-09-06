import { sql, type Insertable, type Selectable, type Updateable } from 'kysely';
import type { OrgId } from '@app/common';
import type { DB } from '../../generated/db.js';
import { TransactionContext, type Tx } from '../../kysely/transaction.context.js';
import { RecordNotFoundError, VersionConflictError, translatePgError } from './errors.js';

/**
 * Minimal base of the Org DAO family (spec 08 §3-§4): every read is scoped by
 * orgId in addition to RLS, and every write goes through the ambient
 * transaction. This is the plan-1 subset — key `id`, equality `where`,
 * optimistic locking. The full DSL, keyset pagination and the append-only
 * variant arrive in plan 2 without changing these signatures.
 *
 * Kysely cannot type queries over a table name known only at runtime in a
 * generic base class, so the builders are widened to `any` here and narrowed
 * back on return. Concretions keep full typing on their own methods.
 */
export abstract class AbstractOrgDao<TB extends keyof DB & string> {
  protected abstract readonly table: TB;
  /** Tables with `version` + `updated_at`: update bumps both. */
  protected readonly versioned: boolean = false;

  constructor(protected readonly ctx: TransactionContext) {}

  /** The active transaction. Throws NoActiveTransactionError outside run()/runAs(). */
  protected get db(): Tx {
    return this.ctx.current();
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  protected get anyDb(): any {
    return this.ctx.current();
  }

  async findUnique(orgId: OrgId, id: string): Promise<Selectable<DB[TB]> | null> {
    const row = await this.anyDb
      .selectFrom(this.table)
      .selectAll()
      .where('orgId', '=', orgId)
      .where('id', '=', id)
      .executeTakeFirst();
    return (row ?? null) as Selectable<DB[TB]> | null;
  }

  async findFirst(
    orgId: OrgId,
    where: Partial<Selectable<DB[TB]>>,
  ): Promise<Selectable<DB[TB]> | null> {
    const row = await this.applyWhere(
      this.anyDb.selectFrom(this.table).selectAll().where('orgId', '=', orgId),
      where,
    ).executeTakeFirst();
    return (row ?? null) as Selectable<DB[TB]> | null;
  }

  async findMany(
    orgId: OrgId,
    where: Partial<Selectable<DB[TB]>> = {},
  ): Promise<Selectable<DB[TB]>[]> {
    const rows = await this.applyWhere(
      this.anyDb.selectFrom(this.table).selectAll().where('orgId', '=', orgId),
      where,
    ).execute();
    return rows as Selectable<DB[TB]>[];
  }

  async create(data: Insertable<DB[TB]>): Promise<Selectable<DB[TB]>> {
    try {
      return (await this.anyDb
        .insertInto(this.table)
        .values(data)
        .returningAll()
        .executeTakeFirstOrThrow()) as Selectable<DB[TB]>;
    } catch (e) {
      translatePgError(e);
    }
  }

  /**
   * UPDATE … WHERE org_id AND id [AND version = expected]. Zero rows means
   * either the row is missing (RecordNotFoundError) or someone else moved its
   * version (VersionConflictError); a second read tells them apart (spec 08 §4).
   */
  async update(
    orgId: OrgId,
    id: string,
    data: Updateable<DB[TB]>,
    opts: { readonly expectedVersion?: number } = {},
  ): Promise<Selectable<DB[TB]>> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const patch: Record<string, any> = { ...data };
    if (this.versioned) {
      patch.version = sql`version + 1`;
      patch.updatedAt = sql`now()`;
    }
    let q = this.anyDb.updateTable(this.table).set(patch).where('orgId', '=', orgId).where('id', '=', id);
    if (opts.expectedVersion !== undefined) q = q.where('version', '=', opts.expectedVersion);
    let row: unknown;
    try {
      row = await q.returningAll().executeTakeFirst();
    } catch (e) {
      translatePgError(e);
    }
    if (row) return row as Selectable<DB[TB]>;
    const exists = await this.findUnique(orgId, id);
    if (!exists) throw new RecordNotFoundError(this.table, id);
    throw new VersionConflictError(this.table, id);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private applyWhere(q: any, where: Partial<Selectable<DB[TB]>>): any {
    for (const [column, value] of Object.entries(where)) {
      q = value === null ? q.where(column, 'is', null) : q.where(column, '=', value);
    }
    return q;
  }
}
