import { err, ok, type OrgId, type Result } from '@app/common';
import {
  BranchingNotSupportedError, InvalidTemplateError, UnknownStepTypeError,
} from './errors.js';
import { TemplateCode, type ProcessTemplateId, type StepId } from './ids.js';
import { isStepType, type StepConfig, type StepType } from './step-types.js';

export interface Transition {
  /** `null` ends the process. */
  readonly to: StepId | null;
  // The day of the workflow a `when?: Condition` appears here, where Condition
  // is a closed language of comparisons over the context (spec 90 §4). It does
  // not exist today, and P-8 forces the list to hold a single element.
}

export interface StepDefinition {
  readonly id: StepId;
  readonly type: StepType;
  readonly required: boolean;
  readonly config: StepConfig;
  readonly transitions: readonly Transition[];
}

export interface CreateTemplateProps {
  readonly id: ProcessTemplateId;
  readonly orgId: OrgId;
  readonly code: string;
  readonly version: number;
  /** Raw, as it travels in JSONB: validating it is the point of this file. */
  readonly steps: unknown;
  readonly active?: boolean;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Turns the JSONB of `process_template.steps` into steps that can be run, or
 * says why it cannot. Exported because plan 8's `CreateTemplateVersion` needs
 * the same answer before it writes a row.
 *
 * The order of the checks is the order of the messages somebody will read:
 * branching first, because it is the one that means "you reached the limit of
 * the MVP" and deserves its own name; then the unknown type; and only then the
 * structural faults, which all share `invalid-template`.
 */
export function parseSteps(raw: unknown): Result<readonly StepDefinition[]> {
  if (!Array.isArray(raw) || raw.length === 0) {
    return err(new InvalidTemplateError('no tiene pasos'));
  }

  const steps: StepDefinition[] = [];
  const seen = new Set<string>();

  for (const [i, item] of raw.entries()) {
    if (!isRecord(item)) return err(new InvalidTemplateError(`el paso ${i} no es un objeto`));

    const { id, type, required, config, transitions } = item;
    if (typeof id !== 'string' || id.trim() === '') {
      return err(new InvalidTemplateError(`el paso ${i} no tiene id`));
    }
    if (seen.has(id)) return err(new InvalidTemplateError(`hay dos pasos con el id "${id}"`));
    seen.add(id);

    if (!isStepType(type)) return err(new UnknownStepTypeError(String(type)));
    if (required !== undefined && typeof required !== 'boolean') {
      return err(new InvalidTemplateError(`el "required" del paso "${id}" no es un booleano`));
    }
    if (config !== undefined && !isRecord(config)) {
      return err(new InvalidTemplateError(`el "config" del paso "${id}" no es un objeto`));
    }

    if (!Array.isArray(transitions)) {
      return err(new InvalidTemplateError(`el paso "${id}" no dice a dónde va`));
    }
    // P-8, and it is checked before the empty list so the message that reads
    // "the capability is foreseen" is the one that comes out.
    if (transitions.length > 1) return err(new BranchingNotSupportedError(id));
    if (transitions.length === 0) {
      return err(new InvalidTemplateError(`el paso "${id}" no dice a dónde va`));
    }

    const t: unknown = transitions[0];
    if (!isRecord(t) || !('to' in t)) {
      return err(new InvalidTemplateError(`la transición del paso "${id}" no dice a dónde va`));
    }
    if (t.to !== null && typeof t.to !== 'string') {
      return err(new InvalidTemplateError(`la transición del paso "${id}" apunta a algo que no es un paso`));
    }

    steps.push({
      id: id as StepId,
      type,
      required: required ?? false,
      config: (config ?? {}) as StepConfig,
      transitions: [{ to: t.to as StepId | null }],
    });
  }

  // A transition pointing at a misspelled id passes every check above and gets
  // seeded broken; this is the one that catches it.
  for (const step of steps) {
    const to = step.transitions[0]?.to;
    if (to !== null && to !== undefined && !seen.has(to)) {
      return err(new InvalidTemplateError(`el paso "${step.id}" transita a "${to}", que no existe`));
    }
  }

  if (!steps.some((s) => s.transitions[0]?.to === null)) {
    return err(new InvalidTemplateError('ningún paso cierra con "to": null, así que no termina nunca'));
  }

  // Reachability from the first step. With P-8 this is a walk and not a search,
  // and the cycle guard is `seen`: a loop the model does not admit would hang.
  const reached = new Set<string>();
  let cursor: StepId | null | undefined = steps[0]?.id;
  while (cursor !== null && cursor !== undefined && !reached.has(cursor)) {
    reached.add(cursor);
    cursor = steps.find((s) => s.id === cursor)?.transitions[0]?.to;
  }
  const orphan = steps.find((s) => !reached.has(s.id));
  if (orphan) {
    return err(new InvalidTemplateError(`el paso "${orphan.id}" no se alcanza desde el primero`));
  }

  return ok(steps);
}

/**
 * A versioned list of typed steps, and nothing about what the process *means*:
 * the engine does not know what a receipt is, it knows how to run RECEPCION.
 *
 * There is no `rehydrate` twin here on purpose. Every other entity of the house
 * has one because re-validating a stored row on each read is waste; a template
 * is six rows of JSONB whose shape is going to change (spec 13 §9), the
 * validator is pure and cheap, and reading is the last chance to notice that
 * what got seeded cannot be run.
 */
export class ProcessTemplate {
  private constructor(
    readonly id: ProcessTemplateId,
    readonly orgId: OrgId,
    readonly code: TemplateCode,
    readonly version: number,
    readonly steps: readonly StepDefinition[],
    readonly active: boolean,
  ) {}

  static create(props: CreateTemplateProps): Result<ProcessTemplate> {
    const code = TemplateCode.of(props.code);
    if (!code.ok) return code;

    const steps = parseSteps(props.steps);
    if (!steps.ok) return steps;

    return ok(
      new ProcessTemplate(props.id, props.orgId, code.value, props.version, steps.value, props.active ?? true),
    );
  }

  firstStep(): StepDefinition {
    // parseSteps refuses an empty list, so there is always one.
    return this.steps[0] as StepDefinition;
  }

  step(id: StepId): StepDefinition | null {
    return this.steps.find((s) => s.id === id) ?? null;
  }

  transitionsFrom(id: StepId): readonly Transition[] {
    return this.step(id)?.transitions ?? [];
  }
}
