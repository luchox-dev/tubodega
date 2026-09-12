// Conservación · La mercancía no se crea ni se destruye: solo cambia de sitio.
// Lo que salió por los nodos TERMINAL, más lo que está en las estanterías
// propias, menos lo que entró por los nodos SOURCE, suma cero — producto a
// producto y lote a lote, después de cualquier secuencia (spec 06 §7).
//
// Es una afirmación sobre el sistema entero, no sobre una operación: por eso se
// mide sobre `stock_balance`, que es la tabla que el resto del sistema consulta.
import fc from 'fast-check';
import { withRollback } from '../support/db.js';
import { arbitraryMovementSequence } from './arbitraries.js';
import { conservationBreaches } from './checks.js';
import {
  applySequence, createInvariantHarness, fcParams, seedInvariantWorld, shapeOf,
  type InvariantHarness, type InvariantWorld,
} from './harness.js';

describe('propiedad · conservación · la partida doble cierra en cero', () => {
  let h: InvariantHarness;
  let w: InvariantWorld;

  beforeAll(async () => {
    h = await createInvariantHarness();
    w = await seedInvariantWorld(h, 'conservacion');
  }, 60_000);
  afterAll(() => h.close());

  it('la frontera y el inventario propio se cancelan, producto a producto', async () => {
    await fc.assert(
      fc.asyncProperty(arbitraryMovementSequence({ ...shapeOf(w), maxLen: 12 }), async (ops) => {
        await withRollback(h.uow, { pool: 'tenant', orgId: w.orgId }, async () => {
          const outcomes = await applySequence(h, w, ops);
          expect(outcomes.some((o) => o.ok)).toBe(true);
          // Cada fila que sobreviva al HAVING trae los tres sumandos por
          // separado, para que se vea cuál de los tres se desvió.
          expect(await conservationBreaches(h.ctx.current(), w.orgId)).toEqual([]);
        });
      }),
      fcParams(),
    );
  }, 120_000);
});
