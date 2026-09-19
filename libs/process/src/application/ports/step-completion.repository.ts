import type { OrgId, ProcessInstanceId } from '@app/common';
import type { StepCompletion } from '../../domain/step-completion.js';

/**
 * Append-only, and it shows in the type: no `update`, no `delete`. It is the
 * first of the two layers spec 04 §3.4 asks of a table like this; the second is
 * the `REVOKE UPDATE, DELETE ON step_completion` this plan migrates (D-49).
 */
export interface StepCompletionRepository {
  /** In the order they were completed, which is the order they happened. */
  listByInstance(orgId: OrgId, instanceId: ProcessInstanceId): Promise<StepCompletion[]>;
  /** Raises `StepAlreadyCompletedError` on the `UNIQUE (org_id, instance_id, step_id)` — P-3. */
  append(completion: StepCompletion): Promise<void>;
}

export const STEP_COMPLETION_REPOSITORY = Symbol('StepCompletionRepository');
