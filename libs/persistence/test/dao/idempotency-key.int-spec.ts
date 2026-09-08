// The A/B/C sequence of spec 07 §5, at the row level. The interceptor that
// drives it is proved separately, against the real application.
import { v7 } from 'uuid';
import type { OrgId } from '@app/common';
import { IdempotencyKeyDao, KyselyUnitOfWork, OrganizationDao } from '@app/persistence';
import { createPersistenceHarness, withRollback } from '../../../../test/support/db.js';

const MINUTE = 60_000;
const DAY = 86_400_000;

describe('IdempotencyKeyDao', () => {
  let h: Awaited<ReturnType<typeof createPersistenceHarness>>;
  let keys: IdempotencyKeyDao;
  let orgs: OrganizationDao;
  let uow: KyselyUnitOfWork;

  beforeAll(async () => {
    h = await createPersistenceHarness();
    keys = h.get(IdempotencyKeyDao);
    orgs = h.get(OrganizationDao);
    uow = h.uow;
  });
  afterAll(() => h.close());

  const now = new Date('2026-09-07T10:00:00.000Z');
  const newOrg = async (): Promise<OrgId> => {
    const id = v7() as OrgId;
    await orgs.create({ id, name: 'Acme', slug: `acme-${id.slice(-12)}` });
    return id;
  };
  const reserve = (orgId: OrgId, key: string, hash: string, at = now) =>
    keys.reserve(orgId, key, hash, at, new Date(at.getTime() + 7 * DAY));

  it('A: a free key is reserved; a second attempt sees it in flight', () =>
    withRollback(uow, { pool: 'system' }, async () => {
      const orgId = await newOrg();
      expect(await reserve(orgId, 'k1', 'hash-a')).toEqual({ outcome: 'reserved' });
      expect(await reserve(orgId, 'k1', 'hash-a')).toEqual({ outcome: 'in-flight', since: now });
    }));

  it('B: after complete, the reservation replays code and body', () =>
    withRollback(uow, { pool: 'system' }, async () => {
      const orgId = await newOrg();
      await reserve(orgId, 'k1', 'hash-a');
      await keys.complete(orgId, 'k1', 201, { id: 'u-1', name: 'Juan' });
      expect(await reserve(orgId, 'k1', 'hash-a')).toEqual({
        outcome: 'completed',
        requestHash: 'hash-a',
        responseCode: 201,
        responseBody: { id: 'u-1', name: 'Juan' },
      });
    }));

  it('the stored hash is what tells a replay from a reuse', () =>
    withRollback(uow, { pool: 'system' }, async () => {
      const orgId = await newOrg();
      await reserve(orgId, 'k1', 'hash-a');
      await keys.complete(orgId, 'k1', 201, { ok: true });
      const seen = await reserve(orgId, 'k1', 'hash-b');
      expect(seen).toMatchObject({ outcome: 'completed', requestHash: 'hash-a' });
    }));

  it('C: release frees the key for a retry', () =>
    withRollback(uow, { pool: 'system' }, async () => {
      const orgId = await newOrg();
      await reserve(orgId, 'k1', 'hash-a');
      await keys.release(orgId, 'k1');
      expect(await reserve(orgId, 'k1', 'hash-a')).toEqual({ outcome: 'reserved' });
    }));

  it('only a key idle for over five minutes is taken over', () =>
    withRollback(uow, { pool: 'system' }, async () => {
      const orgId = await newOrg();
      const before = new Date(now.getTime() - 5 * MINUTE);
      await reserve(orgId, 'fresh', 'hash-a');
      expect(await keys.takeOverAbandoned(orgId, 'fresh', 'hash-b', now, before)).toBe(false);

      const stale = new Date(now.getTime() - 6 * MINUTE);
      await reserve(orgId, 'stale', 'hash-a', stale);
      expect(await keys.takeOverAbandoned(orgId, 'stale', 'hash-b', now, before)).toBe(true);
      expect(await keys.findUnique(orgId, { key: 'stale' })).toMatchObject({
        requestHash: 'hash-b',
        createdAt: now,
      });
    }));

  it('a completed key is never taken over, however old', () =>
    withRollback(uow, { pool: 'system' }, async () => {
      const orgId = await newOrg();
      const old = new Date(now.getTime() - 60 * MINUTE);
      await reserve(orgId, 'k1', 'hash-a', old);
      await keys.complete(orgId, 'k1', 201, { ok: true });
      expect(
        await keys.takeOverAbandoned(orgId, 'k1', 'hash-b', now, new Date(now.getTime() - 5 * MINUTE)),
      ).toBe(false);
    }));

  it('keys are per organization: the same value in two of them does not collide', () =>
    withRollback(uow, { pool: 'system' }, async () => {
      const a = await newOrg();
      const b = await newOrg();
      expect(await reserve(a, 'same', 'hash-a')).toEqual({ outcome: 'reserved' });
      expect(await reserve(b, 'same', 'hash-a')).toEqual({ outcome: 'reserved' });
    }));
});
