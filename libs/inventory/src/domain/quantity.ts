import { err, ok, type Result } from '@app/common';
import { InvalidQuantityError, NonPositiveQuantityError } from './errors.js';

/** Thousandths per unit. The scale of numeric(18,3) in the schema (spec 04 §3.5). */
const SCALE = 1000n;
const DECIMALS = 3;

// Up to 15 integer digits and at most 3 decimals, optionally signed. The 15
// comes from numeric(18,3): eighteen digits of precision, three of them spent
// on the fraction. Anything wider would be truncated by the column in silence.
const DECIMAL_RE = /^-?\d{1,15}(?:\.\d{1,3})?$/;

const parse = (value: string): bigint => {
  const negative = value.startsWith('-');
  const [whole, fraction = ''] = (negative ? value.slice(1) : value).split('.');
  const milli = BigInt(whole!) * SCALE + BigInt(fraction.padEnd(DECIMALS, '0'));
  return negative ? -milli : milli;
};

/**
 * An amount of stock, held as an integer of thousandths.
 *
 * Not a `number`: adding 0.1 three times in floating point does not give 0.3,
 * and in a ledger that error accumulates entry by entry until the materialised
 * balance stops matching the history. The integer is exact by construction and
 * matches the numeric(18,3) of the schema, which `pg` hands back as a *string*
 * for the same reason.
 */
export class Quantity {
  private constructor(private readonly milli: bigint) {}

  /**
   * Reads what a person wrote, so it refuses zero and the negative (I-2): an
   * amount is written in positive, and the direction of a movement lives in its
   * pair of nodes. The algebra below does produce negatives — see `minus` —
   * which is why `isPositive()` exists at all (decision D-32).
   */
  static of(value: string): Result<Quantity, InvalidQuantityError | NonPositiveQuantityError> {
    const raw = value.trim();
    if (!DECIMAL_RE.test(raw)) return err(new InvalidQuantityError(value));
    const milli = parse(raw);
    return milli > 0n ? ok(new Quantity(milli)) : err(new NonPositiveQuantityError(value));
  }

  /**
   * A balance coming back from its column, which *can* be negative: a SOURCE or
   * a TERMINAL node is the boundary of the system and its running total has no
   * floor (I-4). Trusts the database, like every other `rehydrate` of the house.
   */
  static rehydrate(value: string): Quantity {
    return new Quantity(parse(value.trim()));
  }

  static zero(): Quantity {
    return new Quantity(0n);
  }

  plus(other: Quantity): Quantity {
    return new Quantity(this.milli + other.milli);
  }

  minus(other: Quantity): Quantity {
    return new Quantity(this.milli - other.milli);
  }

  /** The other side of a double entry: what leaves the origin is what enters the destination. */
  negated(): Quantity {
    return new Quantity(-this.milli);
  }

  isPositive(): boolean {
    return this.milli > 0n;
  }

  isNegative(): boolean {
    return this.milli < 0n;
  }

  isZero(): boolean {
    return this.milli === 0n;
  }

  compare(other: Quantity): -1 | 0 | 1 {
    if (this.milli < other.milli) return -1;
    return this.milli > other.milli ? 1 : 0;
  }

  /** Always three decimals: it is what goes into the column and out to the client. */
  toString(): string {
    const negative = this.milli < 0n;
    const abs = negative ? -this.milli : this.milli;
    const fraction = (abs % SCALE).toString().padStart(DECIMALS, '0');
    return `${negative ? '-' : ''}${abs / SCALE}.${fraction}`;
  }
}
