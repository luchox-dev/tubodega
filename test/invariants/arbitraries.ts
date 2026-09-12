/**
 * The vocabulary of a generated sequence, and the generator itself.
 *
 * Deliberately pure: no Nest, no Kysely, no uuids. Operations name the world by
 * **alias** (`'QTY-A'`, `'BIN-1'`), so a counterexample prints as something a
 * person can read, and so this file can be tested without Postgres.
 */

import fc from 'fast-check';

export interface ProductShape {
  readonly alias: string;
  readonly trackingMode: 'QUANTITY' | 'LOT' | 'SERIAL';
  /** Batch aliases; empty for QUANTITY, which must carry no batch at all (I-8). */
  readonly batches: readonly string[];
}

export interface NodeShape {
  readonly alias: string;
  readonly kind: 'INTERNAL' | 'CUSTODY' | 'TERMINAL' | 'SOURCE';
}

export type MoveKind = 'receive' | 'transfer' | 'dispatch' | 'checkOut' | 'checkIn' | 'overdraw';

export interface PlannedMove {
  readonly kind: MoveKind;
  /** Ordinal of this operation, so later ones can point back at it. */
  readonly ref: number;
  readonly product: string;
  readonly batch?: string;
  readonly from: string;
  readonly to: string;
  /** Thousandths, as the `numeric(18,3)` column spells them. */
  readonly quantity: string;
  readonly dueAt?: true;
  readonly settlesRef?: number;
}

export interface PlannedReversal {
  readonly kind: 'reverse';
  readonly ref: number;
  readonly targetRef: number;
  readonly reason: string;
}

export type PlannedOp = PlannedMove | PlannedReversal;

// ─────────────────────────────────────────────────────────────────────────────

/**
 * What fast-check actually generates: small integers. `plan()` interprets them
 * against an in-memory model, which is why every shrink is still a valid
 * sequence — `plan` is total, so there is no such thing as an invalid
 * counterexample here (decision D-43). And fast-check prints the *mapped* value,
 * so what shows up in a failure report is the readable operation list.
 */
interface RawStep {
  readonly pick: number;
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly q: number;
}

/** Thousandths, so the model can never disagree with `numeric(18,3)`. */
const STEP = 250;
const SERIAL_UNIT = 1_000;

const fmt = (thousandths: number): string =>
  `${Math.trunc(thousandths / 1000)}.${String(thousandths % 1000).padStart(3, '0')}`;

const PREFERENCE: readonly (MoveKind | 'reverse')[] = [
  'receive', 'receive', 'receive', 'transfer', 'transfer', 'dispatch',
  'checkOut', 'checkOut', 'checkIn', 'checkIn', 'reverse', 'overdraw',
];

/**
 * Tried in order when the preferred operation is impossible in the current
 * state. It degrades rather than dropping the step, so the length of a sequence
 * stays stable under shrinking — and it ends in `receive`, which is always
 * possible, so every step produces exactly one operation and `ref` is the index.
 */
const FALLBACK: readonly (MoveKind | 'reverse')[] = [
  'transfer', 'dispatch', 'checkOut', 'checkIn', 'reverse', 'overdraw', 'receive',
];

interface Position { readonly node: string; readonly product: string; readonly batch?: string; qty: number }
interface Loan {
  readonly ref: number; readonly custody: string; readonly product: string;
  readonly batch?: string; readonly quantity: number; pending: number; reversed: boolean;
}

