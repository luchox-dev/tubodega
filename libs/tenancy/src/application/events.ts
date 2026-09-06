import type { DomainEvent, IdGenerator, OrgId, TraceId } from '@app/common';

/** Builds the envelope of spec 05 §5 for tenancy events (spec 10 §8). */
export function tenancyEvent(
  ids: IdGenerator,
  type: 'organization.created' | 'user.created' | 'user.roles_changed' | 'user.deactivated',
  orgId: OrgId,
  traceId: TraceId,
  occurredAt: Date,
  data: Readonly<Record<string, unknown>>,
): DomainEvent {
  return { id: ids.next(), type, orgId, traceId, occurredAt, data };
}
