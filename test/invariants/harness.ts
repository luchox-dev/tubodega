/**
 * The context the property tests run in: the real inventory use cases, wired to
 * Postgres through the same port↔adapter table the application uses, plus the
 * committed world they move things around in.
 *
 * The whole application is deliberately *not* started. Over HTTP every request
 * commits, and then there would be no way to undo a run — and a property that
 * leaves its rows behind stops being a property after the first one (spec 06 §7).
 */
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import fc from 'fast-check';
import { v7 } from 'uuid';
import { DomainError, validate, type OrgId, type TraceId, type UserId } from '@app/common';
import type { BatchId, ProductId } from '@app/catalog';
import {
  InventoryModule, RecordMovement, ReverseMovement,
  type MovementId, type NodeId,
} from '@app/inventory';
import {
  KyselyFactory, KyselyMovementRepository, KyselyStockBalanceRepository,
  KyselyUnitOfWork, TransactionContext,
} from '@app/persistence';
import { Role, type RequestContext } from '@app/tenancy';
import { AdaptersModule } from '../../apps/tubodega/src/adapters/adapters.module.js';
import type { NodeShape, PlannedOp, ProductShape } from './arbitraries.js';

export async function createInvariantHarness() {
  const mod = await Test.createTestingModule({
    // AdaptersModule is the real composition root. Rebuilding its port table
    // here would mean the properties prove a wiring nobody ships.
    imports: [ConfigModule.forRoot({ isGlobal: true, validate }), AdaptersModule, InventoryModule],
  }).compile();
  return {
    uow: mod.get(KyselyUnitOfWork),
    ctx: mod.get(TransactionContext),
    factory: mod.get(KyselyFactory),
    record: mod.get(RecordMovement),
    reverse: mod.get(ReverseMovement),
    movements: mod.get(KyselyMovementRepository),
    balances: mod.get(KyselyStockBalanceRepository),
    close: () => mod.close(),
  };
}

export type InvariantHarness = Awaited<ReturnType<typeof createInvariantHarness>>;

export interface InvariantWorld {
  readonly orgId: OrgId;
  readonly userId: UserId;
  readonly products: readonly ProductShape[];
  readonly nodes: readonly NodeShape[];
  product(alias: string): ProductId;
  batch(alias: string): BatchId;
  node(alias: string): NodeId;
}

export interface WorldShape {
  readonly products: readonly ProductShape[];
  readonly nodes: readonly NodeShape[];
}

/** What the generator needs to know about the world: shapes, never ids. */
export const shapeOf = (w: InvariantWorld): WorldShape => ({ products: w.products, nodes: w.nodes });

/**
 * A narrower world for the I-9 property: one serial product with two serials,
 * one shelf pair, one of each boundary. The interleavings that matter to a
 * serial — out through a TERMINAL, back in from a SOURCE, then a compensation —
 * are rare in the full world simply because three quarters of the catalogue is
 * not serialised. Narrowing the *shape* concentrates the search where the
 * invariant lives; the seeded world is the same one.
 *
 * One by-quantity product stays: it is the fallback `receivable` needs when
 * every serial is already on a shelf, and without it a step would have nothing
 * left to degrade to.
 */
export const serialHeavyShape = (w: InvariantWorld): WorldShape => ({
  products: w.products.filter((p) => p.alias === 'SER-A' || p.alias === 'QTY-A')
    .map((p) => (p.alias === 'SER-A' ? { ...p, batches: p.batches.slice(0, 2) } : p)),
  nodes: w.nodes.filter((n) => ['BIN-1', 'BIN-2', 'CUS-1', 'TRM-1', 'SRC-1'].includes(n.alias)),
});

const PRODUCTS: readonly ProductShape[] = [
  { alias: 'QTY-A', trackingMode: 'QUANTITY', batches: [] },
  { alias: 'QTY-B', trackingMode: 'QUANTITY', batches: [] },
  { alias: 'LOT-A', trackingMode: 'LOT', batches: ['LOT-A/1', 'LOT-A/2'] },
  { alias: 'SER-A', trackingMode: 'SERIAL', batches: ['SER-A/1', 'SER-A/2', 'SER-A/3'] },
];

