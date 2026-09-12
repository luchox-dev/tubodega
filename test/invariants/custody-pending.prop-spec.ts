// I-18 · Lo que queda pendiente de un préstamo está entre cero y lo que se
// prestó, después de cualquier secuencia de devoluciones parciales y
// compensaciones. Ni se devuelve de más, ni una compensación hace desaparecer
// una deuda que sigue viva (spec 06 §7).
//
// Y se cruza contra `settledQuantity`, que es el método con el que
// `RecordMovement` decide `settles-exceeded`: si la consulta y él discrepan, el
// invariante se sostiene y el producto acepta una devolución que no debía.
import fc from 'fast-check';
import { withRollback } from '../support/db.js';
import { arbitraryMovementSequence } from './arbitraries.js';
import { custodyPending, custodyPendingBreaches } from './checks.js';
import {
  applySequence, createInvariantHarness, fcParams, seedInvariantWorld, shapeOf,
  type InvariantHarness, type InvariantWorld,
} from './harness.js';
import type { MovementId } from '@app/inventory';

describe('propiedad · I-18 · el pendiente de un préstamo nunca se sale de rango', () => {
  let h: InvariantHarness;
  let w: InvariantWorld;

  beforeAll(async () => {
    h = await createInvariantHarness();
    w = await seedInvariantWorld(h, 'i18');
  }, 60_000);
  afterAll(() => h.close());

  it('el pendiente se queda entre cero y lo prestado, y el puerto lo confirma', async () => {
    await fc.assert(
      fc.asyncProperty(arbitraryMovementSequence({ ...shapeOf(w), maxLen: 12 }), async (ops) => {
        await withRollback(h.uow, { pool: 'tenant', orgId: w.orgId }, async () => {
          const outcomes = await applySequence(h, w, ops);
          expect(outcomes.some((o) => o.ok)).toBe(true);

          expect(await custodyPendingBreaches(h.ctx.current(), w.orgId)).toEqual([]);

          for (const loan of await custodyPending(h.ctx.current(), w.orgId)) {
            const saldado = await h.movements.settledQuantity(w.orgId, loan.id as MovementId);
            expect(saldado.toString()).toBe((Number(loan.quantity) - Number(loan.pending)).toFixed(3));
          }
        });
      }),
      fcParams(),
    );
  }, 120_000);
});
