import type { DomainError } from './domain-error.js';

export type Result<T, E extends DomainError = DomainError> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
export const err = <E extends DomainError>(error: E): Result<never, E> => ({ ok: false, error });

/** Unwraps a Result, throwing its error. For use at boundaries and in tests. */
export function unwrap<T, E extends DomainError>(r: Result<T, E>): T {
  if (r.ok) return r.value;
  throw r.error;
}