// No node may be called `adjustment-in`, `adjustment-out` or `shrinkage`: those
// codes make the domain demand a `reason` (D-10), and every generated movement
// would come back rejected for a reason that has nothing to do with the ledger.
const NODES: readonly NodeShape[] = [
  { alias: 'BIN-1', kind: 'INTERNAL' }, { alias: 'BIN-2', kind: 'INTERNAL' }, { alias: 'BIN-3', kind: 'INTERNAL' },
  { alias: 'CUS-1', kind: 'CUSTODY' }, { alias: 'CUS-2', kind: 'CUSTODY' },
  { alias: 'TRM-1', kind: 'TERMINAL' }, { alias: 'TRM-2', kind: 'TERMINAL' },
  { alias: 'SRC-1', kind: 'SOURCE' }, { alias: 'SRC-2', kind: 'SOURCE' },
];

const tail = (id: string): string => id.slice(-12);

/**
 * Commits one organization with everything the generator can name. Committed and
 * not rolled back: each run rolls back its own movements, so the world it moves
 * has to already be there when the first one starts.
 *
 * One world per `.prop-spec.ts` file. Vitest runs files in parallel, and sharing
 * an organization would put them in a fight over the same serials and the same
 * partial UNIQUE on reversals.
 */
export async function seedInvariantWorld(h: InvariantHarness, label: string): Promise<InvariantWorld> {
  const orgId = v7() as OrgId;
  const userId = v7() as UserId;
  const productIds = new Map<string, string>();
  const batchIds = new Map<string, string>();
  const nodeIds = new Map<string, string>();

  for (const p of PRODUCTS) productIds.set(p.alias, v7());
  for (const p of PRODUCTS) for (const b of p.batches) batchIds.set(b, v7());
  for (const n of NODES) nodeIds.set(n.alias, v7());

  await h.uow.runAs({ pool: 'system' }, async () => {
    const db = h.ctx.current();
    await db.insertInto('organization')
      .values({ id: orgId, name: label, slug: `${label}-${tail(orgId)}` }).execute();
    await db.insertInto('appUser').values({
      id: userId, orgId, email: `${label}-${tail(userId)}@invariants.test`,
      passwordHash: 'h', name: label,
    }).execute();
    await db.insertInto('product').values(PRODUCTS.map((p) => ({
      id: productIds.get(p.alias)!, orgId,
      sku: `${p.alias}-${tail(productIds.get(p.alias)!)}`,
      name: p.alias, trackingMode: p.trackingMode, uom: 'UNIT',
    }))).execute();
    await db.insertInto('batch').values(PRODUCTS.flatMap((p) => p.batches.map((b) => ({
      id: batchIds.get(b)!, orgId, productId: productIds.get(p.alias)!,
      // C-3: a batch is a lot or a serial, and SERIAL products track the serial.
      ...(p.trackingMode === 'SERIAL'
        ? { serial: `${b}-${tail(batchIds.get(b)!)}` }
        : { lotCode: `${b}-${tail(batchIds.get(b)!)}` }),
    })))).execute();
    await db.insertInto('node').values(NODES.map((n) => {
      const code = `${n.alias}-${tail(nodeIds.get(n.alias)!)}`;
      return { id: nodeIds.get(n.alias)!, orgId, kind: n.kind, code, name: n.alias, path: code };
    })).execute();
  });

  const lookup = <T extends string>(m: Map<string, string>, what: string) => (alias: string): T => {
    const id = m.get(alias);
    if (id === undefined) throw new Error(`unknown ${what}: ${alias}`);
    return id as T;
  };

  return {
    orgId, userId, products: PRODUCTS, nodes: NODES,
    product: lookup<ProductId>(productIds, 'product'),
    batch: lookup<BatchId>(batchIds, 'batch'),
    node: lookup<NodeId>(nodeIds, 'node'),
  };
}

/**
 * The rejections the spec accepts as a *result*: an operation the system refused
 * is the system working, and must not break the property (F3.6).
 */
const EXPECTED_REJECTIONS: ReadonlySet<string> = new Set([
  'insufficient-stock', 'settles-exceeded', 'serial-already-placed', 'already-reversed',
]);

export type Outcome =
  | { readonly ok: true; readonly ref: number; readonly id: MovementId }
  | { readonly ok: false; readonly ref: number; readonly type: string };

/**
 * One operation, in its own SAVEPOINT (decision D-42).
 *
 * `RecordMovement` appends the entry *before* it touches the balances, and the
 * savepoint inside `applyDelta` wraps only the upserts. Without this one, an
 * `insufficient-stock` would leave the `movement` row behind in the run's
 * transaction and I-5 would fail on the first rejection — blaming the product
 * for a defect it does not have. In production the request boundary undoes the
 * whole thing; this *is* that boundary.
 */
