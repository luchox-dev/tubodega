import type { DomainEvent, IdGenerator, OrgId, TraceId } from '@app/common';

/** Builds the envelope of spec 05 §5 for inventory events (spec 12 §8). The
 *  ledger types (`stock.*`, `custody.*`) join the union with wave 3. */
export function inventoryEvent(
  ids: IdGenerator,
  type: 'node.created' | 'node.updated' | 'node.moved' | 'node.deactivated',
  orgId: OrgId,
  traceId: TraceId,
  occurredAt: Date,
  data: Readonly<Record<string, unknown>>,
): DomainEvent {
  return { id: ids.next(), type, orgId, traceId, occurredAt, data };
}
