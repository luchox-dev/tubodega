import { createHash } from 'node:crypto';
import type { OrgId, TraceId, UserId } from '@app/common';
import { Role } from '../../domain/role.js';
import type { RequestContext } from '../../domain/request-context.js';
import { InMemorySessionRepository } from '../../../test/doubles/in-memory-session.repository.js';
import { FixedClock } from '../../../test/doubles/fakes.js';
import { Logout } from './logout.js';

const NOW = new Date('2026-09-07T10:00:00.000Z');
const ORG = '00000000-0000-7000-8000-0000000000aa' as OrgId;
const OTHER_ORG = '00000000-0000-7000-8000-0000000000ab' as OrgId;
const JUAN = '00000000-0000-7000-8000-0000000000b1' as UserId;
const SOFIA = '00000000-0000-7000-8000-0000000000b2' as UserId;
const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');

const ctx = (userId: UserId, orgId: OrgId): RequestContext => ({
  orgId,
  userId,
  roles: new Set([Role.OPERATOR]),
  traceId: 'trace' as TraceId,
});

describe('Logout', () => {
  let sessions: InMemorySessionRepository;
  let logout: Logout;

  beforeEach(async () => {
    sessions = new InMemorySessionRepository();
    logout = new Logout(sessions, new FixedClock(NOW));
    await sessions.create({
      id: 's-juan',
      userId: JUAN,
      orgId: ORG,
      tokenHash: sha256('juan-token'),
      expiresAt: new Date(NOW.getTime() + 86_400_000),
    });
    await sessions.create({
      id: 's-sofia',
      userId: SOFIA,
      orgId: ORG,
      tokenHash: sha256('sofia-token'),
      expiresAt: new Date(NOW.getTime() + 86_400_000),
    });
  });

  it('revokes the session of the caller', async () => {
    await logout.execute(ctx(JUAN, ORG), { refreshToken: 'juan-token' });
    expect(sessions.rows.get('s-juan')?.revokedAt).toEqual(NOW);
  });

  it('does not revoke someone else’s session, and says nothing about it', async () => {
    await expect(logout.execute(ctx(JUAN, ORG), { refreshToken: 'sofia-token' })).resolves.toBeUndefined();
    expect(sessions.rows.get('s-sofia')?.revokedAt).toBeUndefined();
  });

  it('does not revoke a session of another organization', async () => {
    await logout.execute(ctx(JUAN, OTHER_ORG), { refreshToken: 'juan-token' });
    expect(sessions.rows.get('s-juan')?.revokedAt).toBeUndefined();
  });

  it('an unknown token is not an error: logout is idempotent', async () => {
    await expect(logout.execute(ctx(JUAN, ORG), { refreshToken: 'nope' })).resolves.toBeUndefined();
  });
});
