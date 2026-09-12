// El testigo, escrito a mano, de lo que encontró la generación.
//
// Una serie sale vendida, vuelve del proveedor a otra estantería —lo cual es
// legítimo: el sistema no puede saber que es la misma pieza hasta que la ve— y
// entonces alguien compensa la venta. La compensación devuelve la serie a la
// estantería de la que salió, y ahora la misma pieza está en dos sitios: I-9,
// roto, sin que ninguna operación por separado haya hecho nada raro.
//
// Vive junto al harness de las propiedades porque necesita los casos de uso
// reales cableados contra Postgres, que es lo que ese harness monta.
import { v7 } from 'uuid';
import { DomainError, type TraceId } from '@app/common';
import { Role, type RequestContext } from '@app/tenancy';
import type { MovementId } from '@app/inventory';
import { withRollback } from '../support/db.js';
import { serialsInTwoPlaces } from './checks.js';
import {
  createInvariantHarness, seedInvariantWorld,
  type InvariantHarness, type InvariantWorld,
} from './harness.js';

describe('I-9 · la serie que vuelve y la venta que se compensa', () => {
  let h: InvariantHarness;
  let w: InvariantWorld;
  let ctx: RequestContext;

  beforeAll(async () => {
    h = await createInvariantHarness();
    w = await seedInvariantWorld(h, 'serie');
    ctx = { orgId: w.orgId, userId: w.userId, roles: new Set([Role.OWNER]), traceId: v7() as TraceId };
  }, 60_000);
  afterAll(() => h.close());

  const mover = (from: string, to: string) =>
    h.record.execute(ctx, {
      productId: w.product('SER-A'),
      batchId: w.batch('SER-A/1'),
      fromNodeId: w.node(from),
      toNodeId: w.node(to),
      quantity: '1.000',
      occurredAt: new Date(Date.now() - 1_000),
    });

  it('compensar la venta no puede poner la serie en dos estanterías', async () => {
    await withRollback(h.uow, { pool: 'tenant', orgId: w.orgId }, async () => {
      // 1 · llega la pieza y se guarda
      await mover('SRC-1', 'BIN-1');
      // 2 · se vende
      const venta = await mover('BIN-1', 'TRM-1');
      // 3 · el proveedor manda otra unidad con la misma serie, a otra estantería.
      //     El sistema lo acepta, y hace bien: en custodia no hay ninguna.
      await mover('SRC-1', 'BIN-2');

      // 4 · y ahora alguien deshace la venta. Aquí es donde se rompe I-9.
      const fallo = await h.reverse
        .execute(ctx, { movementId: venta.movement.id as MovementId, reason: 'la venta se anuló' })
        .then(() => null)
        .catch((e: unknown) => e);

      expect(fallo).toBeInstanceOf(DomainError);
      expect((fallo as DomainError).type).toBe('serial-already-placed');

      // Y el invariante, medido sobre los saldos, se sostiene.
      expect(await serialsInTwoPlaces(h.ctx.current(), w.orgId)).toEqual([]);
    });
  });
});
