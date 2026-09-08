import { Inject, Injectable } from '@nestjs/common';
import { CLOCK, type Clock, type OrgId } from '@app/common';
import { IdempotencyKeyDao, KyselyUnitOfWork, type Reservation } from '@app/persistence';

/** Retention of spec 04 §3.8 and the abandonment rule of spec 07 §5. */
const RETENTION_MS = 7 * 86_400_000;
const ABANDONED_AFTER_MS = 5 * 60_000;

/**
 * Where each step of the sequence runs, which is the whole point of this class
 * (spec 07 §5, decision D-9):
 *
 * - **A (reserve)** and **C (release)** open their own short transaction on a
 *   dedicated pool. Their own transaction, so two concurrent requests with the
 *   same key see each other instead of blocking on the index. A *dedicated*
 *   pool, because sharing the request pool would deadlock: ten simultaneous
 *   POSTs with a pool of ten would all be waiting for an eleventh connection.
 * - **B (complete)** goes in the request's ambient transaction, so the stored
 *   response exists if and only if the effect did.
 */
@Injectable()
export class IdempotencyStore {
  constructor(
    private readonly uow: KyselyUnitOfWork,
    private readonly keys: IdempotencyKeyDao,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async reserve(orgId: OrgId, key: string, requestHash: string): Promise<Reservation> {
    const now = this.clock.now();
    return this.uow.runDetached({ orgId }, async () => {
      const first = await this.keys.reserve(orgId, key, requestHash, now, new Date(now.getTime() + RETENTION_MS));
      if (first.outcome !== 'in-flight') return first;

      const abandonedBefore = new Date(now.getTime() - ABANDONED_AFTER_MS);
      if (first.since.getTime() > abandonedBefore.getTime()) return first;
      const taken = await this.keys.takeOverAbandoned(orgId, key, requestHash, now, abandonedBefore);
      return taken ? { outcome: 'reserved' } : first;
    });
  }

  /** In the ambient transaction: it commits with the effect or not at all. */
  complete(orgId: OrgId, key: string, responseCode: number, responseBody: unknown): Promise<void> {
    return this.keys.complete(orgId, key, responseCode, responseBody);
  }

  release(orgId: OrgId, key: string): Promise<void> {
    return this.uow.runDetached({ orgId }, () => this.keys.release(orgId, key));
  }
}
