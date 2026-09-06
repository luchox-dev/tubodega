import { Inject, Injectable, type CallHandler, type ExecutionContext, type NestInterceptor } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { from, switchMap, type Observable } from 'rxjs';
import { InvalidCredentialsError, USER_REPOSITORY, type UserRepository } from '@app/tenancy';
import { requestState } from '../context/request-store.js';

/**
 * Step 4 (spec 07 §3): inside the transaction, with RLS active, load the user.
 * Inactive → 401 (T-6). Roles come from the database, never from the token,
 * so revoking a role takes effect on the next request.
 */
@Injectable()
export class IdentityInterceptor implements NestInterceptor {
  constructor(@Inject(USER_REPOSITORY) private readonly users: UserRepository) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const state = requestState(context.switchToHttp().getRequest<FastifyRequest>());
    if (state.isPublic) return next.handle();
    return from(this.resolve(state)).pipe(switchMap(() => next.handle()));
  }

  private async resolve(state: ReturnType<typeof requestState>): Promise<void> {
    const claims = state.claims!;
    const user = await this.users.findById(claims.org, claims.sub);
    if (!user || !user.active) throw new InvalidCredentialsError();
    state.ctx = { orgId: user.orgId, userId: user.id, roles: user.roles, traceId: state.traceId };
  }
}
