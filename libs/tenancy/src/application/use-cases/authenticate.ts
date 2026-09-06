import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CLOCK, ID_GENERATOR, durationToMs, type Clock, type EnvironmentVariables, type IdGenerator } from '@app/common';
import { AmbiguousLoginError, InvalidCredentialsError } from '../../domain/errors.js';
import { Email, Slug } from '../../domain/ids.js';
import type { User } from '../../domain/user.js';
import { ORGANIZATION_REPOSITORY, type OrganizationRepository } from '../ports/organization.repository.js';
import { PASSWORD_HASHER, type PasswordHasher } from '../ports/password-hasher.js';
import { SESSION_REPOSITORY, type SessionRepository } from '../ports/session.repository.js';
import { RANDOM_TOKEN, TOKEN_ISSUER, type RandomToken, type TokenIssuer } from '../ports/token-issuer.js';
import { USER_REPOSITORY, type UserRepository } from '../ports/user.repository.js';

export interface AuthenticateInput {
  readonly email: string;
  readonly password: string;
  /** Disambiguates when the same email exists in several organizations. */
  readonly slug?: string;
}

export interface AuthenticateOutput {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresIn: number;
  readonly user: User;
}

export const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

/**
 * Login. Runs in system context: it looks the email up across organizations
 * and lets the password disambiguate (spec 10 §4-§5, 07 §2). Unknown email,
 * wrong password and inactive user all answer `invalid-credentials`.
 */
@Injectable()
export class Authenticate {
  constructor(
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(ORGANIZATION_REPOSITORY) private readonly organizations: OrganizationRepository,
    @Inject(SESSION_REPOSITORY) private readonly sessions: SessionRepository,
    @Inject(PASSWORD_HASHER) private readonly hasher: PasswordHasher,
    @Inject(TOKEN_ISSUER) private readonly tokens: TokenIssuer,
    @Inject(RANDOM_TOKEN) private readonly random: RandomToken,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(ID_GENERATOR) private readonly ids: IdGenerator,
    private readonly config: ConfigService<EnvironmentVariables, true>,
  ) {}

  async execute(input: AuthenticateInput): Promise<AuthenticateOutput> {
    const email = Email.of(input.email);
    if (!email.ok) throw new InvalidCredentialsError();

    let candidates = (await this.users.findByEmailGlobal(email.value)).filter((u) => u.active);
    if (input.slug !== undefined) {
      const slug = Slug.of(input.slug);
      const org = slug.ok ? await this.organizations.findBySlug(slug.value) : null;
      candidates = org ? candidates.filter((u) => u.orgId === org.id) : [];
    }

    // Verify every candidate: response time does not reveal which emails exist.
    const verified = await Promise.all(
      candidates.map(async (u) => ((await this.hasher.verify(input.password, u.passwordHash)) ? u : null)),
    );
    const matches = verified.filter((u): u is User => u !== null);
    if (matches.length === 0) throw new InvalidCredentialsError();
    if (matches.length > 1) throw new AmbiguousLoginError();
    const user = matches[0]!;

    const refreshToken = this.random.next();
    const now = this.clock.now();
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
      user,
    };
  }
}
