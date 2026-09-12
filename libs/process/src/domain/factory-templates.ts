import { NodeKind } from '@app/inventory';
import { NodeRole, StepType, type StepConfig } from './step-types.js';

/** A step as a factory template writes it, before `parseSteps` types it. */
export interface FactoryStep {
  readonly id: string;
  readonly type: StepType;
  readonly required: boolean;
  readonly config?: StepConfig;
  readonly transitions: readonly { readonly to: string | null }[];
}

export interface FactoryTemplate {
  readonly code: string;
  readonly version: number;
  readonly steps: readonly FactoryStep[];
}

const to = (id: string | null) => [{ to: id }] as const;

// The three steps every template shares, in the order every template uses them.
const item = (next: string): FactoryStep => ({
  id: 'item', type: StepType.SCAN_ITEM, required: true, transitions: to(next),
});
const lote = (next: string): FactoryStep => ({
  id: 'lote', type: StepType.CAPTURE_BATCH, required: false, transitions: to(next),
});
const cantidad = (next: string): FactoryStep => ({
  id: 'cantidad', type: StepType.CAPTURE_QTY, required: true, transitions: to(next),
});
const nodo = (id: string, role: NodeRole, kinds: readonly NodeKind[], next: string): FactoryStep => ({
  id, type: StepType.SELECT_NODE, required: true,
  config: { role, allowedKinds: [...kinds] },
  transitions: to(next),
});
const confirmar = (config?: StepConfig): FactoryStep => ({
  id: 'confirmar', type: StepType.CONFIRM, required: true,
  ...(config !== undefined ? { config } : {}),
  transitions: to(null),
});

/**
 * The six of spec 13 §6, seeded with every organization at version 1.
 *
 * Six processes, eight handlers, one engine: **the difference between a receipt
 * and a transfer is which `allowedKinds` one step carries**. That is the sign
 * the abstraction sits at the right level.
 *
 * `motivo` is `required: true` in the two adjustments and not out of taste: a
 * movement whose end is `adjustment-in` or `adjustment-out` demands a `reason`
 * in the domain (spec 02 §10, decision D-36), so an optional one would give a
 * template that reaches CONFIRM and always fails. `vencimiento` is required for
 * the same kind of reason: without `dueAt` there is nothing to come due, and a
 * loan nobody has to return raises none of the alerts of spec 14.
 *
 * Only RECEPCION carries `foto`: it is the one operation where there is
 * something to photograph that the catalogue does not already have.
 */
export const FACTORY_TEMPLATES: readonly FactoryTemplate[] = [
  // RECEPCION — de un proveedor a una ubicación interna
  {
    code: 'RECEPCION', version: 1,
    steps: [
      nodo('origen', NodeRole.FROM, [NodeKind.SOURCE], 'item'),
      item('lote'),
      lote('cantidad'),
      cantidad('foto'),
      { id: 'foto', type: StepType.CAPTURE_PHOTO, required: false, transitions: to('destino') },
      nodo('destino', NodeRole.TO, [NodeKind.INTERNAL], 'confirmar'),
      confirmar(),
    ],
  },
  // TRASLADO — de una ubicación interna a otra
  {
    code: 'TRASLADO', version: 1,
    steps: [
      nodo('origen', NodeRole.FROM, [NodeKind.INTERNAL], 'item'),
      item('lote'),
      lote('cantidad'),
      cantidad('destino'),
      nodo('destino', NodeRole.TO, [NodeKind.INTERNAL], 'confirmar'),
      confirmar(),
    ],
  },
  // SALIDA — venta, consumo o devolución al proveedor
  {
    code: 'SALIDA', version: 1,
    steps: [
      nodo('origen', NodeRole.FROM, [NodeKind.INTERNAL], 'item'),
      item('lote'),
      lote('cantidad'),
      cantidad('destino'),
      nodo('destino', NodeRole.TO, [NodeKind.TERMINAL], 'confirmar'),
      confirmar(),
    ],
  },
  // AJUSTE_ENTRADA — aparece stock que no estaba contado. Sin paso `origen`: lo fija CONFIRM
  {
    code: 'AJUSTE_ENTRADA', version: 1,
    steps: [
      item('lote'),
      lote('cantidad'),
      cantidad('motivo'),
      { id: 'motivo', type: StepType.CAPTURE_REASON, required: true, transitions: to('destino') },
      nodo('destino', NodeRole.TO, [NodeKind.INTERNAL], 'confirmar'),
      confirmar({ defaults: { fromNodeCode: 'adjustment-in' } }),
    ],
  },
  // AJUSTE_SALIDA — falta stock que estaba contado. Sin paso `destino`: lo fija CONFIRM
  {
    code: 'AJUSTE_SALIDA', version: 1,
    steps: [
      nodo('origen', NodeRole.FROM, [NodeKind.INTERNAL], 'item'),
      item('lote'),
      lote('cantidad'),
      cantidad('motivo'),
      { id: 'motivo', type: StepType.CAPTURE_REASON, required: true, transitions: to('confirmar') },
      confirmar({ defaults: { toNodeCode: 'adjustment-out' } }),
    ],
  },
  // CUSTODIA — préstamo a un tenedor, con fecha de devolución
  {
    code: 'CUSTODIA', version: 1,
    steps: [
      nodo('origen', NodeRole.FROM, [NodeKind.INTERNAL], 'item'),
      item('lote'),
      lote('cantidad'),
      cantidad('tenedor'),
      nodo('tenedor', NodeRole.TO, [NodeKind.CUSTODY], 'vencimiento'),
      { id: 'vencimiento', type: StepType.SET_DUE_DATE, required: true, transitions: to('confirmar') },
      confirmar(),
    ],
  },
];

export const FACTORY_TEMPLATE_CODES = FACTORY_TEMPLATES.map((t) => t.code);
