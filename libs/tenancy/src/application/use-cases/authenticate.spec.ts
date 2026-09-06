import type { ConfigService } from '@nestjs/config';
import type { OrgId, UserId } from '@app/common';
import { Role } from '../../domain/role.js';
import { User } from '../../domain/user.js';
import { AmbiguousLoginError, InvalidCredentialsError } from '../../domain/errors.js';
import { Authenticate, sha256 } from './authenticate.js';
import { InMemoryOrganizationRepository } from '../../../test/doubles/in-memory-organization.repository.js';
import { InMemorySessionRepository } from '../../../test/doubles/in-memory-session.repository.js';
import { InMemoryUserRepository } from '../../../test/doubles/in-memory-user.repository.js';
import {
  FakePasswordHasher,
  FakeTokenIssuer,
  FixedClock,
  SequentialIdGenerator,
  SequentialRandomToken,
} from '../../../test/doubles/fakes.js';
import { anOrganization } from '../../../test/builders/an-organization.js';
import { unwrap } from '@app/common';

const NOW = new Date('2026-09-06T10:00:00Z');
const config = {
  get: (key: string) => ({ JWT_ACCESS_TTL: '15m', JWT_REFRESH_TTL: '30d' })[key],
} as unknown as ConfigService<never, true>;

function setup() {
  const users = new InMemoryUserRepository();
  const organizations = new InMemoryOrganizationRepository();
  const sessions = new InMemorySessionRepository();
  const uc = new Authenticate(
    users,
    organizations,
    sessions,
    new FakePasswordHasher(),
    new FakeTokenIssuer(),
    new SequentialRandomToken(),
    new FixedClock(NOW),
    new SequentialIdGenerator(),
    config,
  );
  const seed = async (orgSlug: string, email: string, password: string, active = true) => {
    const org = anOrganization({ slug: orgSlug as never });
    await organizations.save(org);
    let user = unwrap(
      User.create({
        id: `${org.id.slice(0, -2)}${users.rows.size + 10}` as UserId,
        orgId: org.id as OrgId,
        email,
        name: 'x',
        passwordHash: `hashed:${password}`,
        roles: [Role.OWNER],
      }),
    );
    if (!active) user = unwrap(user.deactivate(2));
    await users.save(user);
    return { org, user };
  };
  return { uc, users, sessions, seed };
}

describe('Authenticate', () => {
  it('returns tokens and stores a refresh session hashed and expiring in 30 days', async () => {
    const { uc, sessions, seed } = setup();
    const { user, org } = await seed('la-esquina', 'marta@esquina.co', 'pw');
    const out = await uc.execute({ email: 'Marta@Esquina.co', password: 'pw' });
    expect(out.accessToken).toBe(`access:${user.id}:${org.id}`);
    expect(out.refreshToken).toBe('refresh-1');
    expect(out.expiresIn).toBe(900);
    expect(out.user.id).toBe(user.id);
    const session = [...sessions.rows.values()][0]!;
    expect(session.tokenHash).toBe(sha256('refresh-1'));
    expect(session.userId).toBe(user.id);
    expect(session.expiresAt).toEqual(new Date('2026-10-06T10:00:00Z'));
  });

  it.each([
    ['wrong password', 'marta@esquina.co', 'nope'],
    ['unknown email', 'nobody@esquina.co', 'pw'],
    ['malformed email', 'not-an-email', 'pw'],
  ])('%s → invalid-credentials', async (_label, email, password) => {
    const { uc, seed } = setup();
    await seed('la-esquina', 'marta@esquina.co', 'pw');
    await expect(uc.execute({ email, password })).rejects.toBeInstanceOf(InvalidCredentialsError);
  });

  it('inactive user → invalid-credentials (T-6)', async () => {
    const { uc, seed } = setup();
    await seed('la-esquina', 'marta@esquina.co', 'pw', false);
    await expect(uc.execute({ email: 'marta@esquina.co', password: 'pw' })).rejects.toBeInstanceOf(
      InvalidCredentialsError,
    );
  });

  it('same email valid in two organizations → ambiguous-login, resolved by slug', async () => {
    const { uc, seed } = setup();
    const a = await seed('org-a', 'juan@x.co', 'pw');
    const b = await seed('org-b', 'juan@x.co', 'pw');
    await expect(uc.execute({ email: 'juan@x.co', password: 'pw' })).rejects.toBeInstanceOf(AmbiguousLoginError);
    expect((await uc.execute({ email: 'juan@x.co', password: 'pw', slug: 'org-b' })).user.orgId).toBe(b.org.id);
    expect((await uc.execute({ email: 'juan@x.co', password: 'pw', slug: 'org-a' })).user.orgId).toBe(a.org.id);
  });

  it('same email in two organizations but only one password matches → that one, no slug needed', async () => {
    const { uc, seed } = setup();
    await seed('org-a', 'juan@x.co', 'pw-a');
    const b = await seed('org-b', 'juan@x.co', 'pw-b');
    expect((await uc.execute({ email: 'juan@x.co', password: 'pw-b' })).user.orgId).toBe(b.org.id);
  });

  it('slug of an organization where the email does not exist → invalid-credentials', async () => {
    const { uc, seed } = setup();
    await seed('org-a', 'juan@x.co', 'pw');
    await seed('org-b', 'other@x.co', 'pw');
    await expect(uc.execute({ email: 'juan@x.co', password: 'pw', slug: 'org-b' })).rejects.toBeInstanceOf(
      InvalidCredentialsError,
    );
    await expect(uc.execute({ email: 'juan@x.co', password: 'pw', slug: 'nope!' })).rejects.toBeInstanceOf(
      InvalidCredentialsError,
    );
  });
});
