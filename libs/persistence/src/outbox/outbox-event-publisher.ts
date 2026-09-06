import { Injectable } from '@nestjs/common';
import type { DomainEvent, EventPublisher } from '@app/common';
import { OutboxEventDao } from '../dao/outbox-event.dao.js';

/**
 * The producer side of the outbox (spec 05 §2): one row per event, in the
 * same transaction as the fact it describes. The dispatcher (plan 2) reads
 * them back with FOR UPDATE SKIP LOCKED.
 */
@Injectable()
export class KyselyOutboxEventPublisher implements EventPublisher {
  constructor(private readonly dao: OutboxEventDao) {}

  async publish(events: readonly DomainEvent[]): Promise<void> {
    for (const event of events) {
      await this.dao.create({
        id: event.id,
        orgId: event.orgId,
        type: event.type,
        payload: JSON.stringify(event.data),
        traceId: event.traceId,
        occurredAt: event.occurredAt,
      });
    }
  }
}
