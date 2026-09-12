import { unwrap } from '@app/common';
import { Quantity } from './quantity.js';

const q = (raw: string): Quantity => unwrap(Quantity.of(raw));

describe('Quantity.of', () => {
  it.each([
    ['12.500', '12.500'],
    ['0.1', '0.100'],
    ['12', '12.000'],
    ['0.001', '0.001'],
    ['1.10', '1.100'],
  ])('lee «%s» y lo guarda como %s', (raw, shown) => {
    expect(q(raw).toString()).toBe(shown);
  });

  it('recorta los espacios de los extremos', () => {
    expect(q(' 1 ').toString()).toBe('1.000');
  });

  // The quantity of a movement is strictly positive (I-2). A negative is not a
  // small amount, it is a direction, and the direction lives in the pair of
  // nodes, not in the number.
  it.each(['-1', '-0.001', '0', '0.000'])('rechaza «%s»: una cantidad se escribe en positivo', (raw) => {
    const r = Quantity.of(raw);
    expect(!r.ok && r.error.type).toBe('non-positive-quantity');
  });

  // More than three decimals is not a rounding matter: numeric(18,3) would
  // truncate it in silence, and the ledger would stop matching what was typed.
  it.each(['1.2345', '0.0001'])('rechaza «%s» por pasarse de milésimas', (raw) => {
    expect(Quantity.of(raw).ok).toBe(false);
  });

  it.each(['abc', '', '   ', '1e3', '1,5', '1.2.3', '+1', '1 000', 'Infinity', 'NaN'])(
    'rechaza «%s» porque no es un decimal',
    (raw) => {
      expect(Quantity.of(raw).ok).toBe(false);
    },
  );

  it('admite hasta 15 enteros y rechaza el decimosexto', () => {
    expect(Quantity.of('9'.repeat(15)).ok).toBe(true);
    expect(Quantity.of('9'.repeat(16)).ok).toBe(false);
  });

  it('el error apunta a /quantity', () => {
    const r = Quantity.of('-1');
    expect(!r.ok && r.error.errors?.[0]?.pointer).toBe('/quantity');
  });
});

describe('la aritmética es exacta', () => {
  // The reason the class exists. With floats, adding 0.1 a thousand times gives
  // 99.9999999999986, and in a ledger that drift accumulates entry by entry
  // until the materialised balance stops matching the history.
  it('acumular 0.1 mil veces da exactamente 100.000', () => {
    let total = Quantity.zero();
    for (let i = 0; i < 1000; i += 1) total = total.plus(q('0.1'));
    expect(total.toString()).toBe('100.000');
  });

  it('suma y resta', () => {
    expect(q('12.500').plus(q('0.5')).toString()).toBe('13.000');
    expect(q('12.500').minus(q('0.5')).toString()).toBe('12.000');
  });

  it('no muta a ninguno de los dos operandos', () => {
    const a = q('10');
    const b = q('3');
    a.plus(b);
    a.minus(b);
    expect(a.toString()).toBe('10.000');
    expect(b.toString()).toBe('3.000');
  });
});

// D-32: `of` refuses a negative because it parses what a person wrote; the
// algebra does not, because a sign is what double-entry produces. That is why
// `isPositive` is in the contract at all.
describe('el signo lo produce el álgebra, no el parseo', () => {
  it('restar de menos deja una cantidad negativa', () => {
    const d = q('3').minus(q('10'));
    expect(d.toString()).toBe('-7.000');
    expect(d.isNegative()).toBe(true);
    expect(d.isPositive()).toBe(false);
  });

  it('negated() invierte el signo y es su propio inverso', () => {
    expect(q('7.250').negated().toString()).toBe('-7.250');
    expect(q('7.250').negated().negated().toString()).toBe('7.250');
    expect(Quantity.zero().negated().toString()).toBe('0.000');
  });

  it('el cero no es ni positivo ni negativo', () => {
    const z = Quantity.zero();
    expect(z.isZero()).toBe(true);
    expect(z.isPositive()).toBe(false);
    expect(z.isNegative()).toBe(false);
    expect(z.toString()).toBe('0.000');
  });

  it('una cantidad recién leída es positiva y no es cero', () => {
    expect(q('0.001').isPositive()).toBe(true);
    expect(q('0.001').isZero()).toBe(false);
  });
});

describe('compare', () => {
  it('ordena en los tres sentidos', () => {
    expect(q('1').compare(q('2'))).toBe(-1);
    expect(q('2').compare(q('1'))).toBe(1);
    expect(q('2').compare(q('2'))).toBe(0);
  });

  it('compara bien a través del cero', () => {
    const menos = q('1').minus(q('5'));
    expect(menos.compare(Quantity.zero())).toBe(-1);
    expect(Quantity.zero().compare(menos)).toBe(1);
  });

  // 0.1 + 0.2 !== 0.3 in floating point. Here it is, and that is the point.
  it('0.1 más 0.2 es exactamente 0.3', () => {
    expect(q('0.1').plus(q('0.2')).compare(q('0.3'))).toBe(0);
  });
});

describe('toString', () => {
  it('siempre lleva tres decimales, también en los negativos y bajo el uno', () => {
    expect(q('5').toString()).toBe('5.000');
    expect(q('0.05').toString()).toBe('0.050');
    expect(q('0.005').negated().toString()).toBe('-0.005');
  });

  it('aguanta quince enteros sin notación científica', () => {
    expect(q('999999999999999').toString()).toBe('999999999999999.000');
  });
});

// A SOURCE or a TERMINAL is the boundary of the system and its running total
// has no floor (I-4), so the column can hand back a negative that `of` would
// refuse. Same shape as Node.rehydrate: it trusts the row.
describe('Quantity.rehydrate', () => {
  it('acepta el saldo negativo de un nodo de frontera', () => {
    expect(Quantity.rehydrate('-1500.000').toString()).toBe('-1500.000');
  });

  it('lee el cero y el positivo que devuelve la columna', () => {
    expect(Quantity.rehydrate('0.000').isZero()).toBe(true);
    expect(Quantity.rehydrate('87.500').toString()).toBe('87.500');
  });
});
