/* eslint-disable @typescript-eslint/no-explicit-any */
import { sql } from 'kysely';
import type { DB } from '../../generated/db.js';
import { AbstractAppendDao } from './abstract-append.dao.js';
import type { Model, New, Patch } from './abstract-read.dao.js';
import { RecordNotFoundError, VersionConflictError, translatePgError } from './errors.js';
import { compileWhere, type Eb, type WhereInput } from './where.js';
import type { IBaseDao, UpdateOpts } from './interfaces.js';

/** The full CRUD, for mutable tables. */
export abstract class AbstractBaseDao<TB extends keyof DB & string, E>
  extends AbstractAppendDao<TB, E>
  implements IBaseDao<E, Model<TB>, New<TB>, Patch<TB>>
{
  /**
   * Columns of the ON CONFLICT of `upsert`. Defaults to the key columns, and
   * differs only in the Org family, where the lookup key carries `org_id` but
   * the unique index behind the conflict is the real primary key.
   */
  protected get conflictColumns(): readonly string[] {
    return this.idColumns;
  }

  /**
   * Optimistic locking (spec 08 §4): zero rows affected has two causes, and a
   * second read by key tells them apart. Without `expectedVersion` the version
   * still moves — a write with no condition is still a new version.
   */
  async update(id: E, data: Patch<TB>, opts: UpdateOpts = {}): Promise<Model<TB>> {
    const patch: Record<string, any> = { ...data };
    if (this.versioned) {
      patch.version = sql`version + 1`;
      patch.updatedAt = sql`now()`;
    }
    let q = this.anyDb
      .updateTable(this.table)
      .set(patch)
      .where((eb: Eb) => compileWhere(eb, this.keyWhere(id) as any));
    if (opts.expectedVersion !== undefined) q = q.where('version', '=', opts.expectedVersion);

    let row: unknown;
    try {
      row = await q.returningAll().executeTakeFirst();
    } catch (e) {
      translatePgError(e);
    }
    if (row) return row as Model<TB>;
    if (!(await this.findUnique(id))) throw new RecordNotFoundError(this.table, JSON.stringify(id));
    throw new VersionConflictError(this.table, JSON.stringify(id));
  }

  async updateMany(where: WhereInput<Model<TB>>, data: Patch<TB>): Promise<number> {
    const patch: Record<string, any> = { ...data };
    if (this.versioned) {
      patch.version = sql`version + 1`;
      patch.updatedAt = sql`now()`;
    }
    try {
      const res = await this.anyDb
        .updateTable(this.table)
        .set(patch)
        .where((eb: Eb) => compileWhere(eb, where as any))
        .executeTakeFirst();
      return Number(res.numUpdatedRows ?? 0);
    } catch (e) {
      translatePgError(e);
    }
  }

  /** ON CONFLICT over the primary key only; any other unique is a concrete method. */
  async upsert(id: E, create: New<TB>, update: Patch<TB>): Promise<Model<TB>> {
    try {
      return (await this.anyDb
        .insertInto(this.table)
        .values(create)
        .onConflict((oc: any) => oc.columns(this.conflictColumns).doUpdateSet(update))
        .returningAll()
        .executeTakeFirstOrThrow()) as Model<TB>;
    } catch (e) {
      translatePgError(e);
    }
  }

  async delete(id: E): Promise<Model<TB>> {
    const row = await this.anyDb
      .deleteFrom(this.table)
      .where((eb: Eb) => compileWhere(eb, this.keyWhere(id) as any))
      .returningAll()
      .executeTakeFirst();
    if (!row) throw new RecordNotFoundError(this.table, JSON.stringify(id));
    return row as Model<TB>;
  }

  async deleteMany(where: WhereInput<Model<TB>>): Promise<number> {
    const res = await this.anyDb
      .deleteFrom(this.table)
      .where((eb: Eb) => compileWhere(eb, where as any))
      .executeTakeFirst();
    return Number(res.numDeletedRows ?? 0);
  }
}
