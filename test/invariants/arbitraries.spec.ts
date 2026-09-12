// Lo que se le exige al generador. Un generador con un fallo produce propiedades
// verdes que no prueban nada: si degradara siempre a `receive`, las cuatro
// suites de F3.6 pasarían sin haber trasladado, prestado ni compensado una sola
// vez. Esta es la única red que hay debajo, y no necesita Postgres.
import fc from 'fast-check';
import {
  arbitraryMovementSequence,
  type NodeShape, type PlannedMove, type PlannedOp, type ProductShape,
} from './arbitraries.js';

const PRODUCTS: readonly ProductShape[] = [
  { alias: 'QTY-A', trackingMode: 'QUANTITY', batches: [] },
  { alias: 'QTY-B', trackingMode: 'QUANTITY', batches: [] },
  { alias: 'LOT-A', trackingMode: 'LOT', batches: ['LOT-A/1', 'LOT-A/2'] },
  { alias: 'SER-A', trackingMode: 'SERIAL', batches: ['SER-A/1', 'SER-A/2', 'SER-A/3'] },
];
const NODES: readonly NodeShape[] = [
  { alias: 'BIN-1', kind: 'INTERNAL' }, { alias: 'BIN-2', kind: 'INTERNAL' }, { alias: 'BIN-3', kind: 'INTERNAL' },
  { alias: 'CUS-1', kind: 'CUSTODY' }, { alias: 'CUS-2', kind: 'CUSTODY' },
  { alias: 'TRM-1', kind: 'TERMINAL' }, { alias: 'TRM-2', kind: 'TERMINAL' },
  { alias: 'SRC-1', kind: 'SOURCE' }, { alias: 'SRC-2', kind: 'SOURCE' },
];

const sequences = arbitraryMovementSequence({ products: PRODUCTS, nodes: NODES, maxLen: 12 });
const kindOf = (alias: string) => NODES.find((n) => n.alias === alias)!.kind;
const productOf = (alias: string) => PRODUCTS.find((p) => p.alias === alias)!;
const isMove = (op: PlannedOp): op is PlannedMove => op.kind !== 'reverse';
const milli = (q: string) => Math.round(Number(q) * 1000);

/** Corre la secuencia contra un modelo escrito aquí, aparte del de `plan()`. */
function replay(ops: readonly PlannedOp[]) {
  const balance = new Map<string, number>();
  const key = (n: string, p: string, b?: string) => `${n}|${p}|${b ?? ''}`;
  const written = new Map<number, PlannedMove>();
  const problems: string[] = [];

  for (const op of ops) {
    if (op.kind === 'reverse') {
      const target = written.get(op.targetRef);
      if (!target) { problems.push(`reverse ${op.ref} → ${op.targetRef}, que no existe`); continue; }
      const to = key(target.to, target.product, target.batch);
      const from = key(target.from, target.product, target.batch);
      const q = milli(target.quantity);
      if (kindOf(target.to) !== 'SOURCE' && kindOf(target.to) !== 'TERMINAL' && (balance.get(to) ?? 0) < q) {
        problems.push(`compensar ${op.targetRef} dejaría ${target.to} en negativo`);
      }
      balance.set(to, (balance.get(to) ?? 0) - q);
      balance.set(from, (balance.get(from) ?? 0) + q);
      continue;
    }
    const q = milli(op.quantity);
    const from = key(op.from, op.product, op.batch);
    if (op.kind === 'overdraw') {
      if ((balance.get(from) ?? 0) >= q) problems.push(`overdraw ${op.ref} no sobregira`);
      continue; // el sistema lo rechaza: el modelo no lo aplica
    }
    if (kindOf(op.from) !== 'SOURCE' && (balance.get(from) ?? 0) < q) {
      problems.push(`${op.kind} ${op.ref} mueve ${op.quantity} y solo hay ${(balance.get(from) ?? 0) / 1000}`);
    }
    balance.set(from, (balance.get(from) ?? 0) - q);
    balance.set(key(op.to, op.product, op.batch), (balance.get(key(op.to, op.product, op.batch)) ?? 0) + q);
    written.set(op.ref, op);
  }
  return problems;
}

