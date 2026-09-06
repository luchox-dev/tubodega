import type { FastifyInstance } from 'fastify';
import { isUuid, type IdGenerator, type TraceId } from '@app/common';
import { initRequestState } from './request-store.js';

/**
 * Step 1 of the request (spec 07 §3, §8): X-Request-Id is honoured only if it
 * is a valid UUID (trace_id columns are uuid); otherwise a UUIDv7 is minted.
 * The response always carries the value used.
 */
export function registerTraceIdHook(fastify: FastifyInstance, ids: IdGenerator): void {
  fastify.addHook('onRequest', (req, reply, done) => {
    const given = req.headers['x-request-id'];
    const traceId = (typeof given === 'string' && isUuid(given) ? given.toLowerCase() : ids.next()) as TraceId;
    reply.header('X-Request-Id', traceId);
    initRequestState(req, traceId);
    done();
  });
}
