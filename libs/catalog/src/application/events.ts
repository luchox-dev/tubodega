import type { DomainEvent, IdGenerator, OrgId, TraceId } from '@app/common';

/** Builds the envelope of spec 05 §5 for catalogue events (spec 11 §8). */
export function catalogEvent(
  ids: IdGenerator,
  type:
    | 'product.created'
    | 'product.updated'
    | 'product.deactivated'
    | 'batch.created'
    | 'custom_field.defined',
  orgId: OrgId,
  traceId: TraceId,
  occurredAt: Date,
  data: Readonly<Record<string, unknown>>,
): DomainEvent {
  return { id: ids.next(), type, orgId, traceId, occurredAt, data };
}
