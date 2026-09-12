// I-9 · Una serie es un objeto físico: no puede estar en dos estanterías a la
// vez. La comprobación va por partida doble —la consulta sobre los saldos, y el
// `custodialTotal` que es quien decide `serial-already-placed` en producción—,
// porque un invariante que se sostiene mientras el método que lo implementa mide
// otra cosa es un invariante que no protege nada (spec 06 §7).
import fc from 'fast-check';
import { withRollback } from '../support/db.js';
import { arbitraryMovementSequence } from './arbitraries.js';
import { serialCustodialTotals, serialsInTwoPlaces } from './checks.js';
import {
  applySequence, createInvariantHarness, fcParams, seedInvariantWorld, serialHeavyShape,
  type InvariantHarness, type InvariantWorld,
} from './harness.js';
import type { BatchId } from '@app/catalog';

describe('propiedad · I-9 · una serie no está en dos sitios a la vez', () => {
  let h: InvariantHarness;
  let w: InvariantWorld;

  beforeAll(async () => {
    h = await createInvariantHarness();
    w = await seedInvariantWorld(h, 'i9');
  }, 60_000);
  afterAll(() => h.close());

  it('ninguna serie aparece en dos nodos custodiables, y el puerto dice lo mismo', async () => {
    await fc.assert(
      fc.asyncProperty(arbitraryMovementSequence({ ...serialHeavyShape(w), maxLen: 12 }), async (ops) => {
        await withRollback(h.uow, { pool: 'tenant', orgId: w.orgId }, async () => {
          const outcomes = await applySequence(h, w, ops);
          expect(outcomes.some((o) => o.ok)).toBe(true);

          expect(await serialsInTwoPlaces(h.ctx.current(), w.orgId)).toEqual([]);

          // El cruce: el método que guarda I-9 en producción tiene que ver lo
          // mismo que la consulta, y nunca más de una unidad.
          for (const row of await serialCustodialTotals(h.ctx.current(), w.orgId)) {
            const puerto = await h.balances.custodialTotal(w.orgId, row.batchId as BatchId);
            expect(puerto.toString()).toBe(Number(row.total).toFixed(3));
            expect(Number(row.total)).toBeLessThanOrEqual(1);
          }
        });
      }),
      // Más corridas que las otras tres: la secuencia que de verdad pone a
      // prueba I-9 —sale vendida, vuelve a entrar, y alguien deshace la venta—
      // aparece en dos de cada mil, así que cincuenta no la verían nunca.
      fcParams({ numRuns: 1500 }),
    );
  }, 150_000);
});
