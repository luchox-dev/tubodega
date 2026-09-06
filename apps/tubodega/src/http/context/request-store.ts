import type { FastifyRequest } from 'fastify';
import type { TraceId } from '@app/common';
import type { RequestContext, TokenClaims } from '@app/tenancy';

/**
 * Per-request state, attached to the Fastify request by the trace hook and
 * filled in by the guard and the interceptors (spec 07 §3). Kept on the
 * request object rather than in AsyncLocalStorage: every reader has the
 * request at hand and nothing can leak between requests.
 */
export interface RequestState {
  traceId: TraceId;
  /** Route marked @Public(): no token, system pool. */
  isPublic: boolean;
  /** From the token, verified but not yet checked against the database. */
  claims?: TokenClaims;
  /** Definitive context: user loaded inside the transaction, roles from the database. */
  ctx?: RequestContext;
}

const KEY = Symbol.for('tubodega.request-state');

type Carrier = { [KEY]?: RequestState };

export function initRequestState(req: FastifyRequest, traceId: TraceId): RequestState {
  const state: RequestState = { traceId, isPublic: false };
  (req as unknown as Carrier)[KEY] = state;
  return state;
}

export function requestState(req: FastifyRequest): RequestState {
  const state = (req as unknown as Carrier)[KEY];
  if (!state) throw new Error('request state not initialised: is the trace-id hook registered?');
  return state;
}
