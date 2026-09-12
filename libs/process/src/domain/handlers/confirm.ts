import { err, ok, type Result } from '@app/common';
import type { NodeId } from '@app/inventory';
import type { ProcessContext } from '../context.js';
import type { Effect } from '../effects.js';
import { IncompleteDraftError, InvalidStepPayloadError } from '../errors.js';
import { StepType, type ConfirmPayload, type StepConfig } from '../step-types.js';
import type { HandlerDeps, StepHandler } from './handler.js';

interface Defaults {
  readonly fromNodeCode?: string;
  readonly toNodeCode?: string;
}

const defaults = (config: StepConfig): Defaults => {
  const raw = config.defaults;
  if (typeof raw !== 'object' || raw === null) return {};
  const { fromNodeCode, toNodeCode } = raw as Record<string, unknown>;
  return {
    ...(typeof fromNodeCode === 'string' ? { fromNodeCode } : {}),
    ...(typeof toNodeCode === 'string' ? { toNodeCode } : {}),
  };
};

/**
 * The only step that turns intent into facts. It checks the draft is complete,
 * resolves whatever side its `config` fixes, and emits the three effects in the
 * order the applier needs them.
 *
 * The fixed side is resolved **by node code and not by a list of uuids**: the
 * eight boundary nodes are seeded per organization by `SeedBoundaryNodes`
 * (spec 04 §6) and are different in each one, so a `default` naming an id would
 * be a factory template that only works for one company.
 *
 * **Whatever the draft already carries wins over the default.** A positive
 * adjustment does not ask the operator to "choose" the only possible node, but
 * a template that does ask keeps the answer.
 */
export class ConfirmHandler implements StepHandler<ConfirmPayload> {
  readonly type = StepType.CONFIRM;

  parse(): Result<ConfirmPayload> {
    // Whatever arrives is ignored: everything CONFIRM needs is in the context.
    return ok({});
  }

  async validate(
    _payload: ConfirmPayload,
    ctx: ProcessContext,
    deps: HandlerDeps,
    config: StepConfig,
  ): Promise<Result<ConfirmPayload>> {
    const { fromNodeCode, toNodeCode } = defaults(config);
    const resuelto: { fromNodeId?: NodeId; toNodeId?: NodeId } = {};

    if (ctx.draft.fromNodeId === undefined && fromNodeCode !== undefined) {
      const node = await deps.findNodeByCode(deps.orgId, fromNodeCode);
      if (!node) {
        return err(new InvalidStepPayloadError('/', `La plantilla fija el origen "${fromNodeCode}", que no existe aquí`));
      }
      resuelto.fromNodeId = node.id;
    }
    if (ctx.draft.toNodeId === undefined && toNodeCode !== undefined) {
      const node = await deps.findNodeByCode(deps.orgId, toNodeCode);
      if (!node) {
        return err(new InvalidStepPayloadError('/', `La plantilla fija el destino "${toNodeCode}", que no existe aquí`));
      }
      resuelto.toNodeId = node.id;
    }

    const falta: string[] = [];
    if (ctx.draft.productId === undefined) falta.push('el producto');
    if (ctx.draft.quantity === undefined) falta.push('la cantidad');
    if (ctx.draft.fromNodeId === undefined && resuelto.fromNodeId === undefined) falta.push('el origen');
    if (ctx.draft.toNodeId === undefined && resuelto.toNodeId === undefined) falta.push('el destino');
    if (falta.length > 0) return err(new IncompleteDraftError(falta));

    return ok(resuelto);
  }

  apply(payload: ConfirmPayload, ctx: ProcessContext): ProcessContext {
    return ctx.withDraft({
      ...(payload.fromNodeId !== undefined ? { fromNodeId: payload.fromNodeId } : {}),
      ...(payload.toNodeId !== undefined ? { toNodeId: payload.toNodeId } : {}),
    });
  }

  /**
   * In this order, and the order is not cosmetic: the movement needs the
   * `batchId` of a batch that does not exist yet, so `CREATE_BATCH` goes first
   * and `feeds` says which draft to write its id into.
   */
  effects(ctx: ProcessContext): readonly Effect[] {
    const out: Effect[] = [];
    if (ctx.draft.newBatch !== undefined) {
      out.push({ kind: 'CREATE_BATCH', draft: ctx.draft.newBatch, feeds: 0 });
    }
    out.push({ kind: 'EMIT_MOVEMENTS', drafts: [ctx.draft] });
    if (ctx.storageKeys.length > 0 && ctx.draft.productId !== undefined) {
      out.push({ kind: 'ATTACH_MEDIA', productId: ctx.draft.productId, storageKeys: ctx.storageKeys });
    }
    return out;
  }
}
