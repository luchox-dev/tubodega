import type { ConfigService } from '@nestjs/config';
import { SignJWT } from 'jose';
import { aUser } from '../../test/builders/a-user.js';
import { FixedClock } from '../../test/doubles/fakes.js';
import { Role } from '../domain/role.js';
import { JoseTokenIssuer } from './jose-token-issuer.js';

const SECRET = 's'.repeat(40);
const config = (secret = SECRET) =>
  ({ get: (k: string) => ({ JWT_SECRET: secret, JWT_ACCESS_TTL: '15m' })[k] }) as unknown as ConfigService<never, true>;
const T0 = new Date('2026-09-06T10:00:00Z');

describe('JoseTokenIssuer', () => {
  it('issues a token that verifies with sub, org, roles and exp = now + 15m', async () => {
    const clock = new FixedClock(T0);
    const issuer = new JoseTokenIssuer(config(), clock);
    const user = aUser({ roles: [Role.ADMIN, Role.OPERATOR] });
    const token = await issuer.issueAccess(user);
    const v = await issuer.verify(token);
    expect(v.ok && v.claims).toMatchObject({ sub: user.id, org: user.orgId, roles: [Role.ADMIN, Role.OPERATOR] });
    expect(v.ok && v.claims.exp).toBe(Math.floor(T0.getTime() / 1000) + 900);
  });

  it('reports expired once the clock passes exp', async () => {
    const clock = new FixedClock(T0);
    const issuer = new JoseTokenIssuer(config(), clock);
    const token = await issuer.issueAccess(aUser());
    clock.advance(16 * 60_000);
    expect(await issuer.verify(token)).toEqual({ ok: false, reason: 'expired' });
  });

  it('reports invalid for a foreign signature, garbage, or claims of the wrong shape', async () => {
    const issuer = new JoseTokenIssuer(config(), new FixedClock(T0));
    const foreign = await new JoseTokenIssuer(config('x'.repeat(40)), new FixedClock(T0)).issueAccess(aUser());
    expect(await issuer.verify(foreign)).toEqual({ ok: false, reason: 'invalid' });
    expect(await issuer.verify('not.a.jwt')).toEqual({ ok: false, reason: 'invalid' });
    const badShape = await new SignJWT({ org: 'nope', roles: ['KING'] })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('u')
      .setExpirationTime(Math.floor(T0.getTime() / 1000) + 60)
      .sign(new TextEncoder().encode(SECRET));
    expect(await issuer.verify(badShape)).toEqual({ ok: false, reason: 'invalid' });
  });
});
