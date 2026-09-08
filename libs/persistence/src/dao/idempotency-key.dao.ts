import { Injectable } from '@nestjs/common';
import type { OrgId } from '@app/common';
import { TransactionContext } from '../kysely/transaction.context.js';
import { AbstractOrgDao } from './base/org/abstract-org.dao.js';

/** What the reservation of spec 07 §5 step A found. */
export type Reservation =
  | { readonly outcome: 'reserved' }
  | { readonly outcome: 'in-flight'; readonly since: Date }
  | {
      readonly outcome: 'completed';
      readonly requestHash: string;
      readonly responseCode: number;
      readonly responseBody: unknown;
    };

/** Composite key without `org_id`, which always arrives as a parameter. */
export type IdempotencyKeyId = { readonly key: string };

@Injectable()
export class IdempotencyKeyDao extends AbstractOrgDao<'idempotencyKey', IdempotencyKeyId> {
  protected readonly table = 'idempotencyKey' as const;
  protected override readonly idColumns = ['key'] as const;

  constructor(ctx: TransactionContext) {
    super(ctx);
  }

  /**
   * `INSERT … ON CONFLICT DO NOTHING RETURNING *`, then a read when nothing
   * came back. Two concurrent requests with the same key must *see* each
   * other, which is why the caller runs this in its own transaction (D-9):
   * the second one gets an answer instead of blocking on the index until the
   * first commits.
   */
  async reserve(
    orgId: OrgId,
    key: string,
    requestHash: string,
    now: Date,
    expiresAt: Date,
  ): Promise<Reservation> {
    // Two attempts: between the conflict and the read, the other request may
    // have released its key (step C), leaving the slot free again.
    for (let attempt = 0; attempt < 2; attempt++) {
      const inserted = await this.db
        .insertInto('idempotencyKey')
        .values({ orgId, key, requestHash, status: 'IN_FLIGHT', createdAt: now, expiresAt })
        .onConflict((oc) => oc.doNothing())
        .returningAll()
        .executeTakeFirst();
      if (inserted) return { outcome: 'reserved' };

      const existing = await this.findUnique(orgId, { key });
      if (!existing) continue;
      if (existing.status === 'IN_FLIGHT') return { outcome: 'in-flight', since: existing.createdAt };
      return {
        outcome: 'completed',
        requestHash: existing.requestHash,
        responseCode: existing.responseCode ?? 200,
        responseBody: existing.responseBody,
      };
    }
    return { outcome: 'reserved' };
  }

  /**
   * A process that died between A and C would leave a key IN_FLIGHT for the
   * whole 7-day retention, and the client would get 409 forever for an
   * operation that never happened. After 5 minutes the key is up for grabs.
   */
  async takeOverAbandoned(
    orgId: OrgId,
    key: string,
    requestHash: string,
    now: Date,
    before: Date,
  ): Promise<boolean> {
    const updated = await this.updateMany(
      orgId,
      { key, status: 'IN_FLIGHT', createdAt: { lt: before } },
      { requestHash, createdAt: now },
    );
    return updated > 0;
  }

  /** Step B: goes in the request's own transaction, so response and effect commit together. */
  async complete(orgId: OrgId, key: string, responseCode: number, responseBody: unknown): Promise<void> {
    await this.update(orgId, { key }, {
      status: 'COMPLETED',
      responseCode,
      responseBody: JSON.stringify(responseBody ?? null),
    });
  }

  /** Step C: the handler failed, so the client may retry. */
  async release(orgId: OrgId, key: string): Promise<void> {
    await this.deleteMany(orgId, { key });
  }
}
