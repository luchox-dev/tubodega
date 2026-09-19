import { Injectable } from '@nestjs/common';
import type { OrgId, ProcessInstanceId } from '@app/common';
import { StepAlreadyCompletedError, type StepCompletion, type StepCompletionRepository } from '@app/process';
import { StepCompletionDao } from '../../dao/step-completion.dao.js';
import { UniqueViolationError } from '../../dao/base/errors.js';
import { stepCompletionValues, toStepCompletion } from './mapping.js';

/**
 * Append-only, with **no update and no delete** — not in the port, not here,
 * and revoked in the database role by this plan's migration (D-49). The same
 * three layers `movement` has had since `full_schema`.
 */
@Injectable()
export class KyselyStepCompletionRepository implements StepCompletionRepository {
  constructor(private readonly dao: StepCompletionDao) {}

  async listByInstance(orgId: OrgId, instanceId: ProcessInstanceId): Promise<StepCompletion[]> {
    const rows = await this.dao.findMany(orgId, {
      where: { instanceId: instanceId as string },
      orderBy: { completedAt: 'asc' },
    });
    return rows.map(toStepCompletion);
  }

  async append(completion: StepCompletion): Promise<void> {
    await this.dao.create(stepCompletionValues(completion)).catch((e: unknown) => {
      // P-3 under concurrency: two simultaneous requests for the same step,
      // one wins. The loser gets the answer it can read, not a 500.
      if (e instanceof UniqueViolationError && e.constraint === 'step_completion_org_id_instance_id_step_id_key') {
        throw new StepAlreadyCompletedError(completion.stepId);
      }
      throw e;
    });
  }
}
