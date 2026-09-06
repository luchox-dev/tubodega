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

interface PgError {
  code?: string;
  constraint?: string;
}

/** Maps driver errors to the errors above; rethrows anything else untouched. */
export function translatePgError(e: unknown): never {
  const pg = e as PgError;
  if (pg?.code === '23505') throw new UniqueViolationError(pg.constraint ?? 'unknown');
  throw e;
}
