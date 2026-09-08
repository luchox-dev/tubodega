import { createHash } from 'node:crypto';
import { unwrap, type OrgId, type UserId } from '@app/common';
import { RefreshTokenInvalidError } from '../../domain/errors.js';
import { Role } from '../../domain/role.js';
import { User } from '../../domain/user.js';
import { InMemorySessionRepository } from '../../../test/doubles/in-memory-session.repository.js';
import { InMemoryUserRepository } from '../../../test/doubles/in-memory-user.repository.js';
import { FakeTokenIssuer, FixedClock, SequentialIdGenerator, SequentialRandomToken } from '../../../test/doubles/fakes.js';
import { RefreshSession } from './refresh-session.js';

const NOW = new Date('2026-09-07T10:00:00.000Z');
const DAY = 86_400_000;
const ORG = '00000000-0000-7000-8000-0000000000aa' as OrgId;
const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');

describe('RefreshSession', () => {
  let users: InMemoryUserRepository;
  let sessions: InMemorySessionRepository;
  let clock: FixedClock;
  let refresh: RefreshSession;
  let user: User;

  beforeEach(async () => {
    users = new InMemoryUserRepository();
    sessions = new InMemorySessionRepository();
    clock = new FixedClock(NOW);
    refresh = new RefreshSession(
      sessions,
      users,
      new FakeTokenIssuer(),
      new SequentialRandomToken(),
      clock,
      new SequentialIdGenerator(),
      { get: (k: string) => (k === 'JWT_REFRESH_TTL' ? '30d' : '15m') } as never,
    );
    user = unwrap(
      User.create({
        id: '00000000-0000-7000-8000-0000000000b1' as UserId,
        orgId: ORG,
        email: 'juan@x.co',
        name: 'Juan',
        passwordHash: 'h',
        roles: [Role.OPERATOR],
      }),
    );
    await users.save(user);
    await sessions.create({
      id: 's1',
      userId: user.id,
      orgId: ORG,
      tokenHash: sha256('token-a'),
      expiresAt: new Date(NOW.getTime() + 30 * DAY),
    });
  });

  it('rotates: the used token is revoked and a different one comes back', async () => {
    const out = await refresh.execute({ refreshToken: 'token-a' });
    expect(out.refreshToken).not.toBe('token-a');
    expect(out.accessToken).toBe(`access:${user.id}:${ORG}`);
    expect(out.expiresIn).toBe(900);
    expect(sessions.rows.get('s1')?.revokedAt).toEqual(NOW);
    expect([...sessions.rows.values()].filter((s) => !s.revokedAt)).toHaveLength(1);
  });

  it('the previous token stops working the moment it is used', async () => {
    await refresh.execute({ refreshToken: 'token-a' });
    await expect(refresh.execute({ refreshToken: 'token-a' })).rejects.toBeInstanceOf(RefreshTokenInvalidError);
  });

  it('the new token expires 30 days from now, not from the old session', async () => {
    clock.advance(10 * DAY);
    await refresh.execute({ refreshToken: 'token-a' });
    const fresh = [...sessions.rows.values()].find((s) => !s.revokedAt)!;
    expect(fresh.expiresAt).toEqual(new Date(NOW.getTime() + 40 * DAY));
  });

  it.each([
    ['unknown', async () => undefined],
    ['already revoked', async () => sessions.revoke('s1', NOW)],
    ['expired', async () => clock.advance(31 * DAY)],
    ['user deactivated', async () => users.save(unwrap(user.deactivate(0)))],
  ])('rejects a %s token with the one same type', async (_case, arrange) => {
    await arrange();
    const token = _case === 'unknown' ? 'nope' : 'token-a';
    await expect(refresh.execute({ refreshToken: token })).rejects.toBeInstanceOf(RefreshTokenInvalidError);
  });
});
