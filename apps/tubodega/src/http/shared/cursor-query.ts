import { DomainError, type Cursor } from '@app/common';
import { UUID } from './uuid-param.pipe.js';

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

  const cursor = typeof query.cursor === 'string' && query.cursor !== '' ? (query.cursor as Cursor) : undefined;

  const rawLimit = query.limit;
  let limit = DEFAULT_LIMIT;
  if (rawLimit !== undefined) {
    limit = Number(rawLimit);
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
      throw new InvalidFilterError('limit', `"limit" debe ser un entero entre 1 y ${MAX_LIMIT}`);
    }
  }

  // Una colección puede declarar que no ofrece orden, con `sortable: []`. El
  // saldo es el caso: su único orden con sentido es su clave natural, y ofrecer
  // otro sería ofrecer un seq scan. Entonces un `?sort=` explícito es un
  // parámetro que no se admite —como cualquier filtro no declarado (D-10)— en
  // lugar de algo que se acepta y se descarta sin decirlo. Aceptar y tirar es
  // lo único inadmisible: el cliente se queda creyendo que ordenó.
  if (opts.sortable.length === 0) {
    if (query.sort !== undefined) {
      throw new InvalidFilterError('sort', 'Este listado no admite ordenación');
    }
    return { limit, sort: { field: opts.defaultSort, dir: 'asc' }, ...(cursor ? { cursor } : {}) };
  }

  const rawSort = typeof query.sort === 'string' && query.sort !== '' ? query.sort : opts.defaultSort;
  const dir = rawSort.startsWith('-') ? 'desc' : 'asc';
  const field = rawSort.startsWith('-') ? rawSort.slice(1) : rawSort;
  if (!opts.sortable.includes(field)) {
    throw new InvalidFilterError('sort', `No se puede ordenar por "${field}"`);
  }

  return { limit, sort: { field, dir }, ...(cursor ? { cursor } : {}) };
}

/**
 * Un identificador que llega por la query. Se comprueba la forma aquí por la
 * misma razón que la comprueba `UuidParam` en la ruta: un id mal escrito no
 * debe llegar a la base, donde el cast a uuid sale como 500 y llena el log de
 * ruido por lo que es claramente un error del cliente.
 *
 * La diferencia con la ruta es el código, y es deliberada: en la ruta, un id
 * que no existe y uno mal formado son la misma cosa —404, nunca 403 (I-6)— y
 * en la query un id es un filtro, así que un filtro ilegible es `invalid-filter`
 * como cualquier otro. El caso que más se da en la práctica no es una errata
 * sino el literal «null» de un cliente cuya variable venía vacía.
 */
export function idFilter(query: Record<string, unknown>, key: string): string | undefined {
  const raw = query[key];
  if (raw === undefined) return undefined;
  if (typeof raw !== 'string' || !UUID.test(raw)) {
    throw new InvalidFilterError(key, `"${key}" debe ser un identificador`);
  }
  return raw;
}
