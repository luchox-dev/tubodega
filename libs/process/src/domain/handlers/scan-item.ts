import { err, ok, type Result } from '@app/common';
import type { ProcessContext } from '../context.js';
import { InvalidStepPayloadError } from '../errors.js';
import { StepType, type ScanItemPayload, type StepConfig } from '../step-types.js';
import type { HandlerDeps, StepHandler } from './handler.js';
import { asRecord } from './shared.js';

/**
 * What the scanner read. The code resolves to an active product, and — if it
 * was a serial that already exists — to its unit too, which is what makes
 * scanning BSH-001 put both the drill and that drill in the draft.
 */
export class ScanItemHandler implements StepHandler<ScanItemPayload> {
  readonly type = StepType.SCAN_ITEM;

  parse(raw: unknown): Result<ScanItemPayload> {
    const body = asRecord(raw);
    const code = typeof body?.code === 'string' ? body.code.trim() : '';
    if (code === '') return err(new InvalidStepPayloadError('/code', 'Falta el código que se escaneó'));
    return ok({ code });
  }

  async validate(
    payload: ScanItemPayload,
    _ctx: ProcessContext,
    deps: HandlerDeps,
    _config: StepConfig,
  ): Promise<Result<ScanItemPayload>> {
    // Returns null rather than throwing, like `ResolveCode` of spec 11 §4.
    const found = await deps.resolveCode(deps.orgId, payload.code);
    if (!found) {
      return err(new InvalidStepPayloadError('/code', `"${payload.code}" no corresponde a nada del catálogo`));
    }
    if (!found.product.active) {
      return err(new InvalidStepPayloadError('/code', `"${found.product.sku}" está retirado del catálogo`));
    }
    return ok({
      code: payload.code,
      productId: found.product.id,
      ...(found.batch !== undefined ? { batchId: found.batch.id } : {}),
    });
  }

  apply(payload: ScanItemPayload, ctx: ProcessContext): ProcessContext {
    return ctx.withDraft({
      ...(payload.productId !== undefined ? { productId: payload.productId } : {}),
      ...(payload.batchId !== undefined ? { batchId: payload.batchId } : {}),
    });
  }
}
