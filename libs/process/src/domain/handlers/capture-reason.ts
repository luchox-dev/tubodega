import { err, ok, type Result } from '@app/common';
import type { ProcessContext } from '../context.js';
import { InvalidStepPayloadError } from '../errors.js';
import { StepType, type CaptureReasonPayload, type StepConfig } from '../step-types.js';
import type { HandlerDeps, StepHandler } from './handler.js';
import { asRecord } from './shared.js';

const MIN = 3;
const MAX = 500;

/** Why. Required in the two adjustment templates, because spec 02 §10 says so. */
export class CaptureReasonHandler implements StepHandler<CaptureReasonPayload> {
  readonly type = StepType.CAPTURE_REASON;

  parse(raw: unknown): Result<CaptureReasonPayload> {
    const body = asRecord(raw);
    const reason = typeof body?.reason === 'string' ? body.reason.trim() : '';
    if (reason.length < MIN || reason.length > MAX) {
      return err(new InvalidStepPayloadError('/reason', `El motivo va de ${MIN} a ${MAX} caracteres`));
    }
    return ok({ reason });
  }

  validate(
    payload: CaptureReasonPayload,
    _ctx: ProcessContext,
    _deps: HandlerDeps,
    _config: StepConfig,
  ): Promise<Result<CaptureReasonPayload>> {
    return Promise.resolve(ok(payload));
  }

  apply(payload: CaptureReasonPayload, ctx: ProcessContext): ProcessContext {
    return ctx.withDraft({ reason: payload.reason });
  }
}
