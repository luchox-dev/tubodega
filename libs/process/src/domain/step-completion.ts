import type { OrgId, ProcessInstanceId, UserId } from '@app/common';
import type { StepCompletionId, StepId } from './ids.js';
import type { StepPayload } from './step-types.js';

/**
 * Append-only, like a movement. `payload` is `null` for a step that was
 * omitted, and that is the literal JSON `null` and not a SQL NULL: the column
 * is `jsonb NOT NULL`, and the difference between "this step was skipped" and
 * "this step does not exist" is precisely the row (spec 13 §9).
 */
export interface StepCompletion {
  readonly id: StepCompletionId;
  readonly orgId: OrgId;
  readonly instanceId: ProcessInstanceId;
  readonly stepId: StepId;
  readonly actorId: UserId;
  readonly payload: StepPayload | null;
  readonly completedAt: Date;
}
