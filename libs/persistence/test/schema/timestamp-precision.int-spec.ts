import { sql } from 'kysely';
import { createPersistenceHarness } from '../../../../test/support/db.js';

/**
 * D-68: every timestamp column in the schema is `timestamptz(3)`.
 *
 * This is the guard D-67 did not leave behind. That fix named three columns
 * one by one, and the list was already short the day it was written —
 * `movement.occurred_at` was a fourth cursor key, called safe because of how
 * today's code happens to write it. A whitelist here would inherit the same
 * failure mode: somebody has to remember to widen it the day a new table gains
 * a `createdAt` in its `sortable`. So no list is kept. The property is checked.
 *
 * The property is true of the whole system and not only of cursors: a
 * JavaScript `Date` reaches the millisecond, and everything that comes out of
 * Postgres passes through one. A microsecond column stores something nothing
 * in this codebase can read back — which is not extra information, it is a
 * trap. `pnpm db:check` cannot see this: a new table declared with a bare
 * `@db.Timestamptz` in both the schema and its migration is perfectly
 * consistent, and reproduces D-67 whole.
 *
 * `test/schema/rls.int-spec.ts` is the house precedent for asserting a property
 * of the live DDL rather than of a file, and this is its sibling.
 */
describe('la precisión de las marcas de tiempo (D-68)', () => {
  let h: Awaited<ReturnType<typeof createPersistenceHarness>>;

  beforeAll(async () => {
    h = await createPersistenceHarness();
  }, 60_000);
  afterAll(() => h.close());

  /** Prisma's own bookkeeping table is not ours to shape. */
  const OURS = sql`table_schema = 'public' and table_name <> '_prisma_migrations'`;

  // The factory runs Kysely's CamelCasePlugin, so `table_name` arrives as `tableName`
  // even out of a raw query. Naming the snake_case columns here reads back undefined.
  const columns = async (dataType: string) => {
    const { rows } = await sql<{ tableName: string; columnName: string; datetimePrecision: number }>`
      select table_name, column_name, datetime_precision
        from information_schema.columns
       where ${OURS} and data_type = ${dataType}
         and datetime_precision is distinct from 3
       order by table_name, column_name
    `.execute(h.factory.get('system'));
    return rows.map((r) => `${r.tableName}.${r.columnName} (${r.datetimePrecision})`);
  };

  it('ninguna timestamptz guarda más precisión de la que un Date sabe leer', async () => {
    expect(await columns('timestamp with time zone')).toEqual([]);
  });

  /**
   * The twin hole: a Prisma `DateTime` **without** `@db.Timestamptz` lands as
   * `timestamp(3)` — right precision, no time zone — and would sail past the
   * case above. Spec 04 wants the zone on every instant we store.
   */
  it('ninguna columna de fecha pierde la zona horaria', async () => {
    const { rows } = await sql<{ tableName: string; columnName: string }>`
      select table_name, column_name
        from information_schema.columns
       where ${OURS} and data_type = 'timestamp without time zone'
       order by table_name, column_name
    `.execute(h.factory.get('system'));
    expect(rows.map((r) => `${r.tableName}.${r.columnName}`)).toEqual([]);
  });
});
