import { Catch, Logger, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { TraceId } from '@app/common';
import { toProblem } from './problem-details.js';

/**
 * Step 9 (spec 07 §3): DomainError → problem+json; VersionConflictError →
 * 409 stale-version; anything else → 500 without internals, logged with the
 * traceId. Runs after the transaction interceptor rolled back.
 */
@Catch()
export class DomainErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger('http');

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const req = http.getRequest<FastifyRequest>();
    const reply = http.getResponse<FastifyReply>();
    const traceId = (reply.getHeader('x-request-id') as string | undefined ?? 'unknown') as TraceId;
    const instance = req.url.split('?')[0]!;
    const problem = toProblem(exception, instance, traceId);
    if (problem.status >= 500) {
      this.logger.error({ traceId, instance, err: exception instanceof Error ? exception.stack : exception });
    }
    void reply.status(problem.status).header('content-type', 'application/problem+json').send(problem);
  }
}