async function attempt<T>(
  uow: KyselyUnitOfWork,
  fn: () => Promise<T>,
): Promise<{ ok: true; value: T } | { ok: false; type: string }> {
  try {
    return { ok: true, value: await uow.run(fn) };
  } catch (e) {
    if (e instanceof DomainError && EXPECTED_REJECTIONS.has(e.type)) return { ok: false, type: e.type };
    // Anything else — a 23514, a 25P02, a 500 — is the property failing, not a result.
    throw e;
  }
}

const DAY = 86_400_000;

/**
 * Runs a planned sequence against the real use cases, resolving the generator's
 * aliases and ordinals into the uuids the writes actually produced.
 */
export async function applySequence(
  h: InvariantHarness,
  w: InvariantWorld,
  ops: readonly PlannedOp[],
): Promise<Outcome[]> {
  const ctx: RequestContext = {
    orgId: w.orgId,
    userId: w.userId,
    // OWNER and not OPERATOR: only OWNER and ADMIN may reverse.
    roles: new Set([Role.OWNER]),
    traceId: v7() as TraceId,
  };
  const written = new Map<number, MovementId>();
  const out: Outcome[] = [];

  for (const op of ops) {
    const res = await attempt(h.uow, async (): Promise<MovementId | null> => {
      if (op.kind === 'reverse') {
        const target = written.get(op.targetRef);
        // The original was rejected, so there is nothing to compensate.
        if (target === undefined) return null;
        const { reversal } = await h.reverse.execute(ctx, { movementId: target, reason: op.reason });
        return reversal.id;
      }
      const settlesId = op.settlesRef === undefined ? undefined : written.get(op.settlesRef);
      if (op.settlesRef !== undefined && settlesId === undefined) return null;
      const { movement } = await h.record.execute(ctx, {
        productId: w.product(op.product),
        ...(op.batch !== undefined ? { batchId: w.batch(op.batch) } : {}),
        fromNodeId: w.node(op.from),
        toNodeId: w.node(op.to),
        quantity: op.quantity,
        // I-14 is measured against the system clock, so the instant is computed
        // here and never generated: a value generated once and replayed through
        // a shrink could drift across the five-minute tolerance.
        occurredAt: new Date(Date.now() - 1_000),
        ...(op.dueAt === true ? { dueAt: new Date(Date.now() + 7 * DAY) } : {}),
        ...(settlesId !== undefined ? { settlesId } : {}),
      });
      return movement.id;
    });

    if (res.ok) {
      if (res.value !== null) {
        written.set(op.ref, res.value);
        out.push({ ok: true, ref: op.ref, id: res.value });
      }
    } else {
      out.push({ ok: false, ref: op.ref, type: res.type });
    }
  }
  return out;
}

/**
 * The shared fast-check parameters.
 *
 * The `seed` is **not** pinned here (D-44): that would turn the suite into fifty
 * fixed examples, which is the opposite of what it exists for. When a run fails,
 * fast-check prints `Seed: N, Path: p`; `FC_SEED=N FC_PATH=p` replays it exactly,
 * and that pair is what goes in the report.
 */
export const fcParams = (over: { readonly numRuns?: number } = {}): fc.Parameters<unknown> => ({
  // A property whose interesting states are rarer needs more cases, and says so
  // at the call site. The environment still wins, so a long run is one variable.
  numRuns: Number(process.env.FC_NUM_RUNS ?? over.numRuns ?? 50),
  ...(process.env.FC_SEED !== undefined ? { seed: Number(process.env.FC_SEED) } : {}),
  ...(process.env.FC_PATH !== undefined ? { path: process.env.FC_PATH } : {}),
  // Shrinking is the whole value of the technique: without it a counterexample
  // is twelve operations, with it it is two. Each step costs a transaction, so
  // FC_NO_SHRINK stays as the emergency exit.
  endOnFailure: process.env.FC_NO_SHRINK === '1',
  verbose: process.env.FC_VERBOSE === '1' ? fc.VerbosityLevel.Verbose : fc.VerbosityLevel.None,
  // A pathological run must not eat the vitest timeout in silence.
  interruptAfterTimeLimit: 100_000,
  markInterruptAsFailure: false,
});
