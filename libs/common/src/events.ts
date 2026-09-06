import type { OrgId, TraceId } from './ids.js';

/** The envelope of spec 05 §5. Written to the outbox in the same transaction as the fact. */
export interface DomainEvent {
  readonly id: string;
  readonly type: string;
  readonly orgId: OrgId;
  readonly traceId: TraceId;
  readonly occurredAt: Date;
  readonly data: Readonly<Record<string, unknown>>;
}
