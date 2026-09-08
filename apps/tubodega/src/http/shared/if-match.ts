import { DomainError } from '@app/common';

/**
 * Decision D-10. `If-Match` is mandatory on PATCH of a versioned resource
 * (spec 03 §9): without it a client would overwrite a change it never saw, and
 * silently defaulting to "whatever the current version is" would make the
 * header decorative.
 */
export class MissingIfMatchError extends DomainError {
  readonly type = 'missing-if-match';
  readonly status = 400;
  constructor() {
    super('Falta la cabecera If-Match con la versión del recurso');
  }
}

/** Accepts `3`, `"3"` and the weak form `W/"3"`; `*` is not a version. */
export function parseIfMatch(header: string | undefined): number {
  const raw = header?.trim().replace(/^W\//, '').replace(/^"|"$/g, '') ?? '';
  if (!/^\d+$/.test(raw)) throw new MissingIfMatchError();
  return Number(raw);
}
