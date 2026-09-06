import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SignJWT, errors, jwtVerify } from 'jose';
import { CLOCK, durationToMs, isUuid, type Clock, type EnvironmentVariables } from '@app/common';
import type { TokenIssuer, TokenVerification } from '../application/ports/token-issuer.js';
import { Role } from '../domain/role.js';
import type { User } from '../domain/user.js';

/** HS256 access tokens carrying sub, org and roles (spec 03 §2, 10 §2). */
@Injectable()
export class JoseTokenIssuer implements TokenIssuer {
  private readonly key: Uint8Array;
  private readonly ttlSeconds: number;

  constructor(
    config: ConfigService<EnvironmentVariables, true>,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {
    this.key = new TextEncoder().encode(config.get('JWT_SECRET', { infer: true }));
    this.ttlSeconds = Math.floor(durationToMs(config.get('JWT_ACCESS_TTL', { infer: true })) / 1000);
  }

  issueAccess(user: User): Promise<string> {
    const iat = Math.floor(this.clock.now().getTime() / 1000);
    return new SignJWT({ org: user.orgId, roles: [...user.roles] })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(user.id)
      .setIssuedAt(iat)
      .setExpirationTime(iat + this.ttlSeconds)
      .sign(this.key);
  }

  async verify(token: string): Promise<TokenVerification> {
    try {
      const { payload } = await jwtVerify(token, this.key, {
        algorithms: ['HS256'],
        currentDate: this.clock.now(),
      });
      const roles = Array.isArray(payload.roles) ? payload.roles : [];
      const validRoles = roles.every((r) => Object.values(Role).includes(r as Role));
      if (!isUuid(payload.sub) || !isUuid(payload.org) || !validRoles || typeof payload.exp !== 'number') {
        return { ok: false, reason: 'invalid' };
      }
      return {
        ok: true,
        claims: { sub: payload.sub as never, org: payload.org as never, roles: roles as Role[], exp: payload.exp },
      };
    } catch (e) {
      return { ok: false, reason: e instanceof errors.JWTExpired ? 'expired' : 'invalid' };
    }
  }
}
