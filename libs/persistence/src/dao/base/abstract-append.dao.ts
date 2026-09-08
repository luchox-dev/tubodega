/* eslint-disable @typescript-eslint/no-explicit-any */
import type { DB } from '../../generated/db.js';
import { AbstractReadDao, type Model, type New } from './abstract-read.dao.js';
import { translatePgError } from './errors.js';
import type { IAppendDao } from './interfaces.js';

/** The batch size of `createMany`: past this, one statement stops paying off. */
const CHUNK = 1000;

/**
 * Reads plus inserts. This is where `movement`, `step_completion` and
 * `outbox_event` stop: an append-only table has no `update` in its type, which
 * is the first layer of I-3 — the REVOKE is the second (spec 04 §3.4).
 */
export abstract class AbstractAppendDao<TB extends keyof DB & string, E>
  extends AbstractReadDao<TB, E>
  implements IAppendDao<E, Model<TB>, New<TB>>
{
  async create(data: New<TB>): Promise<Model<TB>> {
    try {
      return (await this.anyDb
        .insertInto(this.table)
        .values(data)
        .returningAll()
        .executeTakeFirstOrThrow()) as Model<TB>;
    } catch (e) {
      translatePgError(e);
    }
  }

  /** RETURNING is free in Postgres, so this is Prisma's `createManyAndReturn`. */
  async createMany(data: readonly New<TB>[]): Promise<Model<TB>[]> {
    const out: Model<TB>[] = [];
    for (let i = 0; i < data.length; i += CHUNK) {
      const chunk = data.slice(i, i + CHUNK);
      if (chunk.length === 0) continue;
      try {
        out.push(...((await this.anyDb.insertInto(this.table).values(chunk).returningAll().execute()) as Model<TB>[]));
      } catch (e) {
        translatePgError(e);
      }
    }
    return out;
  }
}
