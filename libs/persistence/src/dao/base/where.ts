import type { Expression, ExpressionBuilder, SqlBool } from 'kysely';
import type { DB } from '../../generated/db.js';

/**
 * The `where` DSL of spec 08 §5. It covers what most queries need; the 20 %
 * that does not fit — JSONB containment, `path LIKE`, subqueries, comparing
 * two columns — is a callback with Kysely's own ExpressionBuilder, which can
 * be mixed into an `AND`/`OR` of the DSL. The DSL does not grow to absorb
 * those: when a filter does not fit, the answer is a three-line callback, not
 * a new operator.
 */
export type Eb = ExpressionBuilder<DB, keyof DB>;

/** The escape hatch: full Kysely typing, usable anywhere a filter is accepted. */
export type WhereCallback = (eb: Eb) => Expression<SqlBool>;

export interface FieldFilter<V> {
  equals?: V | null;
  not?: V | null;
  in?: readonly V[];
  notIn?: readonly V[];
  lt?: V;
  lte?: V;
  gt?: V;
  gte?: V;
  contains?: string;
  startsWith?: string;
  endsWith?: string;
  /** Applies to contains / startsWith / endsWith: LIKE becomes ILIKE. */
  mode?: 'insensitive';
}

export type Where<T> = {
  [K in keyof T]?: T[K] | null | FieldFilter<T[K]>;
} & {
  AND?: readonly WhereInput<T>[];
  OR?: readonly WhereInput<T>[];
  NOT?: WhereInput<T>;
};

export type WhereInput<T> = Where<T> | WhereCallback;

const COMPARATORS = { lt: '<', lte: '<=', gt: '>', gte: '>=' } as const;

/**
 * Escapes the LIKE wildcards of a *value*, so `contains: '50%'` looks for a
 * literal per cent sign instead of matching everything. Postgres uses `\` as
 * the default LIKE escape character, so no ESCAPE clause is needed.
 */
export const escapeLike = (value: string): string => value.replace(/[\\%_]/g, (c) => `\\${c}`);

const isFieldFilter = (v: unknown): v is FieldFilter<unknown> =>
  typeof v === 'object' && v !== null && !(v instanceof Date) && !Array.isArray(v);

/** Pure: takes Kysely's expression builder and a filter, returns one boolean expression. */
export function compileWhere<T>(eb: Eb, where: WhereInput<T>): Expression<SqlBool> {
  if (typeof where === 'function') return where(eb);

  const parts: Expression<SqlBool>[] = [];
  for (const [key, value] of Object.entries(where as Record<string, unknown>)) {
    if (value === undefined) continue;
    if (key === 'AND') {
      parts.push(...(value as readonly WhereInput<T>[]).map((w) => compileWhere(eb, w)));
    } else if (key === 'OR') {
      const or = (value as readonly WhereInput<T>[]).map((w) => compileWhere(eb, w));
      parts.push(or.length === 0 ? eb.lit(false) : eb.or(or));
    } else if (key === 'NOT') {
      parts.push(eb.not(compileWhere(eb, value as WhereInput<T>)));
    } else {
      parts.push(field(eb, key, value));
    }
  }
  return parts.length === 0 ? eb.lit(true) : eb.and(parts);
}

function field(eb: Eb, column: string, value: unknown): Expression<SqlBool> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const col = column as any;
  if (value === null) return eb(col, 'is', null);
  if (!isFieldFilter(value)) return eb(col, '=', value);

  const parts: Expression<SqlBool>[] = [];
  const f = value;
  if ('equals' in f) parts.push(f.equals === null ? eb(col, 'is', null) : eb(col, '=', f.equals));
  if ('not' in f) parts.push(f.not === null ? eb(col, 'is not', null) : eb(col, '!=', f.not));
  // An empty list is FALSE (and an empty exclusion is TRUE): `IN ()` is a
  // syntax error in SQL, and "no candidates" is a legitimate filter.
  if (f.in !== undefined) parts.push(f.in.length === 0 ? eb.lit(false) : eb(col, 'in', f.in));
  if (f.notIn !== undefined) parts.push(f.notIn.length === 0 ? eb.lit(true) : eb(col, 'not in', f.notIn));
  for (const [key, op] of Object.entries(COMPARATORS)) {
    const bound = f[key as keyof typeof COMPARATORS];
    if (bound !== undefined) parts.push(eb(col, op, bound));
  }
  const like = f.mode === 'insensitive' ? 'ilike' : 'like';
  if (f.contains !== undefined) parts.push(eb(col, like, `%${escapeLike(f.contains)}%`));
  if (f.startsWith !== undefined) parts.push(eb(col, like, `${escapeLike(f.startsWith)}%`));
  if (f.endsWith !== undefined) parts.push(eb(col, like, `%${escapeLike(f.endsWith)}`));

  return parts.length === 0 ? eb.lit(true) : eb.and(parts);
}
