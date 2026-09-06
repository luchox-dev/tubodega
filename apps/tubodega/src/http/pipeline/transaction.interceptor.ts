import { Injectable, type CallHandler, type ExecutionContext, type NestInterceptor } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { from, lastValueFrom, type Observable } from 'rxjs';
import { KyselyUnitOfWork, type TxScope } from '@app/persistence';
import { requestState } from './request-state.js';

/**
 * Step 3 (spec 07 §3): one request, one transaction — reads included, because
 * RLS needs SET LOCAL and SET LOCAL needs a transaction. GET/HEAD open READ
 * ONLY. Everything downstream (identity, pipes, handler) runs inside.
 */
@Injectable()
export class TransactionInterceptor implements NestInterceptor {
  constructor(private readonly uow: KyselyUnitOfWork) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<FastifyRequest>();
    const state = requestState(req);
    const scope: TxScope = state.isPublic
      ? { pool: 'system' }
      : { pool: 'tenant', orgId: state.claims!.org };
    const readOnly = req.method === 'GET' || req.method === 'HEAD';
    return from(this.uow.runAs(scope, () => lastValueFrom(next.handle()), { readOnly }));
  }
}
