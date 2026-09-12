import { err, ok, type Result } from '@app/common';
import type { ProcessContext } from '../context.js';
import { InvalidStepPayloadError } from '../errors.js';
import { StepType, type SetDueDatePayload, type StepConfig } from '../step-types.js';
import type { HandlerDeps, StepHandler } from './handler.js';
import { asRecord } from './shared.js';

/**
 * When the loan comes back. Required in CUSTODIA: without a `dueAt` there is
 * nothing to fall due, and a loan nobody has to return raises none of the
 * alerts of spec 14 — which is half of why the loan exists.
 *
 * It does not re-check that the destination is a CUSTODY node: the `tenedor`
 * step comes before it in the template and already only accepts one, and
 * `Movement.create` refuses a `dueAt` towards anything else (I-11) anyway.
 */
export class SetDueDateHandler implements StepHandler<SetDueDatePayload> {
  readonly type = StepType.SET_DUE_DATE;

  parse(raw: unknown): Result<SetDueDatePayload> {
    const body = asRecord(raw);
    const value = body?.dueAt;
    const dueAt = value instanceof Date ? value : typeof value === 'string' ? new Date(value) : null;
    if (dueAt === null || Number.isNaN(dueAt.getTime())) {
      return err(new InvalidStepPayloadError('/dueAt', 'Falta la fecha de devolución, o no es una fecha'));
    }
    return ok({ dueAt });
  }

  validate(
    payload: SetDueDatePayload,
    _ctx: ProcessContext,
    deps: HandlerDeps,
    _config: StepConfig,
  ): Promise<Result<SetDueDatePayload>> {
    // A question about now, so it goes through the Clock port: no rule of the
    // house calls `new Date()` (spec 06 §4).
    if (payload.dueAt.getTime() <= deps.clock.now().getTime()) {
      return Promise.resolve(
        err(new InvalidStepPayloadError('/dueAt', 'La fecha de devolución tiene que ser futura')),
      );
    }
    return Promise.resolve(ok(payload));
  }

  apply(payload: SetDueDatePayload, ctx: ProcessContext): ProcessContext {
    return ctx.withDraft({ dueAt: payload.dueAt });
  }
}
