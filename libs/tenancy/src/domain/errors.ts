import { DomainError } from '@app/common';

export class InvalidEmailError extends DomainError {
  readonly type = 'invalid-email';
  readonly status = 422;
  constructor(raw: string) {
    super(`"${raw}" no es un correo válido`, { errors: [{ pointer: '/email', code: 'invalid-email' }] });
  }
}

export class InvalidSlugError extends DomainError {
  readonly type = 'invalid-slug';
  readonly status = 422;
  constructor(raw: string) {
    super(`"${raw}" no es un slug válido: minúsculas, dígitos y guiones, 3-64 caracteres`, {
      errors: [{ pointer: '/slug', code: 'invalid-slug' }],
    });
  }
}

export class SlugTakenError extends DomainError {
  readonly type = 'slug-taken';
  readonly status = 409;
  constructor(slug: string) {
    super(`El slug "${slug}" ya está en uso`);
  }
}

export class EmailTakenError extends DomainError {
  readonly type = 'email-taken';
  readonly status = 409;
  constructor(email: string) {
    super(`El correo "${email}" ya existe en esta organización`);
  }
}

/** Covers unknown email, wrong password and inactive user with one message (spec 10 §9). */
export class InvalidCredentialsError extends DomainError {
  readonly type = 'invalid-credentials';
  readonly status = 401;
  constructor() {
    super('Credenciales inválidas');
  }
}

export class TokenExpiredError extends DomainError {
  readonly type = 'token-expired';
  readonly status = 401;
  constructor() {
    super('El token de acceso ha expirado');
  }
}

export class AmbiguousLoginError extends DomainError {
  readonly type = 'ambiguous-login';
  readonly status = 409;
  constructor() {
    super('El correo existe en varias organizaciones; indica el slug de la organización');
  }
}

export class InsufficientRoleError extends DomainError {
  readonly type = 'insufficient-role';
  readonly status = 403;
  constructor(action: string) {
    super(`La acción ${action} requiere un rol que el usuario no tiene`);
  }
}

export class LastOwnerError extends DomainError {
  readonly type = 'last-owner';
  readonly status = 422;
  constructor() {
    super('La operación dejaría la organización sin ningún OWNER activo');
  }
}

/**
 * Unknown, revoked, expired — and also a token whose user was deactivated
 * (T-6 applies to rotation, not only to access). One type for all of them, for
 * the same reason `invalid-credentials` covers three cases (spec 10 §9).
 */
export class RefreshTokenInvalidError extends DomainError {
  readonly type = 'refresh-token-invalid';
  readonly status = 401;
  constructor() {
    super('El token de refresco no es válido');
  }
}

/**
 * A resource of another organization does not exist as far as this one is
 * concerned: 404 and never 403 (I-6). Telling them apart would leak which ids
 * are real elsewhere.
 */
export class UserNotFoundError extends DomainError {
  readonly type = 'not-found';
  readonly status = 404;
  constructor() {
    super('No existe ese usuario');
  }
}
