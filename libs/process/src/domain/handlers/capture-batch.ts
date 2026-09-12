import { err, ok, type Result } from '@app/common';
import { TrackingMode } from '@app/catalog';
import type { ProcessContext } from '../context.js';
import { BatchStepNotAllowedError, BatchStepRequiredError, InvalidStepPayloadError } from '../errors.js';
import { StepType, type CaptureBatchPayload, type StepConfig } from '../step-types.js';
import type { HandlerDeps, StepHandler } from './handler.js';
import { asRecord, productoDelBorrador } from './shared.js';

const fecha = (v: unknown): Date | null | undefined => {
  if (v === undefined || v === null) return undefined;
  const d = v instanceof Date ? v : typeof v === 'string' ? new Date(v) : null;
  return d === null || Number.isNaN(d.getTime()) ? null : d;
};

/**
 * The step that exists because **a new batch does not exist before the receipt
 * that brings it**. `SCAN_ITEM` can only resolve what is already in the
 * catalogue; the milk that arrived today, or the drill bought yesterday, are
 * not. Without this step `CONFIRM` would reach `Movement.create` with no
 * `batchId` for a LOT product and fail I-8, and the factory templates would be
 * useless for half the catalogue the product claims to serve.
 *
 * The six cells of spec 13 §5, plus the seventh case the table leaves implicit:
 * the scan already contributed the batch, and then omitting this step is right.
 */
export class CaptureBatchHandler implements StepHandler<CaptureBatchPayload> {
  readonly type = StepType.CAPTURE_BATCH;

  parse(raw: unknown): Result<CaptureBatchPayload> {
    const body = asRecord(raw);
    if (!body) return err(new InvalidStepPayloadError('/', 'El paso del lote espera un objeto'));

    const lotCode = typeof body.lotCode === 'string' ? body.lotCode.trim() || undefined : undefined;
    const serial = typeof body.serial === 'string' ? body.serial.trim() || undefined : undefined;
    const expiresAt = fecha(body.expiresAt);
    if (expiresAt === null) return err(new InvalidStepPayloadError('/expiresAt', 'La fecha de vencimiento no es una fecha'));

    return ok({
      ...(lotCode !== undefined ? { lotCode } : {}),
      ...(serial !== undefined ? { serial } : {}),
      ...(expiresAt !== undefined ? { expiresAt } : {}),
    });
  }

  async validate(
    payload: CaptureBatchPayload,
    ctx: ProcessContext,
    deps: HandlerDeps,
    _config?: StepConfig,
  ): Promise<Result<CaptureBatchPayload>> {
    const found = await productoDelBorrador(ctx, deps);
    if (!found.ok) return found;
    const product = found.value;

    if (product.trackingMode === TrackingMode.QUANTITY) {
      return err(new BatchStepNotAllowedError(product.sku));
    }

    if (product.trackingMode === TrackingMode.LOT) {
      if (payload.lotCode === undefined) {
        return err(new InvalidStepPayloadError('/lotCode', `"${product.sku}" se rastrea por lote: falta el código`));
      }
      const existente = await deps.findBatchByLot(deps.orgId, product.id, payload.lotCode);
      return ok(
        existente
          ? { ...payload, batchId: existente.id }
          : {
              ...payload,
              newBatch: {
                productId: product.id,
                lotCode: payload.lotCode,
                ...(payload.expiresAt !== undefined ? { expiresAt: payload.expiresAt } : {}),
              },
            },
      );
    }

    if (payload.serial === undefined) {
      return err(new InvalidStepPayloadError('/serial', `"${product.sku}" se rastrea por serie: falta el número`));
    }
    // I-9 —una serie es una sola cosa— se comprueba al confirmar, que es cuando
    // se sabe de dónde viene y adónde va.
    const existente = await deps.findBatchBySerial(deps.orgId, payload.serial);
    return ok(
      existente
        ? { ...payload, batchId: existente.id }
        : { ...payload, newBatch: { productId: product.id, serial: payload.serial } },
    );
  }

  /**
   * The handler that demands not to be skipped. The step is optional in the
   * template because the template does not know what product will go through
   * it; this one does (spec 13 §4.2).
   */
  async onOmit(ctx: ProcessContext, deps: HandlerDeps, _config?: StepConfig): Promise<Result<ProcessContext>> {
    const found = await productoDelBorrador(ctx, deps);
    if (!found.ok) return found;
    const product = found.value;

    if (product.trackingMode === TrackingMode.QUANTITY) return ok(ctx);
    // ...unless the scan already contributed it: a serial resolves to its unit.
    if (ctx.draft.batchId !== undefined) return ok(ctx);
    return err(new BatchStepRequiredError(product.sku, product.trackingMode));
  }

  apply(payload: CaptureBatchPayload, ctx: ProcessContext): ProcessContext {
    return ctx.withDraft({
      ...(payload.batchId !== undefined ? { batchId: payload.batchId } : {}),
      ...(payload.newBatch !== undefined ? { newBatch: payload.newBatch } : {}),
    });
  }
}
