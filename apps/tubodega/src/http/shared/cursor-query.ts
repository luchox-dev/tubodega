import { DomainError, type Cursor } from '@app/common';

/**
 * Decision D-10. Spec 03 §8 says each module declares what may be filtered and
 * ordered, and that anything else is rejected: accepting arbitrary filters
 * opens the door to unindexed queries that take the database down, and makes
 * it impossible to reason about performance.
 */
export class InvalidFilterError extends DomainError {
  readonly type = 'invalid-filter';
  readonly status = 400;
  constructor(parameter: string, detail?: string) {
    super(detail ?? `El parámetro "${parameter}" no se admite en este listado`, {
      errors: [{ pointer: `/${parameter}`, code: 'invalid-filter' }],
    });
  }
}

export interface PageQuery {
  readonly limit: number;
  readonly cursor?: Cursor;
  readonly sort: { readonly field: string; readonly dir: 'asc' | 'desc' };
}

export interface PageOptions {
  readonly sortable: readonly string[];
  readonly defaultSort: string;
  readonly filters: readonly string[];
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const RESERVED = ['limit', 'cursor', 'sort'];

/** Parses `limit`, `cursor` and `sort`, and refuses every query key not declared. */
export function parsePage(query: Record<string, unknown>, opts: PageOptions): PageQuery {
  for (const key of Object.keys(query)) {
    if (!RESERVED.includes(key) && !opts.filters.includes(key)) throw new InvalidFilterError(key);
  }

  const rawLimit = query.limit;
  let limit = DEFAULT_LIMIT;
  if (rawLimit !== undefined) {
    limit = Number(rawLimit);
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
      throw new InvalidFilterError('limit', `"limit" debe ser un entero entre 1 y ${MAX_LIMIT}`);
    }
  }

  const rawSort = typeof query.sort === 'string' && query.sort !== '' ? query.sort : opts.defaultSort;
  const dir = rawSort.startsWith('-') ? 'desc' : 'asc';
  const field = rawSort.startsWith('-') ? rawSort.slice(1) : rawSort;
  if (!opts.sortable.includes(field)) {
    throw new InvalidFilterError('sort', `No se puede ordenar por "${field}"`);
  }

  const cursor = typeof query.cursor === 'string' && query.cursor !== '' ? (query.cursor as Cursor) : undefined;
  return { limit, sort: { field, dir }, ...(cursor ? { cursor } : {}) };
}
