import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { requestState } from './request-store.js';

/** The definitive RequestContext (spec 10 §2), available after the identity interceptor. */
export const Ctx = createParamDecorator((_data: unknown, context: ExecutionContext) => {
  const state = requestState(context.switchToHttp().getRequest<FastifyRequest>());
  if (!state.ctx) throw new Error('RequestContext not available on a public route');
  return state.ctx;
});

/** The trace id of the current request, for public routes that have no RequestContext. */
export const Trace = createParamDecorator((_data: unknown, context: ExecutionContext) =>
  requestState(context.switchToHttp().getRequest<FastifyRequest>()).traceId,
);