describe('arbitraryMovementSequence', () => {
  it('siempre empieza recibiendo: sin existencias no hay nada que probar', () => {
    fc.assert(fc.property(sequences, (ops) => {
      expect(ops.length).toBeGreaterThan(0);
      expect(ops[0]!.kind).toBe('receive');
    }), { numRuns: 200 });
  });

  it('el ordinal de cada operación es su posición, y las referencias miran atrás', () => {
    fc.assert(fc.property(sequences, (ops) => {
      ops.forEach((op, i) => expect(op.ref).toBe(i));
      for (const op of ops) {
        if (op.kind === 'reverse') expect(op.targetRef).toBeLessThan(op.ref);
        else if (op.settlesRef !== undefined) expect(op.settlesRef).toBeLessThan(op.ref);
      }
    }), { numRuns: 200 });
  });

  it('cada devolución salda un préstamo anterior, al mismo sitio y por el mismo artículo', () => {
    fc.assert(fc.property(sequences, (ops) => {
      const byRef = new Map(ops.map((o) => [o.ref, o]));
      for (const op of ops) {
        if (op.kind !== 'checkIn') continue;
        expect(op.settlesRef).toBeDefined();
        const loan = byRef.get(op.settlesRef!);
        expect(loan).toBeDefined();
        expect(loan!.kind).toBe('checkOut');
        const l = loan as PlannedMove;
        expect(op.from).toBe(l.to);
        expect(op.product).toBe(l.product);
        expect(op.batch).toBe(l.batch);
      }
    }), { numRuns: 200 });
  });

  it('no compensa dos veces lo mismo, ni compensa una compensación', () => {
    fc.assert(fc.property(sequences, (ops) => {
      const targets = ops.filter((o) => o.kind === 'reverse').map((o) => o.targetRef);
      expect(new Set(targets).size).toBe(targets.length);
      const byRef = new Map(ops.map((o) => [o.ref, o]));
      for (const t of targets) expect(byRef.get(t)!.kind).not.toBe('reverse');
    }), { numRuns: 200 });
  });

  it('las reglas del asiento que el esquema comprueba con un CHECK', () => {
    fc.assert(fc.property(sequences, (ops) => {
      for (const op of ops.filter(isMove)) {
        expect(op.from).not.toBe(op.to);                       // I-1
        expect(milli(op.quantity)).toBeGreaterThan(0);          // I-2
        expect(op.quantity).toMatch(/^\d{1,15}\.\d{3}$/);
        const p = productOf(op.product);
        // I-8: el lote va si y solo si el producto se sigue por lote o serie
        expect(op.batch === undefined).toBe(p.trackingMode === 'QUANTITY');
        if (op.batch !== undefined) expect(p.batches).toContain(op.batch);
        // I-11: dueAt solo hacia una custodia
        if (op.dueAt === true) expect(kindOf(op.to)).toBe('CUSTODY');
        // I-17: salir de una custodia exige saldar
        if (kindOf(op.from) === 'CUSTODY') expect(op.settlesRef).toBeDefined();
        // Una serie es una unidad física: se mueve entera, y de una en una
        // salvo cuando el sobregiro pide de más justo para que lo rechacen.
        if (p.trackingMode === 'SERIAL') {
          expect(milli(op.quantity) % 1000).toBe(0);
          if (op.kind !== 'overdraw') expect(op.quantity).toBe('1.000');
        }
      }
    }), { numRuns: 200 });
  });

  it('nadie mueve lo que no hay, salvo el sobregiro, que es el punto', () => {
    fc.assert(fc.property(sequences, (ops) => {
      expect(replay(ops)).toEqual([]);
    }), { numRuns: 300 });
  });

  it('genera de verdad las seis operaciones, no solo recepciones', () => {
    const seen = new Set<string>();
    fc.assert(fc.property(sequences, (ops) => {
      for (const op of ops) seen.add(op.kind);
    }), { numRuns: 500 });
    expect([...seen].sort()).toEqual(
      ['checkIn', 'checkOut', 'dispatch', 'overdraw', 'receive', 'reverse', 'transfer'],
    );
  });
});
