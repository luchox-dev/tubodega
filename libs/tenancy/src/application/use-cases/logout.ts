import { Inject, Injectable } from '@nestjs/common';
import { CLOCK, type Clock } from '@app/common';
import type { RequestContext } from '../../domain/request-context.js';
import { SESSION_REPOSITORY, type SessionRepository } from '../ports/session.repository.js';
import { sha256 } from './authenticate.js';

/**
 * Revokes the refresh token presented — but only if it is the caller's own.
 * An unknown, foreign or already revoked token answers exactly the same, so
 * logout cannot be used to probe which tokens exist.
 */
@Injectable()
export class Logout {
  constructor(
    @Inject(SESSION_REPOSITORY) private readonly sessions: SessionRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(ctx: RequestContext, input: { readonly refreshToken: string }): Promise<void> {
    const session = await this.sessions.findByHash(sha256(input.refreshToken));
    if (!session || session.orgId !== ctx.orgId || session.userId !== ctx.userId) return;
    if (session.revokedAt) return;
    await this.sessions.revoke(session.id, this.clock.now());
  }
}
