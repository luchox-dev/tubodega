import type { Clock, OrgId, Result } from '@app/common';
import type { Batch, Product, ProductId } from '@app/catalog';
import type { Node, NodeId } from '@app/inventory';
import type { ProcessContext } from '../context.js';
import type { Effect } from '../effects.js';
import type { StepConfig, StepPayload, StepType } from '../step-types.js';

/** What resolving a scanned code gives back; `batch` only if it was a serial. */
export interface ResolvedCode {
  readonly product: Product;
  readonly batch?: Batch;
}

/**
 * Read-only by type, and built by `application/` out of the repositories of
 * `catalog` and `inventory` — there are no bridge ports (spec 13 §8, D-46).
 * They are **functions and not ports**: the methods already exist with exactly
 * these signatures, and a port that re-exported them would be a file that ages
 * apart from the one it copies.
 *
 * Six reads and a clock, not three: `CAPTURE_BATCH` has to choose between a
 * batch that exists and one to create, and that is two lookups; `CONFIRM`
 * resolves its `defaults` by node **code**; and `SET_DUE_DATE` validates
 * "in the future", which is a question about now and therefore about `Clock`
 * (spec 06 §4: no rule calls `new Date()`).
 */
export interface HandlerDeps {
  /**
   * The organization the six reads are scoped by. Spec 13 §4.2 writes the
   * `orgId` into each signature — which is what lets `application/` bind them
   * straight from the repository methods without an adapter (D-46) — and a
   * handler has no other way to know it: `ProcessContext` deliberately carries
   * no tenancy, and `validate` takes no instance.
   */
  readonly orgId: OrgId;
  readonly resolveCode: (orgId: OrgId, raw: string) => Promise<ResolvedCode | null>;
  readonly findNode: (orgId: OrgId, id: NodeId) => Promise<Node | null>;
  readonly findNodeByCode: (orgId: OrgId, code: string) => Promise<Node | null>;
  readonly findProduct: (orgId: OrgId, id: ProductId) => Promise<Product | null>;
  readonly findBatchByLot: (orgId: OrgId, productId: ProductId, lotCode: string) => Promise<Batch | null>;
  readonly findBatchBySerial: (orgId: OrgId, serial: string) => Promise<Batch | null>;
  readonly clock: Clock;
}

/**
 * Three rules define the engine: a handler never writes — `apply` returns a new
 * `ProcessContext` and its dependencies are read-only by type; a handler does
 * not know the others — they talk through the context; and handlers live in a
 * registry, not in a `switch`.
 *
 * **The three signatures take the step's `config`**, not just `parse`:
 * `SELECT_NODE` reads `allowedKinds` when validating and `role` when applying,
 * and `CONFIRM` resolves `defaults.fromNodeCode` when validating. Without the
 * config there, the three handlers that depend on it could not do their job.
 */
export interface StepHandler<P extends StepPayload = StepPayload> {
  readonly type: StepType;

  /** The shape of the payload. Never touches the world. */
  parse(raw: unknown, config: StepConfig): Result<P>;

  /** Against the world, read-only. */
  validate(payload: P, ctx: ProcessContext, deps: HandlerDeps, config: StepConfig): Promise<Result<P>>;

  /** A new context. This is the only thing a handler produces. */
  apply(payload: P, ctx: ProcessContext, config: StepConfig): ProcessContext;

  /**
   * What to do when this step is **omitted**. Only `CAPTURE_BATCH` has one: a
   * handler may demand to be skipped, or demand not to be (spec 13 §4.2), and
   * the step is optional in the template because the template does not know
   * what product will go through it — the handler does.
   *
   * A handler without one is genuinely not invoked when its step is omitted.
   */
  onOmit?(ctx: ProcessContext, deps: HandlerDeps, config: StepConfig): Promise<Result<ProcessContext>>;

  /**
   * What to do once the process is over. Only `CONFIRM` has one: `apply` gives
   * nowhere to return an effect, and P-6 says effects come out only at
   * completion — so the runner asks for these exactly when the instance
   * reaches COMPLETED, which is P-6 turned into structure.
   */
  effects?(ctx: ProcessContext, config: StepConfig): readonly Effect[];
}
