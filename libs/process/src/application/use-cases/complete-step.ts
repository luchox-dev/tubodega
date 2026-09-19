import { Inject, Injectable } from '@nestjs/common';
import {
  CLOCK, EVENT_PUBLISHER, ID_GENERATOR,
  type Clock, type DomainEvent, type EventPublisher, type IdGenerator, type ProcessInstanceId,
} from '@app/common';
import type { Movement } from '@app/inventory';
import { Action, requireAction, type RequestContext } from '@app/tenancy';
import {
  ProcessInstanceNotFoundError, StepAlreadyCompletedError, TemplateNotFoundError,
} from '../../domain/errors.js';
import type { StepCompletionId, StepId } from '../../domain/ids.js';
import type { ProcessInstance } from '../../domain/instance.js';
import { PROCESS_RUNNER, type ProcessRunner } from '../../domain/runner.js';
import type { StepDefinition } from '../../domain/template.js';
import { EffectApplier } from '../effect-applier.js';
import { processEvent } from '../events.js';
import { HandlerDepsFactory } from '../handler-deps.factory.js';
import { PROCESS_INSTANCE_REPOSITORY, type ProcessInstanceRepository } from '../ports/process-instance.repository.js';
import { PROCESS_TEMPLATE_REPOSITORY, type ProcessTemplateRepository } from '../ports/process-template.repository.js';
import { STEP_COMPLETION_REPOSITORY, type StepCompletionRepository } from '../ports/step-completion.repository.js';

export interface CompleteStepInput {
  readonly instanceId: ProcessInstanceId;
  readonly stepId: StepId;
  /** Raw, as it arrived. `null` means "omit this step", if the step allows it. */
  readonly payload: unknown;
}

export interface CompletedStep {
  readonly instance: ProcessInstance;
  /** The definition, not the id: it is what lets a client be generic (spec 13 §10). */
  readonly nextStep?: StepDefinition;
  /** Only when the process closed, because only then are there effects (P-6). */
  readonly movements?: Movement[];
}

/**
 * The twelve of spec 13 §7, in order and inside the transaction the edge
 * opened. Steps 4-6 are pure domain and touch no database; step 10 is the only
 * one that leaves the module, and it does so through the front door — the
 * public use cases of spec 12, with their invariants intact (P-7).
 */
@Injectable()
export class CompleteStep {
  constructor(
    @Inject(PROCESS_INSTANCE_REPOSITORY) private readonly instances: ProcessInstanceRepository,
    @Inject(PROCESS_TEMPLATE_REPOSITORY) private readonly templates: ProcessTemplateRepository,
    @Inject(STEP_COMPLETION_REPOSITORY) private readonly completions: StepCompletionRepository,
    @Inject(PROCESS_RUNNER) private readonly runner: ProcessRunner,
    private readonly deps: HandlerDepsFactory,
    private readonly effects: EffectApplier,
    @Inject(EVENT_PUBLISHER) private readonly events: EventPublisher,
    @Inject(ID_GENERATOR) private readonly ids: IdGenerator,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(ctx: RequestContext, input: CompleteStepInput): Promise<CompletedStep> {
    requireAction(ctx, Action.RECORD_MOVEMENT);

    // 1 — the instance exists and is OPEN (P-4).
    const instance = await this.instances.findById(ctx.orgId, input.instanceId);
    if (!instance) throw new ProcessInstanceNotFoundError();

    // 3a — **before P-2**, and this order is the whole point: a step that was
    // already done has moved behind the cursor, so the runner would call it
    // `wrong-step` and tell the client it arrived late instead of that it
    // already did this. P-3 deserves its own answer (spec 13 §7 step 3).
    // P-4 still wins over both: a cancelled process is closed, not misordered.
    const done = await this.completions.listByInstance(ctx.orgId, input.instanceId);
    if (instance.isOpen() && done.some((c) => c.stepId === input.stepId)) {
      throw new StepAlreadyCompletedError(input.stepId);
    }

    // 2 — the template **in the version the instance recorded** (P-1). The
    // composite foreign key guarantees the row is there.
    const template = await this.templates.findVersion(
      ctx.orgId, instance.templateCode, instance.templateVersion,
    );
    if (!template) throw new TemplateNotFoundError(instance.templateCode);

    // 3b-7 — P-4, P-2, parse, validate, apply, and the next step or COMPLETED.
    // It returns a Result and never throws (D-57).
    const outcome = await this.runner.advance({
      instance, template, stepId: input.stepId, payload: input.payload,
      deps: this.deps.for(ctx),
    });
    if (!outcome.ok) throw outcome.error;

    const at = this.clock.now();

    // 8 — append-only, and what it stores is the **enriched** payload that
    // `validate` gave back (D-56): in the row there is a record of what the
    // engine understood. An omitted step stores the JSON literal `null`
    // (spec 13 §9) — the difference between "this step was skipped" and "this
    // step does not exist" is precisely the row.
    await this.completions.append({
      id: this.ids.next() as StepCompletionId,
      orgId: ctx.orgId,
      instanceId: instance.id,
      stepId: input.stepId,
      actorId: ctx.userId,
      payload: outcome.value.payload,
      completedAt: at,
    });

    // 9 — state and context, with the optimistic lock of spec 13 §9: two
    // simultaneous completions do not step on each other's context.
    await this.instances.save(outcome.value.instance, instance.version);

    // 10 — only at completion, because that is the only time there are any
    // (P-6 as structure, D-55).
    let movements: Movement[] | undefined;
    if (outcome.value.effects.length > 0) {
      movements = await this.effects.apply(ctx, instance.id, outcome.value.effects);
    }

    // 11 — one clock reading shared by every event of the request.
    const published: DomainEvent[] = [
      processEvent(this.ids, 'process.step_completed', ctx.orgId, ctx.traceId, at, {
        instanceId: instance.id, stepId: input.stepId, omitted: outcome.value.payload === null,
      }),
    ];
    const closed = !outcome.value.instance.isOpen();
    if (closed) {
      // The movements are already recorded by the time this says so.
      published.push(
        processEvent(this.ids, 'process.completed', ctx.orgId, ctx.traceId, at, {
          instanceId: instance.id,
          templateCode: instance.templateCode as string,
          movementIds: (movements ?? []).map((m) => m.id),
        }),
      );
    }
    await this.events.publish(published);

    const nextStepId = outcome.value.instance.currentStepId;
    const nextStep = nextStepId === undefined ? null : template.step(nextStepId);

    return {
      instance: outcome.value.instance,
      ...(nextStep ? { nextStep } : {}),
      ...(movements !== undefined ? { movements } : {}),
    };
  }
}
