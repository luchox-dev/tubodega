import { err, ok, type Result } from '@app/common';
import {
  InstanceClosedError, InvalidTemplateError, RequiredStepSkippedError,
  UnknownStepTypeError, WrongStepError,
} from './errors.js';
import { ProcessInstance } from './instance.js';
import type { Effect } from './effects.js';
import type { StepHandlerRegistry } from './handlers/registry.js';
import type { AdvanceInput, AdvanceOutcome, ProcessRunner, StartInput } from './runner.js';
import type { StepPayload } from './step-types.js';

/** The single transition of the current step decides the next one. */
export class LinearRunner implements ProcessRunner {
  constructor(private readonly handlers: StepHandlerRegistry) {}

  start(input: StartInput): ProcessInstance {
    return ProcessInstance.start({
      id: input.id,
      orgId: input.orgId,
      templateCode: input.template.code,
      templateVersion: input.template.version,
      firstStepId: input.template.firstStep().id,
      actorId: input.actorId,
    });
  }

  async advance(input: AdvanceInput): Promise<Result<AdvanceOutcome>> {
    const { instance, template, stepId, payload: raw, deps } = input;

    // P-4 before P-2: a closed instance has no current step to be wrong about.
    if (!instance.isOpen()) return err(new InstanceClosedError(instance.state));
    if (instance.currentStepId !== stepId) {
      return err(new WrongStepError(stepId, instance.currentStepId));
    }

    const step = template.step(stepId);
    if (!step) {
      // The instance points at its own version of the template, so this can
      // only mean the two were loaded out of step with each other.
      return err(new InvalidTemplateError(`el paso "${stepId}" no está en la plantilla`));
    }

    let context = instance.context;
    let payload: StepPayload | null = null;
    let effectsOf: (() => readonly Effect[]) | null = null;

    if (raw === null) {
      // Omitting is completing with a null payload: the engine records the
      // step_completion, **does not invoke the handler**, and moves on. So the
      // generic client has one single way to advance and needs no "skip"
      // endpoint (spec 13 §4.2).
      if (step.required) return err(new RequiredStepSkippedError(stepId));
    } else {
      const handler = this.handlers.get(step.type);
      if (!handler) return err(new UnknownStepTypeError(step.type));

      const parsed = handler.parse(raw, step.config);
      if (!parsed.ok) return parsed;

      const validated = await handler.validate(parsed.value, context, deps, step.config);
      if (!validated.ok) return validated;

      payload = validated.value;
      context = handler.apply(validated.value, context, step.config);
      effectsOf = handler.effects ? () => handler.effects!(context, step.config) : null;
    }

    context = context.with(stepId, payload);

    const next = step.transitions[0]?.to ?? null;
    if (next !== null) {
      return ok({ instance: instance.at(next, context), effects: [], payload });
    }

    // P-6 as structure: the effects are asked for here and nowhere else, which
    // is the instant the instance reaches COMPLETED.
    return ok({ instance: instance.completed(context), effects: effectsOf?.() ?? [], payload });
  }
}
