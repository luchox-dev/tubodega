import { Inject, Injectable } from '@nestjs/common';
import type { ProcessInstanceId } from '@app/common';
import { Action, requireAction, type RequestContext } from '@app/tenancy';
import { ProcessInstanceNotFoundError } from '../../domain/errors.js';
import type { ProcessInstance } from '../../domain/instance.js';
import type { StepCompletion } from '../../domain/step-completion.js';
import type { StepDefinition } from '../../domain/template.js';
import { PROCESS_INSTANCE_REPOSITORY, type ProcessInstanceRepository } from '../ports/process-instance.repository.js';
import { PROCESS_TEMPLATE_REPOSITORY, type ProcessTemplateRepository } from '../ports/process-template.repository.js';
import { STEP_COMPLETION_REPOSITORY, type StepCompletionRepository } from '../ports/step-completion.repository.js';

export interface ProcessInstanceDetail {
  readonly instance: ProcessInstance;
  readonly completions: StepCompletion[];
  /**
   * The definition of the step the process is waiting on, while it is still
   * open (decision D-63). Whoever picks up an abandoned instance knows what to
   * send next without going to look for the template — which is the same
   * property that makes `complete` return the definition and not the id.
   */
  readonly currentStep?: StepDefinition;
}

@Injectable()
export class GetProcessInstance {
  constructor(
    @Inject(PROCESS_INSTANCE_REPOSITORY) private readonly instances: ProcessInstanceRepository,
    @Inject(PROCESS_TEMPLATE_REPOSITORY) private readonly templates: ProcessTemplateRepository,
    @Inject(STEP_COMPLETION_REPOSITORY) private readonly completions: StepCompletionRepository,
  ) {}

  async execute(ctx: RequestContext, id: ProcessInstanceId): Promise<ProcessInstanceDetail> {
    requireAction(ctx, Action.READ);

    const instance = await this.instances.findById(ctx.orgId, id);
    if (!instance) throw new ProcessInstanceNotFoundError();

    const completions = await this.completions.listByInstance(ctx.orgId, id);
    if (instance.currentStepId === undefined) return { instance, completions };

    // **The version the instance recorded** (P-1), never the active one: an
    // instance opened on v1 keeps being read with v1's steps however many
    // times the template has been versioned since.
    const template = await this.templates.findVersion(
      ctx.orgId, instance.templateCode, instance.templateVersion,
    );
    const currentStep = template?.step(instance.currentStepId) ?? null;

    return { instance, completions, ...(currentStep ? { currentStep } : {}) };
  }
}
