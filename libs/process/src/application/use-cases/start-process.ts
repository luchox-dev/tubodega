import { Inject, Injectable } from '@nestjs/common';
import {
  CLOCK, EVENT_PUBLISHER, ID_GENERATOR,
  type Clock, type EventPublisher, type IdGenerator, type ProcessInstanceId,
} from '@app/common';
import { Action, requireAction, type RequestContext } from '@app/tenancy';
import { TemplateNotFoundError } from '../../domain/errors.js';
import { TemplateCode } from '../../domain/ids.js';
import type { ProcessInstance } from '../../domain/instance.js';
import { PROCESS_RUNNER, type ProcessRunner } from '../../domain/runner.js';
import type { StepDefinition } from '../../domain/template.js';
import { processEvent } from '../events.js';
import { PROCESS_INSTANCE_REPOSITORY, type ProcessInstanceRepository } from '../ports/process-instance.repository.js';
import { PROCESS_TEMPLATE_REPOSITORY, type ProcessTemplateRepository } from '../ports/process-template.repository.js';

export interface StartProcessInput {
  readonly templateCode: string;
  /** The client's UUIDv7; minted here when absent, like `RecordMovement` (spec 13 §7). */
  readonly id?: ProcessInstanceId;
}

export interface StartedProcess {
  readonly instance: ProcessInstance;
  /** The definition, not the id: it is what lets a client be generic (spec 13 §10). */
  readonly nextStep: StepDefinition;
}

@Injectable()
export class StartProcess {
  constructor(
    @Inject(PROCESS_INSTANCE_REPOSITORY) private readonly instances: ProcessInstanceRepository,
    @Inject(PROCESS_TEMPLATE_REPOSITORY) private readonly templates: ProcessTemplateRepository,
    @Inject(PROCESS_RUNNER) private readonly runner: ProcessRunner,
    @Inject(EVENT_PUBLISHER) private readonly events: EventPublisher,
    @Inject(ID_GENERATOR) private readonly ids: IdGenerator,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(ctx: RequestContext, input: StartProcessInput): Promise<StartedProcess> {
    requireAction(ctx, Action.RECORD_MOVEMENT);

    const code = TemplateCode.of(input.templateCode);
    // A code that does not fit the column cannot exist, so it is the same 404
    // as one that simply is not there — never a 422 about a column width.
    if (!code.ok) throw new TemplateNotFoundError(input.templateCode);

    const template = await this.templates.findActive(ctx.orgId, code.value);
    if (!template) throw new TemplateNotFoundError(input.templateCode);

    // The instance records the **version**, not just the code: a receipt from
    // March is audited with March's rules (P-1).
    const instance = this.runner.start({
      id: input.id ?? (this.ids.next() as ProcessInstanceId),
      orgId: ctx.orgId,
      template,
      actorId: ctx.userId,
    });

    await this.instances.save(instance);
    await this.events.publish([
      processEvent(this.ids, 'process.started', ctx.orgId, ctx.traceId, this.clock.now(), {
        instanceId: instance.id,
        templateCode: template.code as string,
        templateVersion: template.version,
      }),
    ]);

    return { instance, nextStep: template.firstStep() };
  }
}
