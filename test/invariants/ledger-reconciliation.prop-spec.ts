// I-5 · El saldo materializado es una caché del ledger, y una caché que se
// desvía del hecho que resume es peor que no tenerla: el despacho, las alertas
// y el cierre leen `stock_balance` y nadie vuelve a sumar la historia.
//
// Un ejemplo escrito a mano prueba el caso que a alguien se le ocurrió. Aquí lo
// prueba la secuencia de siete pasos que nadie imaginó (spec 06 §7).
import fc from 'fast-check';
import { withRollback } from '../support/db.js';
import { arbitraryMovementSequence } from './arbitraries.js';
import { ledgerMismatches } from './checks.js';
import {
  applySequence, createInvariantHarness, fcParams, seedInvariantWorld, shapeOf,
  type InvariantHarness, type InvariantWorld,
} from './harness.js';

describe('propiedad · I-5 · el saldo materializado cuadra con el ledger', () => {
  let h: InvariantHarness;
  let w: InvariantWorld;

  beforeAll(async () => {
    h = await createInvariantHarness();
    // El mundo se commitea. Si viviera dentro del rollback de la corrida, la
    // primera secuencia no tendría ni productos ni nodos que mover.
    w = await seedInvariantWorld(h, 'i5');
  }, 60_000);
  afterAll(() => h.close());

  it('tras cualquier secuencia válida, sumar el ledger por posición da el saldo', async () => {
    await fc.assert(
      fc.asyncProperty(arbitraryMovementSequence({ ...shapeOf(w), maxLen: 12 }), async (ops) => {
        // Una transacción por corrida, deshecha al terminar: cada secuencia
        // arranca con el ledger vacío y el saldo en cero. Sin esto la propiedad
        // sería «tras la concatenación de cincuenta secuencias», que no es la
        // que enuncia la spec.
        await withRollback(h.uow, { pool: 'tenant', orgId: w.orgId }, async () => {
          const outcomes = await applySequence(h, w, ops);

          // Que algo se haya escrito de verdad: una secuencia entera rechazada
          // probaría la propiedad sobre la nada.
          expect(outcomes.some((o) => o.ok)).toBe(true);

          // Vacío es que cuadra. Cuando no, cada fila dice nodo, producto, lote,
          // lo que suma la historia y lo que dice el saldo.
          expect(await ledgerMismatches(h.ctx.current(), w.orgId)).toEqual([]);
        });
      }),
      fcParams(),
    );
  }, 120_000);
});
