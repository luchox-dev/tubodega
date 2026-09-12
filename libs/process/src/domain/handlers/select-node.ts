import { err, ok, type Result } from '@app/common';
import { NodeKind, type NodeId } from '@app/inventory';
import type { ProcessContext } from '../context.js';
import { InvalidStepPayloadError } from '../errors.js';
import { NodeRole, StepType, type SelectNodePayload, type StepConfig } from '../step-types.js';
import type { HandlerDeps, StepHandler } from './handler.js';
import { asRecord } from './shared.js';

const allowedKinds = (config: StepConfig): readonly NodeKind[] => {
  const raw = config.allowedKinds;
  return Array.isArray(raw) ? (raw.filter((k): k is NodeKind => typeof k === 'string') as NodeKind[]) : [];
};

const role = (config: StepConfig): NodeRole => (config.role === NodeRole.FROM ? NodeRole.FROM : NodeRole.TO);

/**
 * Where it comes from, or where it goes. **One parametrised handler and not
 * two**, because validating a node is identical either way and what changes is
 * only where the answer lands. Its `config` says which:
 *
 *     { "role": "TO", "allowedKinds": ["INTERNAL"] }
 *
 * It is the pattern that stops near-identical handlers from breeding, and the
 * reason six templates are built out of eight pieces: the difference between a
 * receipt and a transfer is which `allowedKinds` one step carries.
 */
export class SelectNodeHandler implements StepHandler<SelectNodePayload> {
  readonly type = StepType.SELECT_NODE;

  parse(raw: unknown): Result<SelectNodePayload> {
    const body = asRecord(raw);
    const nodeId = typeof body?.nodeId === 'string' ? body.nodeId.trim() : '';
    if (nodeId === '') return err(new InvalidStepPayloadError('/nodeId', 'Falta el nodo'));
    return ok({ nodeId: nodeId as NodeId });
  }

  async validate(
    payload: SelectNodePayload,
    _ctx: ProcessContext,
    deps: HandlerDeps,
    config: StepConfig,
  ): Promise<Result<SelectNodePayload>> {
    const node = await deps.findNode(deps.orgId, payload.nodeId);
    if (!node) return err(new InvalidStepPayloadError('/nodeId', 'Ese nodo no existe en esta organización'));
    if (!node.canReceiveMovements()) {
      return err(new InvalidStepPayloadError('/nodeId', `"${node.path}" está inactivo y no admite movimientos`));
    }

    const permitidos = allowedKinds(config);
    if (permitidos.length > 0 && !permitidos.includes(node.kind)) {
      return err(
        new InvalidStepPayloadError(
          '/nodeId',
          `"${node.path}" es de tipo ${node.kind}, y este paso admite ${permitidos.join(', ')}`,
        ),
      );
    }
    return ok(payload);
  }

  apply(payload: SelectNodePayload, ctx: ProcessContext, config: StepConfig): ProcessContext {
    return role(config) === NodeRole.FROM
      ? ctx.withDraft({ fromNodeId: payload.nodeId })
      : ctx.withDraft({ toNodeId: payload.nodeId });
  }
}
