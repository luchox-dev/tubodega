import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CLOCK, ID_GENERATOR, durationToMs, type Clock, type EnvironmentVariables, type IdGenerator } from '@app/common';
import { RefreshTokenInvalidError } from '../../domain/errors.js';
import { SESSION_REPOSITORY, type SessionRepository } from '../ports/session.repository.js';
import { RANDOM_TOKEN, TOKEN_ISSUER, type RandomToken, type TokenIssuer } from '../ports/token-issuer.js';
import { USER_REPOSITORY, type UserRepository } from '../ports/user.repository.js';
import { sha256 } from './authenticate.js';

export interface RefreshSessionOutput {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresIn: number;
}

/**
 * Rotation (spec 10 §4): the token presented is revoked and a new pair is
 * issued. Without server state, "revoking" would mean nothing — a signed
 * refresh JWT would stay valid until it expired.
 *
 * Runs in system context: the organization is only known once the hash
 * resolves to a session (spec 07 §2).
 */
@Injectable()
export class RefreshSession {
  constructor(
    @Inject(SESSION_REPOSITORY) private readonly sessions: SessionRepository,
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(TOKEN_ISSUER) private readonly tokens: TokenIssuer,
    @Inject(RANDOM_TOKEN) private readonly random: RandomToken,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(ID_GENERATOR) private readonly ids: IdGenerator,
    private readonly config: ConfigService<EnvironmentVariables, true>,
  ) {}

  async execute(input: { readonly refreshToken: string }): Promise<RefreshSessionOutput> {
    const now = this.clock.now();
    const session = await this.sessions.findByHash(sha256(input.refreshToken));
    if (!session || session.revokedAt || session.expiresAt.getTime() <= now.getTime()) {
      throw new RefreshTokenInvalidError();
    }

    // T-6 applies to rotation too: a deactivated user must not be able to keep
    // a session alive by refreshing it.
    const user = await this.users.findById(session.orgId, session.userId);
    if (!user || !user.active) throw new RefreshTokenInvalidError();

    await this.sessions.revoke(session.id, now);
    const refreshToken = this.random.next();
    await this.sessions.create({
      id: this.ids.next(),
      userId: user.id,
      orgId: user.orgId,
      tokenHash: sha256(refreshToken),
      expiresAt: new Date(now.getTime() + durationToMs(this.config.get('JWT_REFRESH_TTL', { infer: true }))),
    });

    return {
      accessToken: await this.tokens.issueAccess(user),
      refreshToken,
      expiresIn: Math.floor(durationToMs(this.config.get('JWT_ACCESS_TTL', { infer: true })) / 1000),
    };
  }
}
