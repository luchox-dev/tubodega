import { err, ok, type Result } from '@app/common';
import type { StorageKey } from '@app/catalog';
import type { ProcessContext } from '../context.js';
import { InvalidStepPayloadError } from '../errors.js';
import { StepType, type CapturePhotoPayload, type StepConfig } from '../step-types.js';
import type { HandlerDeps, StepHandler } from './handler.js';
import { asRecord } from './shared.js';

const MIN = 1;
const MAX = 5;

/**
 * The photos of a receipt. **It produces no effect, not even this one**:
 * `apply` returns a `ProcessContext` and has nowhere to return anything else,
 * and P-6 says effects come out only at completion. The keys pile up in
 * `ProcessContext.storageKeys`, and it is `CONFIRM` that emits `ATTACH_MEDIA`
 * on closing — so a process abandoned half-way attaches nothing, which is the
 * non-obvious half of P-6: it dirties neither the inventory **nor the
 * catalogue**.
 *
 * It does not check the waiting room either, and that is deliberate. Claiming a
 * key is a write, its read-only twin does not exist, and a check here would be
 * one anyway: between capturing and confirming, somebody else can claim the
 * key. `AttachMedia` of spec 11 §4 checks and claims in the same move when
 * `CONFIRM` runs its effect, and raises the very `upload-not-found` that spec
 * 13 §12 asks for.
 */
export class CapturePhotoHandler implements StepHandler<CapturePhotoPayload> {
  readonly type = StepType.CAPTURE_PHOTO;

  parse(raw: unknown): Result<CapturePhotoPayload> {
    const body = asRecord(raw);
    const keys = body?.storageKeys;
    if (!Array.isArray(keys) || keys.length < MIN || keys.length > MAX) {
      return err(new InvalidStepPayloadError('/storageKeys', `Van de ${MIN} a ${MAX} imágenes`));
    }
    if (!keys.every((k) => typeof k === 'string' && k.trim() !== '')) {
      return err(new InvalidStepPayloadError('/storageKeys', 'Alguna clave de imagen viene vacía'));
    }
    return ok({ storageKeys: keys.map((k: string) => k.trim() as StorageKey) });
  }

  validate(
    payload: CapturePhotoPayload,
    _ctx: ProcessContext,
    _deps: HandlerDeps,
    _config: StepConfig,
  ): Promise<Result<CapturePhotoPayload>> {
    return Promise.resolve(ok(payload));
  }

  apply(payload: CapturePhotoPayload, ctx: ProcessContext): ProcessContext {
    return ctx.withStorageKeys(payload.storageKeys);
  }
}
