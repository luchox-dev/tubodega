import type { DomainEvent, IdGenerator, OrgId, TraceId } from '@app/common';

/**
 * The events of spec 12 §8. A literal union rather than a string, so adding one
 * is a deliberate edit here and not a typo that silently ships a new type.
 */
export type InventoryEventType =
  | 'node.created' | 'node.updated' | 'node.moved' | 'node.deactivated'
  | 'stock.moved' | 'stock.reversed' | 'stock.balance_changed'
  | 'custody.checked_out' | 'custody.checked_in';

/** Builds the envelope of spec 05 §5 for inventory events (spec 12 §8). */
export function inventoryEvent(
  ids: IdGenerator,
  type: InventoryEventType,
  orgId: OrgId,
  traceId: TraceId,
  occurredAt: Date,
  data: Readonly<Record<string, unknown>>,
): DomainEvent {
  return { id: ids.next(), type, orgId, traceId, occurredAt, data };
}
