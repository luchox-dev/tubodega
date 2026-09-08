/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Insertable, Selectable, Updateable } from 'kysely';
import type { Page } from '@app/common';
import type { DB } from '../../generated/db.js';
import { TransactionContext, type Tx } from '../../kysely/transaction.context.js';
import { RecordNotFoundError } from './errors.js';
import { keyset } from './keyset.js';
import { compileWhere, type Eb, type WhereInput } from './where.js';
import type { FindArgs, FindManyArgs, FindPageArgs, IReadDao, SelectOpts } from './interfaces.js';

export type Model<TB extends keyof DB> = Selectable<DB[TB]>;
export type New<TB extends keyof DB> = Insertable<DB[TB]>;
export type Patch<TB extends keyof DB> = Updateable<DB[TB]>;

/**
 * Reads. Kysely cannot type a query over a table name known only at runtime,
 * so the builders are widened to `any` inside the base and narrowed back on
 * return; concretions keep full typing on their own methods (spec 08 §3).
 *
 * The DAO never opens a transaction: it takes the ambient one from the
 * AsyncLocalStorage and throws outside it. Falling back to the pool would read
 * every organization on the system pool, and fail RLS on the tenant one — a
 * composition bug that must sound like one (spec 08 §6).
 */
export abstract class AbstractReadDao<TB extends keyof DB & string, E>
  implements IReadDao<E, Model<TB>>
{
  protected abstract readonly table: TB;
  /** Primary key columns. One by default; `user_role` and `alert_rule` override. */
  protected readonly idColumns: readonly string[] = ['id'];
  /** Tables with `version` + `updated_at`: update bumps both. */
  protected readonly versioned: boolean = false;

  constructor(protected readonly ctx: TransactionContext) {}

  /** The active transaction. Throws NoActiveTransactionError outside run()/runAs(). */
  protected get db(): Tx {
    return this.ctx.current();
  }

  protected get anyDb(): any {
    return this.ctx.current();
  }

  /** `E` is the id value for a single column, and an object for a composite key. */
  protected keyWhere(id: E): Record<string, unknown> {
    if (this.idColumns.length === 1 && (typeof id !== 'object' || id === null)) {
      return { [this.idColumns[0]!]: id };
    }
    return id as Record<string, unknown>;
  }

  async findUnique(id: E): Promise<Model<TB> | null>;
  async findUnique<K extends keyof Model<TB> & string>(
    id: E,
    opts: SelectOpts<Model<TB>, K>,
  ): Promise<Pick<Model<TB>, K> | null>;
  async findUnique(id: E, opts?: SelectOpts<Model<TB>, any>): Promise<any> {
    const q = this.select(opts).where((eb: Eb) => compileWhere(eb, this.keyWhere(id) as any));
    return (await q.executeTakeFirst()) ?? null;
  }

  async findUniqueOrThrow(id: E): Promise<Model<TB>> {
    const row = await this.findUnique(id);
    if (!row) throw new RecordNotFoundError(this.table, JSON.stringify(id));
    return row;
  }

  /** One column: `IN (…)`. Composite key: an OR of the tuples. */
  async findManyByIds(ids: readonly E[]): Promise<Model<TB>[]> {
    if (ids.length === 0) return [];
    const wheres = ids.map((id) => this.keyWhere(id) as WhereInput<Model<TB>>);
    const where: WhereInput<Model<TB>> =
      this.idColumns.length === 1
        ? ({ [this.idColumns[0]!]: { in: ids } } as WhereInput<Model<TB>>)
        : ({ OR: wheres } as WhereInput<Model<TB>>);
    return this.findMany({ where });
  }

  async findFirst(args: FindArgs<Model<TB>> = {}): Promise<Model<TB> | null> {
    const rows = await this.findMany({ ...args, take: 1 });
    return rows[0] ?? null;
  }

  async findMany(args: FindManyArgs<Model<TB>> = {}): Promise<Model<TB>[]> {
    let q = this.select().where((eb: Eb) => compileWhere(eb, (args.where ?? {}) as any));
    for (const [column, dir] of Object.entries(args.orderBy ?? {})) {
      if (dir) q = q.orderBy(column, dir);
    }
    if (args.take !== undefined) q = q.limit(args.take);
    if (args.skip !== undefined) q = q.offset(args.skip);
    return (await q.execute()) as Model<TB>[];
  }

  /**
   * Keyset: asks for `take + 1` rows and uses the extra one as the answer to
   * `hasMore`, which costs nothing and avoids a second COUNT query.
   */
  async findPage(args: FindPageArgs<Model<TB>>): Promise<Page<Model<TB>>> {
    const ks = keyset({ orderBy: args.orderBy as any, idColumns: this.idColumns, cursor: args.cursor });
    let q = this.select().where((eb: Eb) => {
      const base = compileWhere(eb, (args.where ?? {}) as any);
      const after = ks.predicate(eb);
      return after ? eb.and([base, after]) : base;
    });
    for (const column of ks.columns) q = q.orderBy(column, ks.direction);
    const rows = (await q.limit(args.take + 1).execute()) as Model<TB>[];

    const hasMore = rows.length > args.take;
    const data = hasMore ? rows.slice(0, args.take) : rows;
    const last = data[data.length - 1];
    return {
      data,
      hasMore,
      ...(hasMore && last ? { nextCursor: ks.cursorOf(last as Record<string, unknown>) } : {}),
    };
  }

  async count(where: WhereInput<Model<TB>> = {}): Promise<number> {
    const row = await this.anyDb
      .selectFrom(this.table)
      .select((eb: Eb) => eb.fn.countAll<string>().as('n'))
      .where((eb: Eb) => compileWhere(eb, where as any))
      .executeTakeFirstOrThrow();
    return Number(row.n);
  }

  async exists(where: WhereInput<Model<TB>> = {}): Promise<boolean> {
    const row = await this.anyDb
      .selectFrom(this.table)
      .select((eb: Eb) => eb.lit(1).as('one'))
      .where((eb: Eb) => compileWhere(eb, where as any))
      .limit(1)
      .executeTakeFirst();
    return row !== undefined;
  }

  private select(opts?: SelectOpts<Model<TB>, any>): any {
    const q = this.anyDb.selectFrom(this.table);
    return opts ? q.select(opts.select) : q.selectAll();
  }
}
