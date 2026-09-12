// The dispatcher of spec 05 §3, against the real table. What it must prove is
// not that it logs, but that FOR UPDATE SKIP LOCKED means two instances never
// publish the same event twice.
import { v7 } from 'uuid';
import type { OrgId, TraceId } from '@app/common';
import { KyselyUnitOfWork, OutboxEventDao } from '@app/persistence';
import { SchedulerRegistry } from '@nestjs/schedule';
import { OutboxDispatcherJob } from '../../src/jobs/outbox-dispatcher.job.js';
import { startTestApp, type TestApp } from '../../../../test/support/e2e/app.js';

describe('OutboxDispatcherJob', () => {
  let started: TestApp;
  let job: OutboxDispatcherJob;
  let events: OutboxEventDao;
  let uow: KyselyUnitOfWork;

  beforeAll(async () => {
    started = await startTestApp();
    job = started.app.get(OutboxDispatcherJob);
    events = started.app.get(OutboxEventDao);
    uow = started.app.get(KyselyUnitOfWork);
  });
  afterAll(() => started.stop());

  /** Events of a brand new organization, so other suites cannot interfere. */
  const seed = async (howMany: number): Promise<{ orgId: OrgId; ids: string[] }> => {
    const orgId = v7() as OrgId;
    const ids = Array.from({ length: howMany }, () => v7());
    await uow.runAs({ pool: 'system' }, () =>
      events.createMany(
        ids.map((id) => ({
          id,
          orgId,
          type: 'probe.event',
          payload: JSON.stringify({ id }),
          traceId: v7() as TraceId,
        })),
      ),
    );
    return { orgId, ids };
  };

  const readMine = (orgId: OrgId) => uow.runAs({ pool: 'system', orgId }, () => events.findMany(orgId));

  /**
   * Empties whatever the rest of the suite left behind. One tick claims at most
   * BATCH events, and the test database is never cleaned (the house rule), so
   * the ledger suites alone leave hundreds of published-pending rows: without
   * draining first, a tick would spend its whole batch on somebody else's
   * history and these assertions would be about events that never got claimed.
   */
  const drain = async (): Promise<void> => {
    for (let pass = 0; pass < 100; pass++) {
      if ((await job.tick()).length === 0) return;
    }
    throw new Error('el outbox no se vacía: algo lo está llenando más rápido de lo que se publica');
  };

  it('publishes what is pending and marks it, once', async () => {
    await drain();
    const { orgId, ids } = await seed(3);

    const published = await job.tick();
    expect(ids.every((id) => published.includes(id))).toBe(true);

    const rows = await readMine(orgId);
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.publishedAt !== null)).toBe(true);

    // A second pass does not re-read what is already marked.
    const again = await job.tick();
    expect(ids.some((id) => again.includes(id))).toBe(false);
    const after = await readMine(orgId);
    expect(after.map((r) => r.publishedAt?.getTime()).sort()).toEqual(
      rows.map((r) => r.publishedAt?.getTime()).sort(),
    );
  });

  it('two concurrent passes split the work and never overlap', async () => {
    await drain();
    const { orgId, ids } = await seed(10);

    const [a, b] = await Promise.all([job.tick(), job.tick()]);
    const mineA = a.filter((id) => ids.includes(id));
    const mineB = b.filter((id) => ids.includes(id));

    expect(mineA.filter((id) => mineB.includes(id))).toEqual([]); // nothing published twice
    expect(new Set([...mineA, ...mineB])).toEqual(new Set(ids)); // and nothing left behind
    expect((await readMine(orgId)).every((r) => r.publishedAt !== null)).toBe(true);
  });

  it('under NODE_ENV=test the interval never starts: tests drive it', () => {
    expect(process.env.NODE_ENV).toBe('test');
    expect(() => started.app.get(SchedulerRegistry).getInterval('outbox-dispatcher')).toThrow();
  });

  it('a real event of a real registration goes through the same path', async () => {
    await drain();
    const { http } = started;
    const slug = `la-esquina-${v7().slice(-8)}`;
    const res = await http.post(
      '/v1/organizations',
      { name: 'Distribuidora La Esquina', slug, owner: { email: `m-${slug}@x.co`, name: 'Marta', password: 'correcthorse1!' } },
      { idem: false },
    );
    expect(res.status).toBe(201);

    const published = await job.tick();
    const orgId = res.body.organization.id as OrgId;
    const rows = await readMine(orgId);
    expect(rows.map((r) => r.type)).toEqual(['organization.created']);
    expect(published).toContain(rows[0]!.id);
    expect(rows[0]!.publishedAt).not.toBeNull();
  });
});
