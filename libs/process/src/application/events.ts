import type { DomainEvent, IdGenerator, OrgId, TraceId } from '@app/common';

/**
 * The four of spec 13 §11. A literal union rather than a string, so adding one
 * is a deliberate edit here and not a typo that silently ships a new type.
 */
export type ProcessEventType =
  | 'process.started' | 'process.step_completed' | 'process.completed' | 'process.cancelled';

/** Builds the envelope of spec 05 §5 for process events (spec 13 §11). */
export function processEvent(
  ids: IdGenerator,
  type: ProcessEventType,
  orgId: OrgId,
  traceId: TraceId,
  occurredAt: Date,
  data: Readonly<Record<string, unknown>>,
): DomainEvent {
  return { id: ids.next(), type, orgId, traceId, occurredAt, data };
}
