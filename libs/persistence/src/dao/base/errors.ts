/**
 * Data-access errors (spec 08 §6). libs/persistence throws; repositories
 * translate to domain errors or null, and the exception filter maps
 * VersionConflictError to 409 stale-version.
 */
export class RecordNotFoundError extends Error {
  constructor(
    readonly table: string,
    readonly id: string,
  ) {
    super(`${table}#${id} not found`);
    this.name = 'RecordNotFoundError';
  }
}

export class VersionConflictError extends Error {
  constructor(
    readonly table: string,
    readonly id: string,
  ) {
    super(`${table}#${id} was modified by someone else`);
    this.name = 'VersionConflictError';
  }
}

/** Postgres 23505, carrying the constraint name so the repository can tell which unique was hit. */
export class UniqueViolationError extends Error {
  constructor(readonly constraint: string) {
    super(`unique violation: ${constraint}`);
    this.name = 'UniqueViolationError';
  }
}

/** Postgres 23514: a CHECK the schema declares and the domain also states. */
export class CheckViolationError extends Error {
  constructor(readonly constraint: string) {
    super(`check violation: ${constraint}`);
    this.name = 'CheckViolationError';
  }
}

/** Postgres 23503: a composite FK (org_id, x_id) that does not resolve. */
export class ForeignKeyViolationError extends Error {
  constructor(readonly constraint: string) {
    super(`foreign key violation: ${constraint}`);
    this.name = 'ForeignKeyViolationError';
  }
}

/**
 * An opaque cursor the client sent back mangled, or one built for a different
 * ordering. The edge turns it into 400 invalid-filter; continuing with it
 * would silently skip or repeat rows.
 */
export class InvalidCursorError extends Error {
  constructor() {
    super('unreadable cursor');
    this.name = 'InvalidCursorError';
  }
}

interface PgError {
  code?: string;
  constraint?: string;
}

/** Maps driver errors to the errors above; rethrows anything else untouched. */
export function translatePgError(e: unknown): never {
  const pg = e as PgError;
  if (pg?.code === '23505') throw new UniqueViolationError(pg.constraint ?? 'unknown');
  if (pg?.code === '23514') throw new CheckViolationError(pg.constraint ?? 'unknown');
  if (pg?.code === '23503') throw new ForeignKeyViolationError(pg.constraint ?? 'unknown');
  throw e;
}
