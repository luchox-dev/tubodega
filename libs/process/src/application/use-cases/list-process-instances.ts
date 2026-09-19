import { Inject, Injectable } from '@nestjs/common';
import type { Page } from '@app/common';
import { Action, requireAction, type RequestContext } from '@app/tenancy';
import type { ProcessInstance } from '../../domain/instance.js';
import {
  PROCESS_INSTANCE_REPOSITORY,
  type ProcessInstanceFilter, type ProcessInstancePage, type ProcessInstanceRepository,
} from '../ports/process-instance.repository.js';

/**
 * What is still open, and what already ran. Filter and page travel apart, the
 * same shape as `GetMovementHistory`: the three filters of spec 13 §10 are the
 * declared ones and the edge refuses anything else (spec 03 §8).
 */
@Injectable()
export class ListProcessInstances {
  constructor(
    @Inject(PROCESS_INSTANCE_REPOSITORY) private readonly instances: ProcessInstanceRepository,
  ) {}

  async execute(
    ctx: RequestContext, filter: ProcessInstanceFilter, page: ProcessInstancePage,
  ): Promise<Page<ProcessInstance>> {
    requireAction(ctx, Action.READ);
    return this.instances.list(ctx.orgId, filter, page);
  }
}