export function plan(
  raws: readonly RawStep[],
  products: readonly ProductShape[],
  nodes: readonly NodeShape[],
): readonly PlannedOp[] {
  const kindOf = new Map(nodes.map((n) => [n.alias, n.kind]));
  const productOf = new Map(products.map((p) => [p.alias, p]));
  const aliases = (kind: NodeShape['kind']) => nodes.filter((n) => n.kind === kind).map((n) => n.alias);
  const INTERNAL = aliases('INTERNAL');
  const CUSTODY = aliases('CUSTODY');
  const TERMINAL = aliases('TERMINAL');
  const SOURCE = aliases('SOURCE');

  const balance = new Map<string, Position>();
  const loans: Loan[] = [];
  const written = new Map<number, PlannedMove>();
  const reversed = new Set<number>();
  const placedSerials = new Set<string>();

  const key = (node: string, product: string, batch?: string) => `${node}|${product}|${batch ?? ''}`;
  const at = (node: string, product: string, batch?: string) => balance.get(key(node, product, batch))?.qty ?? 0;
  const custodial = (node: string) => kindOf.get(node) === 'INTERNAL' || kindOf.get(node) === 'CUSTODY';

  const move = (node: string, product: string, batch: string | undefined, delta: number) => {
    const k = key(node, product, batch);
    const found = balance.get(k);
    if (found === undefined) balance.set(k, { node, product, batch, qty: delta });
    else found.qty += delta;
  };

  const pick = <T>(xs: readonly T[], n: number): T | undefined =>
    xs.length === 0 ? undefined : xs[n % xs.length];

  const held = (kind: NodeShape['kind']) =>
    [...balance.values()].filter((p) => kindOf.get(p.node) === kind && p.qty > 0);

  /** An item that can still enter the building: a serial already placed cannot. */
  const receivable = (a: number, b: number): { product: string; batch?: string } | undefined => {
    const p = pick(products, a);
    if (p === undefined) return undefined;
    if (p.trackingMode === 'SERIAL') {
      const free = p.batches.filter((x) => !placedSerials.has(x));
      const batch = pick(free, b);
      if (batch !== undefined) return { product: p.alias, batch };
      // Every serial is out there already; fall back to something countable.
      const byQuantity = products.find((x) => x.trackingMode === 'QUANTITY');
      return byQuantity === undefined ? undefined : { product: byQuantity.alias };
    }
    if (p.trackingMode === 'LOT') {
      const batch = pick(p.batches, b);
      return batch === undefined ? undefined : { product: p.alias, batch };
    }
    return { product: p.alias };
  };

  const isSerial = (product: string) => productOf.get(product)?.trackingMode === 'SERIAL';

  /** How much of a position to move: a serial is one physical unit, never a part of one. */
  const amount = (product: string, available: number, q: number): number | undefined => {
    if (isSerial(product)) return available >= SERIAL_UNIT ? SERIAL_UNIT : undefined;
    const want = Math.min(q * STEP, available);
    return want > 0 ? want : undefined;
  };

  const out: PlannedOp[] = [];

  const build = (kind: MoveKind | 'reverse', ref: number, s: RawStep): PlannedOp | undefined => {
    switch (kind) {
      case 'receive': {
        const item = receivable(s.a, s.b);
        const from = pick(SOURCE, s.b);
        const to = pick(INTERNAL, s.c);
        if (item === undefined || from === undefined || to === undefined) return undefined;
        const qty = isSerial(item.product) ? SERIAL_UNIT : s.q * STEP;
        return { kind, ref, ...item, from, to, quantity: fmt(qty) };
      }
      case 'transfer':
      case 'dispatch':
      case 'checkOut': {
        const p = pick(held('INTERNAL'), s.a);
        if (p === undefined) return undefined;
        const targets = kind === 'transfer' ? INTERNAL.filter((n) => n !== p.node)
          : kind === 'dispatch' ? TERMINAL : CUSTODY;
        const to = pick(targets, s.b);
        const qty = amount(p.product, p.qty, s.q);
        if (to === undefined || qty === undefined) return undefined;
        return {
          kind, ref, product: p.product, ...(p.batch !== undefined ? { batch: p.batch } : {}),
          from: p.node, to, quantity: fmt(qty),
          ...(kind === 'checkOut' ? { dueAt: true as const } : {}),
        };
      }
      case 'overdraw': {
        const p = pick(held('INTERNAL'), s.a);
        const to = pick(TERMINAL, s.b);
        if (p === undefined || to === undefined) return undefined;
        // Strictly more than there is, so the rejection is the point of the
        // step. A serial overdraws by whole units: half a serial is not a thing.
        const over = isSerial(p.product) ? SERIAL_UNIT : s.q * STEP;
        return {
          kind, ref, product: p.product, ...(p.batch !== undefined ? { batch: p.batch } : {}),
          from: p.node, to, quantity: fmt(p.qty + over),
        };
      }
      case 'checkIn': {
        const open = loans.filter((l) => !l.reversed && l.pending > 0
          && at(l.custody, l.product, l.batch) > 0);
        const loan = pick(open, s.a);
        const to = pick(INTERNAL, s.b);
        if (loan === undefined || to === undefined) return undefined;
        // Two ceilings, and both are needed: the pending is I-18, the balance is I-4.
        const qty = amount(loan.product, Math.min(loan.pending, at(loan.custody, loan.product, loan.batch)), s.q);
        if (qty === undefined) return undefined;
        return {
          kind, ref, product: loan.product, ...(loan.batch !== undefined ? { batch: loan.batch } : {}),
          from: loan.custody, to, quantity: fmt(qty), settlesRef: loan.ref,
        };
      }
      case 'reverse': {
        const candidates = [...written.values()].filter((m) => {
          if (reversed.has(m.ref)) return false;
          // The compensation takes the goods back out of the destination, so it
          // only works while they are still there (I-4 has no mercy on this).
          const q = Math.round(Number(m.quantity) * 1000);
          return !custodial(m.to) || at(m.to, m.product, m.batch) >= q;
        });
        const target = pick(candidates, s.a);
        if (target === undefined) return undefined;
        return { kind, ref, targetRef: target.ref, reason: `corrección de ${target.kind}` };
      }
    }
  };

  const apply = (op: PlannedOp): void => {
    if (op.kind === 'reverse') {
      const target = written.get(op.targetRef)!;
      const q = Math.round(Number(target.quantity) * 1000);
      move(target.to, target.product, target.batch, -q);
      move(target.from, target.product, target.batch, q);
      reversed.add(op.targetRef);
      if (target.kind === 'checkOut') {
        // A reversed loan stops being an open custody: `openCustodies` excludes it.
        const loan = loans.find((l) => l.ref === target.ref);
        if (loan !== undefined) loan.reversed = true;
      }
      if (target.kind === 'checkIn' && target.settlesRef !== undefined) {
        // The goods never really came back, so the loan goes back up.
        const loan = loans.find((l) => l.ref === target.settlesRef);
        if (loan !== undefined) loan.pending += q;
      }
      return;
    }
    // An overdraw is refused: the model must not pretend it happened.
    if (op.kind === 'overdraw') return;

    const q = Math.round(Number(op.quantity) * 1000);
    move(op.from, op.product, op.batch, -q);
    move(op.to, op.product, op.batch, q);
    written.set(op.ref, op);
    if (op.kind === 'receive' && op.batch !== undefined && isSerial(op.product)) placedSerials.add(op.batch);
    if (op.kind === 'checkOut') {
      loans.push({
        ref: op.ref, custody: op.to, product: op.product,
        ...(op.batch !== undefined ? { batch: op.batch } : {}),
        quantity: q, pending: q, reversed: false,
      });
    }
    if (op.kind === 'checkIn' && op.settlesRef !== undefined) {
      const loan = loans.find((l) => l.ref === op.settlesRef);
      if (loan !== undefined) loan.pending -= q;
    }
  };

  raws.forEach((s, ref) => {
    // The first operation is always a reception. With nothing on any shelf,
    // three quarters of every run would be rejections and the property would be
    // proving itself against an empty warehouse.
    const preferred = ref === 0 ? 'receive' : (pick(PREFERENCE, s.pick) ?? 'receive');
    for (const kind of [preferred, ...FALLBACK]) {
      const op = build(kind, ref, s);
      if (op === undefined) continue;
      apply(op);
      out.push(op);
      return;
    }
  });

  return out;
}

const rawStep = fc.record({
  pick: fc.integer({ min: 0, max: PREFERENCE.length - 1 }),
  a: fc.nat({ max: 15 }),
  b: fc.nat({ max: 15 }),
  c: fc.nat({ max: 15 }),
  q: fc.integer({ min: 1, max: 40 }),
});

export function arbitraryMovementSequence(o: {
  readonly products: readonly ProductShape[];
  readonly nodes: readonly NodeShape[];
  readonly maxLen?: number;
}): fc.Arbitrary<readonly PlannedOp[]> {
  return fc
    .array(rawStep, { minLength: 1, maxLength: o.maxLen ?? 12 })
    .map((raws) => plan(raws, o.products, o.nodes));
}
