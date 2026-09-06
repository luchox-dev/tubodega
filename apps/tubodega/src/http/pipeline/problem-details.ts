import { HttpException, HttpStatus } from '@nestjs/common';
import type { DomainError, ProblemFieldError, TraceId } from '@app/common';
import { VersionConflictError } from '@app/persistence';

export const ERROR_TYPE_BASE = 'https://tubodega.app/errors/';

/** RFC 9457 body (spec 03 §5). `type` is the stable identifier clients compare. */
export interface ProblemDetails {
  readonly type: string;
  readonly title: string;
  readonly status: number;
  readonly detail: string;
  readonly instance: string;
  readonly traceId: TraceId;
  readonly errors?: readonly ProblemFieldError[];
  readonly [extension: string]: unknown;
}

const TITLES: Record<number, string> = {
  400: 'Petición inválida',
  401: 'No autenticado',
  403: 'Sin permiso',
  404: 'No encontrado',
  409: 'Conflicto',
  413: 'Contenido demasiado grande',
  415: 'Tipo de contenido no soportado',
  422: 'Regla de dominio violada',
  429: 'Límite de tasa superado',
  500: 'Error interno',
};

export function isDomainError(e: unknown): e is DomainError {
  return (
    e instanceof Error &&
    typeof (e as DomainError).type === 'string' &&
    typeof (e as DomainError).status === 'number'
  );
}

export function toProblem(exception: unknown, instance: string, traceId: TraceId): ProblemDetails {
  if (isDomainError(exception)) {
    return {
      ...exception.extensions,
      type: ERROR_TYPE_BASE + exception.type,
      title: TITLES[exception.status] ?? exception.type,
      status: exception.status,
      detail: exception.message,
      instance,
      traceId,
      ...(exception.errors ? { errors: exception.errors } : {}),
    };
  }
  if (exception instanceof VersionConflictError) {
    return {
      type: ERROR_TYPE_BASE + 'stale-version',
      title: TITLES[409]!,
      status: 409,
      detail: 'El recurso fue modificado por otra petición; vuelve a leerlo y reintenta con If-Match',
      instance,
      traceId,
    };
  }
  if (exception instanceof HttpException) {
    const status = exception.getStatus();
    const type = status === HttpStatus.NOT_FOUND ? 'not-found' : `http-${status}`;
    const body = exception.getResponse();
    const detail = typeof body === 'string' ? body : ((body as { message?: unknown }).message?.toString() ?? exception.message);
    return { type: ERROR_TYPE_BASE + type, title: TITLES[status] ?? type, status, detail, instance, traceId };
  }
  return {
    type: ERROR_TYPE_BASE + 'internal',
    title: TITLES[500]!,
    status: 500,
    detail: 'Error no previsto; consulta el traceId en los registros',
    instance,
    traceId,
  };
}
