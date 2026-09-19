import { sql } from 'kysely';
import { v7 } from 'uuid';
import type { Cursor, OrgId, TraceId, UserId } from '@app/common';
import type { BatchId, ProductId } from '@app/catalog';
import {
  InsufficientStockSignal, Movement, NodeKind, Quantity,
  type BalanceDelta, type MovementId, type NodeId,
} from '@app/inventory';
import { KyselyMovementRepository, KyselyStockBalanceRepository } from '@app/persistence';
import { createPersistenceHarness } from '../../../../../test/support/db.js';
import { rawMovement, seedWorld } from '../../support/raw-rows.js';

/**
 * The ledger against Postgres. This is where the savepoint of spec 12 §4.2 is
 * proved — after a CHECK violation Postgres leaves the transaction aborted and
 * will not even take a SELECT, so without it `insufficient-stock` could never
 * carry `available` — and where two transactions moving between the same pair
 * of nodes in opposite directions have to finish without a deadlock.
 */
describe('el ledger en Postgres', () => {
  let h: Awaited<ReturnType<typeof createPersistenceHarness>>;
  let movements: KyselyMovementRepository;
  let balances: KyselyStockBalanceRepository;
  let w: Awaited<ReturnType<typeof seedWorld>>;

  beforeAll(async () => {
    h = await createPersistenceHarness();
    movements = h.get(KyselyMovementRepository);
    balances = h.get(KyselyStockBalanceRepository);
    w = await seedWorld(h.uow, h.ctx, 'ledger');
  }, 60_000);

  afterAll(async () => {
    await h.close();
  });

  const asTenant = <T>(fn: () => Promise<T>): Promise<T> =>
    h.uow.runAs({ pool: 'tenant', orgId: w.orgId }, fn);

  const qty = (raw: string) => Quantity.rehydrate(raw);

  const delta = (nodeId: string, raw: string, o: { kind?: NodeKind; batchId?: string; productId?: string } = {}): BalanceDelta => ({
    nodeId: nodeId as NodeId,
    productId: (o.productId ?? w.productId) as ProductId,
    ...(o.batchId !== undefined ? { batchId: o.batchId as BatchId } : {}),
    nodeKind: o.kind ?? NodeKind.INTERNAL,
    delta: qty(raw),
  });

  /** A movement the database accepts, straight from its columns. */
  const aMovement = (over: Partial<Parameters<typeof Movement.rehydrate>[0]> = {}): Movement =>
    Movement.rehydrate({
      id: v7() as MovementId,
      orgId: w.orgId,
      productId: w.productId as ProductId,
      fromNodeId: w.sourceNodeId as NodeId,
      toNodeId: w.binNodeId as NodeId,
      quantity: qty('1.000'),
      occurredAt: new Date(),
      recordedAt: new Date(),
      actorId: w.userId as UserId,
      traceId: v7() as TraceId,
      trackingMode: 'QUANTITY' as never,
      fromNodeKind: NodeKind.SOURCE,
      toNodeKind: NodeKind.INTERNAL,
      ...over,
    });

  /** A private bin per test, so the suites do not fight over one balance row. */
  async function aBin(code: string): Promise<NodeId> {
    const id = v7();
    await h.uow.runAs({ pool: 'system' }, () =>
      h.ctx.current().insertInto('node')
        .values({ id, orgId: w.orgId, kind: 'INTERNAL', code, name: code, path: code })
        .execute(),
    );
    return id as NodeId;
  }

  /** The custody twin of `aBin`, so the open-loan walks do not see other suites' loans. */
  async function aCustody(code: string): Promise<NodeId> {
    const id = v7();
    await h.uow.runAs({ pool: 'system' }, () =>
      h.ctx.current().insertInto('node')
        .values({ id, orgId: w.orgId, kind: 'CUSTODY', code, name: code, path: code })
        .execute(),
    );
    return id as NodeId;
  }

  describe('applyDelta y el SAVEPOINT (I-4)', () => {
    it('tras el fallo la transacción sigue usable, y available es el saldo real', async () => {
      const bin = await aBin(`sp-${v7().slice(-8)}`);
      await asTenant(async () => {
        await balances.applyDelta(w.orgId, [delta(bin, '10.000')]);

        const fallo = await balances
          .applyDelta(w.orgId, [delta(bin, '-999.000')])
          .then(() => null)
          .catch((e: unknown) => e);

        expect(fallo).toBeInstanceOf(InsufficientStockSignal);
        expect((fallo as InsufficientStockSignal).position.available.toString()).toBe('10.000');

        // The point of the whole design: without the savepoint Postgres would
        // have left the transaction aborted and this SELECT would throw 25P02.
        const after = await balances.find(w.orgId, bin, w.productId as ProductId);
        expect(after?.quantity.toString()).toBe('10.000');
      });
    });

    it('un nodo de frontera sí baja de cero: su saldo es un acumulado', async () => {
      await asTenant(async () => {
        const out = await balances.applyDelta(w.orgId, [
          delta(w.sourceNodeId, '-7.000', { kind: NodeKind.SOURCE }),
        ]);
        expect(out[0]?.quantity.isNegative()).toBe(true);
      });
    });

    it('ordena por clave natural, no por el orden en que se los dan', async () => {
      const a = await aBin(`ord-a-${v7().slice(-8)}`);
      const b = await aBin(`ord-b-${v7().slice(-8)}`);
      const [first, second] = a < b ? [a, b] : [b, a];
      await asTenant(async () => {
        const out = await balances.applyDelta(w.orgId, [delta(second, '1.000'), delta(first, '2.000')]);
        expect(out.map((p) => p.nodeId)).toEqual([first, second]);
      });
    });

    // Without NULLS NOT DISTINCT two rows with batch_id NULL would not collide,
    // and the most common products in any catalogue would get duplicate
    // balances — the balance would stop existing as a concept.
    it('NULLS NOT DISTINCT: dos movimientos por cantidad dejan una sola fila', async () => {
      const bin = await aBin(`nnd-${v7().slice(-8)}`);
      await asTenant(async () => {
        await balances.applyDelta(w.orgId, [delta(bin, '4.000')]);
        await balances.applyDelta(w.orgId, [delta(bin, '6.000')]);
        const rows = await h.ctx.current()
          .selectFrom('stockBalance')
          .select(({ fn }) => fn.countAll().as('n'))
          .where('orgId', '=', w.orgId)
          .where('nodeId', '=', bin)
          .executeTakeFirstOrThrow();
        expect(Number(rows.n)).toBe(1);
        expect((await balances.find(w.orgId, bin, w.productId as ProductId))?.quantity.toString())
          .toBe('10.000');
      });
    });

    it('custodialTotal suma solo los nodos custodiables (I-9)', async () => {
      const bin = await aBin(`ct-${v7().slice(-8)}`);
      await asTenant(async () => {
        await balances.applyDelta(w.orgId, [
          delta(bin, '3.000', { batchId: w.batchId, productId: w.lotProductId }),
          delta(w.terminalNodeId, '9.000', {
            kind: NodeKind.TERMINAL, batchId: w.batchId, productId: w.lotProductId,
          }),
        ]);
        expect((await balances.custodialTotal(w.orgId, w.batchId as BatchId)).toString()).toBe('3.000');
      });
    });
  });

  // A failed I-4 must undo the whole request, not just the balances: a movement
  // row left behind would be history that never happened.
  it('el saldo negativo deshace la transacción entera: el movimiento no queda', async () => {
    const bin = await aBin(`abort-${v7().slice(-8)}`);
    const movement = aMovement({ toNodeId: bin, quantity: qty('1.000') });

    await expect(
      asTenant(async () => {
        await movements.append(movement);
        await balances.applyDelta(w.orgId, [delta(bin, '-5.000')]);
      }),
    ).rejects.toBeInstanceOf(InsufficientStockSignal);

    const found = await asTenant(() => movements.findById(w.orgId, movement.id));
    expect(found).toBeNull();
  });

  // Two `withRollback` cannot prove this: they never see each other's rows.
  it('dos transacciones en sentidos opuestos terminan sin interbloqueo', async () => {
    const a = await aBin(`dl-a-${v7().slice(-8)}`);
    const b = await aBin(`dl-b-${v7().slice(-8)}`);
    await asTenant(() => balances.applyDelta(w.orgId, [delta(a, '100.000'), delta(b, '100.000')]));

    const move = (from: NodeId, to: NodeId) =>
      h.uow.runAs({ pool: 'tenant', orgId: w.orgId }, () =>
        balances.applyDelta(w.orgId, [delta(from, '-1.000'), delta(to, '1.000')]),
      );

    // Ten pairs in opposite directions. With a total order over the natural key
    // one waits and the other advances; without it, a 40P01 shows up here.
    const pairs = Array.from({ length: 10 }, () => [move(a, b), move(b, a)]).flat();
    const outcomes = await Promise.allSettled(pairs);
    const deadlocks = outcomes.filter(
      (o) => o.status === 'rejected' && (o.reason as { code?: string })?.code === '40P01',
    );
    expect(deadlocks).toHaveLength(0);
    expect(outcomes.every((o) => o.status === 'fulfilled')).toBe(true);
  });

  describe('el ledger es de solo añadir (I-3)', () => {
    it('el id de cliente repetido choca contra la PK', async () => {
      const movement = aMovement();
      await asTenant(() => movements.append(movement));
      await expect(asTenant(() => movements.append(aMovement({ id: movement.id }))))
        .rejects.toMatchObject({ type: 'movement-id-taken' });
    });

    it('I-13 · dos compensaciones del mismo movimiento chocan contra el UNIQUE parcial', async () => {
      const original = aMovement();
      await asTenant(() => movements.append(original));
      const reversal = () =>
        aMovement({
          fromNodeId: w.binNodeId as NodeId, toNodeId: w.sourceNodeId as NodeId,
          fromNodeKind: NodeKind.INTERNAL, toNodeKind: NodeKind.SOURCE,
          reversesId: original.id, reason: 'corrección',
        });
      await asTenant(() => movements.append(reversal()));
      expect(await asTenant(() => movements.existsReversalOf(w.orgId, original.id))).toBe(true);
      await expect(asTenant(() => movements.append(reversal())))
        .rejects.toMatchObject({ type: 'already-reversed' });
    });

    // The third layer of I-3, checked here so the repository's shape and the
    // grant cannot drift apart. The revoke itself lives in schema/revoke.int-spec.
    it('el repositorio no expone update ni delete', () => {
      expect((movements as unknown as Record<string, unknown>).update).toBeUndefined();
      expect((movements as unknown as Record<string, unknown>).delete).toBeUndefined();
    });
  });

  describe('settledQuantity (I-18) y las custodias abiertas', () => {
    const aLoan = async () => {
      const checkOut = aMovement({
        fromNodeId: w.binNodeId as NodeId, toNodeId: w.custodyNodeId as NodeId,
        fromNodeKind: NodeKind.INTERNAL, toNodeKind: NodeKind.CUSTODY,
        quantity: qty('5.000'), dueAt: new Date('2099-01-01T00:00:00.000Z'),
      });
      await asTenant(() => movements.append(checkOut));
      return checkOut;
    };

    const aCheckIn = (checkOut: Movement, raw: string) =>
      aMovement({
        fromNodeId: w.custodyNodeId as NodeId, toNodeId: w.binNodeId as NodeId,
        fromNodeKind: NodeKind.CUSTODY, toNodeKind: NodeKind.INTERNAL,
        quantity: qty(raw), settlesId: checkOut.id,
      });

    it('suma lo devuelto', async () => {
      const checkOut = await aLoan();
      await asTenant(() => movements.append(aCheckIn(checkOut, '2.000')));
      expect((await asTenant(() => movements.settledQuantity(w.orgId, checkOut.id))).toString())
        .toBe('2.000');
    });

    // A reversed check-in stops counting and the loan goes back up: the goods
    // never really came back.
    it('ignora el check-in que fue compensado', async () => {
      const checkOut = await aLoan();
      const checkIn = aCheckIn(checkOut, '2.000');
      await asTenant(() => movements.append(checkIn));
      await asTenant(() =>
        movements.append(
          aMovement({
            fromNodeId: w.binNodeId as NodeId, toNodeId: w.custodyNodeId as NodeId,
            fromNodeKind: NodeKind.INTERNAL, toNodeKind: NodeKind.CUSTODY,
            quantity: qty('2.000'), reversesId: checkIn.id, reason: 'no volvió',
          }),
        ),
      );
      expect((await asTenant(() => movements.settledQuantity(w.orgId, checkOut.id))).toString())
        .toBe('0.000');
    });

    it('lista los préstamos abiertos por préstamo, con su pendiente', async () => {
      const checkOut = await aLoan();
      await asTenant(() => movements.append(aCheckIn(checkOut, '2.000')));
      const page = await asTenant(() =>
        movements.listOpenCustodies(
          w.orgId, { nodeId: w.custodyNodeId as NodeId },
          { limit: 50, sort: { field: 'occurredAt', dir: 'desc' } },
        ),
      );
      const mine = page.data.find((r) => r.checkOut.id === checkOut.id);
      expect(mine?.pending.toString()).toBe('3.000');
      expect(mine?.checkOut.dueAt).toBeInstanceOf(Date);
    });

    it('el préstamo saldado entero desaparece', async () => {
      const checkOut = await aLoan();
      await asTenant(() => movements.append(aCheckIn(checkOut, '5.000')));
      const page = await asTenant(() =>
        movements.listOpenCustodies(
          w.orgId, {}, { limit: 200, sort: { field: 'occurredAt', dir: 'desc' } },
        ),
      );
      expect(page.data.map((r) => r.checkOut.id)).not.toContain(checkOut.id);
    });
  });

  describe('list', () => {
    it('casa el nodo por cualquiera de los dos extremos, y ordena por occurredAt', async () => {
      const bin = await aBin(`list-${v7().slice(-8)}`);
      const viejo = aMovement({ toNodeId: bin, occurredAt: new Date('2026-01-01T00:00:00.000Z') });
      const nuevo = aMovement({ fromNodeId: bin, toNodeId: w.terminalNodeId as NodeId,
        fromNodeKind: NodeKind.INTERNAL, toNodeKind: NodeKind.TERMINAL,
        occurredAt: new Date('2026-06-01T00:00:00.000Z') });
      await asTenant(async () => {
        await movements.append(viejo);
        await movements.append(nuevo);
      });

      const page = await asTenant(() =>
        movements.list(w.orgId, { nodeId: bin }, { limit: 50, sort: { field: 'occurredAt', dir: 'desc' } }),
      );
      expect(page.data.map((m) => m.id)).toEqual([nuevo.id, viejo.id]);
    });

    /**
     * The table that grows fastest in the system: the last 50 of a product must
     * never scan it (decision D-37).
     *
     * What is asserted is that promise, and not the name of one index. In a
     * table with hundreds of tenants the planner has no statistics for a brand
     * new (org, product) pair, estimates a single row, and then
     * `movement_org_id_occurred_at_idx` and
     * `movement_org_id_product_id_occurred_at_idx` tie on cost — it takes
     * whichever is one page shallower that day. Pinning the name pins a coin
     * flip: the suite went red here with no code change at all, only because the
     * shared test database had grown. And the test cannot fix its own
     * statistics: `ANALYZE` is silently skipped for a role that does not own the
     * table, and neither application role does.
     *
     * Either plan honours D-37. A `Seq Scan` would not, and that is the failure
     * this stands guard over.
     */
    it('los últimos por producto no escanean la tabla', async () => {
      const plan = await asTenant(async () => {
        const rows = await sql<{ 'QUERY PLAN': string }>`
          explain select * from movement
          where org_id = ${w.orgId} and product_id = ${w.productId}
          order by occurred_at desc limit 50
        `.execute(h.ctx.current());
        return rows.rows.map((r) => r['QUERY PLAN']).join('\n');
      });
      expect(plan).not.toContain('Seq Scan on movement');
      // Un índice que empieza por org_id y termina en occurred_at: cualquiera de
      // los cuatro sirve al histórico, y ninguno lee la tabla entera.
      expect(plan).toMatch(/Index Scan using movement_org_id_\w*_?occurred_at_idx/);
    });

    it('cuenta por producto, que es lo que C-8 necesita', async () => {
      const before = await asTenant(() => movements.countByProduct(w.orgId, w.productId as ProductId));
      await asTenant(() => movements.append(aMovement()));
      const after = await asTenant(() => movements.countByProduct(w.orgId, w.productId as ProductId));
      expect(after).toBe(before + 1);
    });
  });

  describe('query y sumUnder', () => {
    it('custodialOnly deja fuera la frontera, y nonZeroOnly el saldo en cero', async () => {
      const bin = await aBin(`q-${v7().slice(-8)}`);
      await asTenant(async () => {
        await balances.applyDelta(w.orgId, [
          delta(bin, '5.000'),
          delta(w.terminalNodeId, '5.000', { kind: NodeKind.TERMINAL }),
        ]);
        const propio = await balances.query(w.orgId, { custodialOnly: true, nodeId: bin }, { limit: 50 });
        expect(propio.data).toHaveLength(1);

        await balances.applyDelta(w.orgId, [delta(bin, '-5.000')]);
        const enCero = await balances.query(w.orgId, { nodeId: bin }, { limit: 50 });
        expect(enCero.data).toHaveLength(0);
        const todo = await balances.query(w.orgId, { nodeId: bin, nonZeroOnly: false }, { limit: 50 });
        expect(todo.data).toHaveLength(1);
      });
    });

    it('sumUnder agrega el subárbol por producto y lote', async () => {
      const root = `sub-${v7().slice(-8)}`;
      const ids: string[] = [];
      for (const code of [root, `${root}/A`, `${root}/B`]) {
        const id = v7();
        ids.push(id);
        await h.uow.runAs({ pool: 'system' }, () =>
          h.ctx.current().insertInto('node')
            .values({ id, orgId: w.orgId, kind: 'INTERNAL', code: code.replace('/', '-'), name: code, path: code })
            .execute(),
        );
      }
      await asTenant(async () => {
        await balances.applyDelta(w.orgId, [delta(ids[1]!, '30.000'), delta(ids[2]!, '12.000')]);
        const totals = await balances.sumUnder(w.orgId, root as never, w.productId as ProductId);
        expect(totals).toHaveLength(1);
        expect(totals[0]?.quantity.toString()).toBe('42.000');
      });
    });
  });

  /**
   * D-67 fixed three cursor columns by naming them one by one, and the list was
   * short: `movement.occurred_at` is a fourth, reachable from
   * `GET /v1/movements` and from `GET /v1/stock/custodies`. It was called safe
   * because every writer today happens to go through `new Date(iso)` — safe by
   * convention, not by type. The column still accepts what Postgres `now()`
   * writes, and these rows are inserted the way any writer that is not today's
   * code would do it: in raw SQL, in one statement, so `now()` is identical for
   * all of them down to the microsecond.
   *
   * `movement` carries `REVOKE UPDATE, DELETE`, so the microsecond cannot be
   * put there afterwards. It goes in at insert time or not at all.
   *
   * Both walks go over a cursor built from a JavaScript `Date`, which only
   * reaches the millisecond — so it comes out **below** the stored value and
   * the comparison drops every row of that microsecond. Two walks and not one
   * because `/v1/stock/custodies` has its own hand-written keyset
   * (`movement.dao.ts`), with its own truncation.
   */
  describe('el cursor y los microsegundos (D-67, D-68)', () => {
    /** Five rows, one statement, one `now()`: the shape `POST /v1/products/import` has. */
    const cincoEnUnNow = async (rows: readonly Record<string, unknown>[]) => {
      await h.uow.runAs({ pool: 'system' }, () =>
        h.ctx.current().insertInto('movement')
          .values(rows.map((r) => ({ ...r, occurredAt: sql`now()` })) as never)
          .execute(),
      );
    };

    /** Walks a page function to exhaustion, asserting no page comes back empty. */
    const recorrer = async (
      fetch: (cursor?: Cursor) => Promise<{ data: readonly { id: string }[]; nextCursor?: Cursor }>,
    ): Promise<string[]> => {
      const vistos: string[] = [];
      let cursor: Cursor | undefined;
      for (let vuelta = 0; vuelta < 10; vuelta++) {
        const page: { data: readonly { id: string }[]; nextCursor?: Cursor } = await fetch(cursor);
        // Without the fix this page came back empty and the walk ended early,
        // with 2 of the 5 rows and nobody saying anything.
        expect(page.data.length).toBeGreaterThan(0);
        vistos.push(...page.data.map((r) => r.id));
        if (page.nextCursor === undefined) break;
        cursor = page.nextCursor;
      }
      return vistos;
    };

    it('GET /v1/movements pagina aunque las cinco filas compartan un now()', async () => {
      const bin = await aBin(`us-mov-${v7().slice(-8)}`);
      const esperados = Array.from({ length: 5 }, () => v7());
      await cincoEnUnNow(
        esperados.map((id) => rawMovement(w, { id, toNodeId: bin })),
      );

      const vistos = await recorrer((cursor) =>
        asTenant(() =>
          movements.list(
            w.orgId, { nodeId: bin as NodeId },
            { limit: 2, sort: { field: 'occurredAt', dir: 'desc' }, ...(cursor ? { cursor } : {}) },
          ),
        ),
      );
      expect([...vistos].sort()).toEqual([...esperados].sort());
    });

    it('las custodias abiertas paginan con su cursor propio, con el mismo now()', async () => {
      const custodia = await aCustody(`us-cus-${v7().slice(-8)}`);
      const esperados = Array.from({ length: 5 }, () => v7());
      await cincoEnUnNow(
        esperados.map((id) =>
          rawMovement(w, {
            id, fromNodeId: w.binNodeId, toNodeId: custodia,
            fromNodeKind: 'INTERNAL', toNodeKind: 'CUSTODY', quantity: '5.000',
          }),
        ),
      );

      const vistos = await recorrer(async (cursor) => {
        const page = await asTenant(() =>
          movements.listOpenCustodies(
            w.orgId, { nodeId: custodia as NodeId },
            { limit: 2, sort: { field: 'occurredAt', dir: 'desc' }, ...(cursor ? { cursor } : {}) },
          ),
        );
        return { data: page.data.map((r) => ({ id: r.checkOut.id })), ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}) };
      });
      expect([...vistos].sort()).toEqual([...esperados].sort());
    });
  });

});
