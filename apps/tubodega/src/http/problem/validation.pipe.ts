import { ValidationPipe, type ValidationError } from '@nestjs/common';
import { DomainError, type ProblemFieldError } from '@app/common';

/** 400 validation-failed with one `errors[]` entry per offending field, `pointer` as JSON Pointer. */
export class ValidationFailedError extends DomainError {
  readonly type = 'validation-failed';
  readonly status = 400;
  constructor(errors: readonly ProblemFieldError[]) {
    super('La petición no supera la validación', { errors });
  }
}

function flatten(errors: ValidationError[], prefix = ''): ProblemFieldError[] {
  return errors.flatMap((e) => {
    const pointer = `${prefix}/${e.property}`;
    const own = Object.entries(e.constraints ?? {}).map(([code, message]) => ({ pointer, code, message }));
    return [...own, ...flatten(e.children ?? [], pointer)];
  });
}

/**
 * whitelist strips unknown fields silently — an `orgId` in the body is ignored,
 * never honoured (T-4, decision D-10). transform applies DTO types.
 */
export function buildValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: false,
    transform: true,
    stopAtFirstError: false,
    exceptionFactory: (errors) => new ValidationFailedError(flatten(errors)),
  });
}
