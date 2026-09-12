/**
 * The vocabulary of a generated sequence, and the generator itself.
 *
 * Deliberately pure: no Nest, no Kysely, no uuids. Operations name the world by
 * **alias** (`'QTY-A'`, `'BIN-1'`), so a counterexample prints as something a
 * person can read, and so this file can be tested without Postgres.
 */

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
