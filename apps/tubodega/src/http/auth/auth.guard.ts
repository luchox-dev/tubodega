import { Inject, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';
import { InvalidCredentialsError, TOKEN_ISSUER, TokenExpiredError, type TokenIssuer } from '@app/tenancy';
import { requestState } from '../context/request-store.js';
import { IS_PUBLIC } from './public.decorator.js';

/**
 * Step 2 (spec 07 §3): verifies signature and expiry. No database — whether
 * the user is still active and which roles they hold is checked later, inside
 * the transaction, by the identity interceptor.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(TOKEN_ISSUER) private readonly tokens: TokenIssuer,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<FastifyRequest>();
    const state = requestState(req);
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [context.getHandler(), context.getClass()]);
    if (isPublic) {
      state.isPublic = true;
      return true;
    }
    const header = req.headers.authorization;
    const token = typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    if (!token) throw new InvalidCredentialsError();
    const result = await this.tokens.verify(token);
    if (!result.ok) throw result.reason === 'expired' ? new TokenExpiredError() : new InvalidCredentialsError();
    state.claims = result.claims;
    return true;
  }
}
