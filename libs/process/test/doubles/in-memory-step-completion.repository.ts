import type { OrgId, ProcessInstanceId } from '@app/common';
import { StepAlreadyCompletedError, type StepCompletion, type StepCompletionRepository } from '@app/process';

/**
 * Append-only de verdad, incluido el `UNIQUE (org_id, instance_id, step_id)`
 * que es P-3: sin esa comprobación, la prueba del paso repetido pasaría contra
 * un doble que acepta cualquier cosa.
 */
export class InMemoryStepCompletionRepository implements StepCompletionRepository {
  readonly rows: StepCompletion[] = [];

  listByInstance(orgId: OrgId, instanceId: ProcessInstanceId): Promise<StepCompletion[]> {
    return Promise.resolve(
      this.rows
        .filter((c) => c.orgId === orgId && c.instanceId === instanceId)
        .sort((a, b) => a.completedAt.getTime() - b.completedAt.getTime()),
    );
  }

  append(completion: StepCompletion): Promise<void> {
    const repetido = this.rows.some(
      (c) => c.orgId === completion.orgId && c.instanceId === completion.instanceId && c.stepId === completion.stepId,
    );
    if (repetido) return Promise.reject(new StepAlreadyCompletedError(completion.stepId));
    this.rows.push(completion);
    return Promise.resolve();
  }
}
