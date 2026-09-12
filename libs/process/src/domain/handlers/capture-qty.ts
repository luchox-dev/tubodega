import { err, ok, type Result } from '@app/common';
import { UnitOfMeasure } from '@app/catalog';
import { Quantity } from '@app/inventory';
import type { ProcessContext } from '../context.js';
import { InvalidStepPayloadError } from '../errors.js';
import { StepType, type CaptureQtyPayload, type StepConfig } from '../step-types.js';
import type { HandlerDeps, StepHandler } from './handler.js';
import { asRecord, productoDelBorrador } from './shared.js';

/** Half a screw is not half of anything (spec 13 §5). */
const SIN_DECIMALES: readonly UnitOfMeasure[] = [UnitOfMeasure.UNIT, UnitOfMeasure.BOX, UnitOfMeasure.PACK];

export class CaptureQtyHandler implements StepHandler<CaptureQtyPayload> {
  readonly type = StepType.CAPTURE_QTY;

  parse(raw: unknown): Result<CaptureQtyPayload> {
    const body = asRecord(raw);
    if (typeof body?.quantity !== 'string') {
      return err(new InvalidStepPayloadError('/quantity', 'Falta la cantidad'));
    }
    // Quantity.of already refuses zero and the negative (I-2); its message is
    // the good one, and `invalid-step-payload` is the type the client expects
    // from a step.
    const q = Quantity.of(body.quantity);
    if (!q.ok) return err(new InvalidStepPayloadError('/quantity', q.error.message));
    return ok({ quantity: body.quantity, value: q.value });
  }

  async validate(
    payload: CaptureQtyPayload,
    ctx: ProcessContext,
    deps: HandlerDeps,
    _config: StepConfig,
  ): Promise<Result<CaptureQtyPayload>> {
    const product = await productoDelBorrador(ctx, deps);
    if (!product.ok) return product;

    if (SIN_DECIMALES.includes(product.value.uom) && !payload.value?.toString().endsWith('.000')) {
      return err(
        new InvalidStepPayloadError('/quantity', `"${product.value.sku}" se cuenta por ${product.value.uom}: sin decimales`),
      );
    }
    return ok(payload);
  }

  apply(payload: CaptureQtyPayload, ctx: ProcessContext): ProcessContext {
    return payload.value === undefined ? ctx : ctx.withDraft({ quantity: payload.value });
  }
}
