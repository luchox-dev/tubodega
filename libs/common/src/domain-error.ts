/** One entry of `errors[]` in a problem+json body (spec 03 §5). `pointer` is a JSON Pointer. */
export interface ProblemFieldError {
  readonly pointer: string;
  readonly code: string;
  readonly [extra: string]: unknown;
}

/**
 * Base of every business error. Carries its own problem+json `type` and HTTP
 * `status` so the exception filter translates it without knowing the concrete
 * class (spec 01 §4). Business rules *return* these inside a Result; only
 * infrastructure throws.
 */
export abstract class DomainError extends Error {
  abstract readonly type: string;
  abstract readonly status: number;
  readonly errors?: readonly ProblemFieldError[];
  readonly extensions?: Readonly<Record<string, unknown>>;

  constructor(
    detail: string,
    opts?: {
      readonly errors?: readonly ProblemFieldError[];
      readonly extensions?: Readonly<Record<string, unknown>>;
    },
  ) {
    super(detail);
    this.name = new.target.name;
    this.errors = opts?.errors;
    this.extensions = opts?.extensions;
  }
}
