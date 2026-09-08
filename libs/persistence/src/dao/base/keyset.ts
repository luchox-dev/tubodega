import { sql, type Expression, type SqlBool } from 'kysely';
import { decodeCursor, encodeCursor, type Cursor, type CursorParts } from '@app/common';
import { InvalidCursorError } from './errors.js';
import type { Eb } from './where.js';

/**
 * Keyset pagination (spec 08 §4, 03 §6): the next page is
 * `WHERE (col, id…) > ($value, $id…)` with the same ordering. Stable under
 * concurrent inserts, which OFFSET is not, and it does not degrade as the
 * collection grows.
 */
export interface Keyset {
  /** Order columns: the sort column, then the id columns as tie-break. */
  readonly columns: readonly string[];
  readonly direction: 'asc' | 'desc';
  /** The cursor predicate, or null when this is the first page. */
  predicate(eb: Eb): Expression<SqlBool> | null;
  cursorOf(row: Record<string, unknown>): Cursor;
}

/** Cursor parts must survive base64 + JSON: dates travel as ISO strings. */
const toPart = (value: unknown): string | number | null => {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  return typeof value === 'number' ? value : String(value);
};

export function keyset(args: {
  orderBy?: Record<string, 'asc' | 'desc' | undefined>;
  idColumns: readonly string[];
  cursor?: Cursor;
}): Keyset {
  const sortEntry = Object.entries(args.orderBy ?? {}).find(([, dir]) => dir !== undefined);
  const direction = sortEntry?.[1] ?? 'asc';
  const columns = sortEntry ? [sortEntry[0], ...args.idColumns] : [...args.idColumns];

  let parts: CursorParts | null = null;
  if (args.cursor !== undefined) {
    parts = decodeCursor(args.cursor);
    // Wrong arity means the cursor was made for another ordering: continuing
    // would silently skip or repeat rows, so it is rejected like garbage.
    if (!parts || parts.length !== columns.length) throw new InvalidCursorError();
  }

  return {
    columns,
    direction,
    predicate(eb) {
      if (!parts) return null;
      const op = direction === 'asc' ? '>' : '<';
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const refs = sql.join(columns.map((c) => eb.ref(c as any)));
      const values = sql.join(parts.map((p) => sql.val(p)));
      return sql<SqlBool>`(${refs}) ${sql.raw(op)} (${values})`;
    },
    cursorOf: (row) => encodeCursor(columns.map((c) => toPart(row[c]))),
  };
}

export { encodeCursor };
