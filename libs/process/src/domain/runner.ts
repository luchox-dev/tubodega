import type { OrgId, ProcessInstanceId, Result, UserId } from '@app/common';
import type { Effect } from './effects.js';
import type { HandlerDeps } from './handlers/handler.js';
import type { ProcessInstance } from './instance.js';
import type { StepId } from './ids.js';
import type { StepPayload } from './step-types.js';
import type { ProcessTemplate } from './template.js';

export interface StartInput {
  readonly id: ProcessInstanceId;
  readonly orgId: OrgId;
  readonly template: ProcessTemplate;
  readonly actorId: UserId;
}

export interface AdvanceInput {
  readonly instance: ProcessInstance;
  /** In the version the instance recorded (P-1), which is the caller's job. */
  readonly template: ProcessTemplate;
  readonly stepId: StepId;
  /** Raw, as it arrived; `null` means "omit this step". */
  readonly payload: unknown;
  readonly deps: HandlerDeps;
}

export interface AdvanceOutcome {
  readonly instance: ProcessInstance;
  /** Not empty only at completion (P-6). */
  readonly effects: readonly Effect[];
  /** Parsed, so the caller can write the `step_completion` without re-parsing. */
  readonly payload: StepPayload | null;
}

/**
 * `GraphRunner` — the one that will evaluate conditions to pick among several
 * transitions — will implement this same interface, read the same tables and
 * produce the same effects. **Changing engines will be registering another
 * implementation in the root module.** Neither the domain, nor the schema, nor
 * the handlers find out.
 *
 * `advance` is async and takes the deps: spec 13 §4.1 draws it synchronous, but
 * `StepHandler.validate` asks the world and returns a Promise, and the six
 * templates cannot run without it.
 */
export interface ProcessRunner {
  start(input: StartInput): ProcessInstance;
  advance(input: AdvanceInput): Promise<Result<AdvanceOutcome>>;
}

/**
 * The seam of spec 13 §4.1. `GraphRunner` will be registered here instead, and
 * neither the domain, nor the schema, nor the handlers find out — which is why
 * the use cases inject the token and never `LinearRunner` by class (D-66).
 */
export const PROCESS_RUNNER = Symbol('ProcessRunner');
