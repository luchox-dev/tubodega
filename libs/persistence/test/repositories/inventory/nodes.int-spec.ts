import { sql } from 'kysely';
import { v7 } from 'uuid';
import { unwrap, type OrgId } from '@app/common';
import { Node, NodeCode, NodeKind, type NodeId, type NodePath } from '@app/inventory';
import { KyselyNodeRepository, KyselyStockBalanceRepository } from '@app/persistence';
import { createPersistenceHarness } from '../../../../../test/support/db.js';

/**
 * The node repository against Postgres. This is where N-1 and N-2 are proved —
 * a subtree rewrite that a double can always fake — and where the 23505 on
 * (org_id, code) becomes a business error, including the concurrent case where
 * two transactions race and exactly one wins.
 */
describe('node repository', () => {
  let h: Awaited<ReturnType<typeof createPersistenceHarness>>;
  let nodes: KyselyNodeRepository;
  let balances: KyselyStockBalanceRepository;
  const orgId = v7() as OrgId;

  const mk = (code: string, parent?: Node, kind = NodeKind.INTERNAL) =>
    unwrap(Node.create({ id: v7() as NodeId, orgId, kind, code, name: code }, parent));

  beforeAll(async () => {
    h = await createPersistenceHarness();
    nodes = h.get(KyselyNodeRepository);
    balances = h.get(KyselyStockBalanceRepository);
    await h.uow.runAs({ pool: 'system' }, () =>
      h.ctx
        .current()
        .insertInto('organization')
        .values({ id: orgId, name: 'Ubicaciones', slug: `ubi-${orgId.slice(-8)}` })
        .execute(),
    );
  }, 60_000);

  afterAll(async () => {
    await h.uow.runAs({ pool: 'system' }, async () => {
      await h.ctx.current().deleteFrom('stockBalance').where('orgId', '=', orgId).execute();
      await h.ctx.current().deleteFrom('node').where('orgId', '=', orgId).execute();
      await h.ctx.current().deleteFrom('organization').where('id', '=', orgId).execute();
    });
    await h.close();
  });

  /** BOD-A › Z1 › E3 › {B2, B3}, plus BOD-B › Z2. Committed, not rolled back:
   *  the concurrency case needs two transactions to see the same rows. */
  async function aWarehouse(tag: string) {
    return h.uow.runAs({ pool: 'tenant', orgId }, async () => {
      const bodA = mk(`${tag}-BOD-A`);
      await nodes.save(bodA);
      const z1 = mk(`${tag}-Z1`, bodA);
      await nodes.save(z1);
      const e3 = mk(`${tag}-E3`, z1);
      await nodes.save(e3);
      const b2 = mk(`${tag}-B2`, e3);
      await nodes.save(b2);
      const b3 = mk(`${tag}-B3`, e3);
      await nodes.save(b3);
      const bodB = mk(`${tag}-BOD-B`);
      await nodes.save(bodB);
      const z2 = mk(`${tag}-Z2`, bodB);
      await nodes.save(z2);
      return { bodA, z1, e3, b2, b3, bodB, z2 };
    });
  }

  const pathOf = (id: NodeId) =>
    h.uow.runAs({ pool: 'tenant', orgId }, async () => (await nodes.findById(orgId, id))!.path);

  it('N-1 y N-2 · reasignar un padre recalcula el path de todo el subárbol', async () => {
    const w = await aWarehouse('n2');

    await h.uow.runAs({ pool: 'tenant', orgId }, async () => {
      const e3 = (await nodes.findById(orgId, w.e3.id))!;
      const z2 = (await nodes.findById(orgId, w.z2.id))!;
      const moved = e3.moveTo(z2);
      await nodes.save(moved, e3.version);
      await nodes.updateSubtreePaths(orgId, e3.path, moved.path);
    });

    expect(await pathOf(w.e3.id)).toBe('n2-BOD-B/n2-Z2/n2-E3');
    expect(await pathOf(w.b2.id)).toBe('n2-BOD-B/n2-Z2/n2-E3/n2-B2');
    expect(await pathOf(w.b3.id)).toBe('n2-BOD-B/n2-Z2/n2-E3/n2-B3');
  });

  // The trap the whole module is built around, this time in SQL: 'X/Z1' is a
  // prefix of 'X/Z10', and a LIKE without the separator would drag it along.
  it('el UPDATE por prefijo no arrastra a «Z10» al mover «Z1»', async () => {
    const w = await aWarehouse('pfx');
    const z10 = await h.uow.runAs({ pool: 'tenant', orgId }, async () => {
      const n = mk('pfx-Z1' + '0', (await nodes.findById(orgId, w.bodA.id))!);
      await nodes.save(n);
      return n;
    });
    expect(z10.path).toBe('pfx-BOD-A/pfx-Z10');

    await h.uow.runAs({ pool: 'tenant', orgId }, async () => {
      const z1 = (await nodes.findById(orgId, w.z1.id))!;
      const z2 = (await nodes.findById(orgId, w.z2.id))!;
      const moved = z1.moveTo(z2);
      await nodes.save(moved, z1.version);
      await nodes.updateSubtreePaths(orgId, z1.path, moved.path);
    });

    expect(await pathOf(z10.id)).toBe('pfx-BOD-A/pfx-Z10');
    expect(await pathOf(w.e3.id)).toBe('pfx-BOD-B/pfx-Z2/pfx-Z1/pfx-E3');
  });

  // `replace` would rewrite every occurrence; `substring` rewrites the prefix.
  it('un path que repite el prefijo no se corrompe', async () => {
    const { bodA } = await h.uow.runAs({ pool: 'tenant', orgId }, async () => {
      const a = mk('rep-A');
      await nodes.save(a);
      const inner = mk('rep-A' + '-dentro', a);
      await nodes.save(inner);
      return { bodA: a, inner };
    });
    const root = await h.uow.runAs({ pool: 'tenant', orgId }, async () => {
      const b = mk('rep-B');
      await nodes.save(b);
      return b;
    });

    await h.uow.runAs({ pool: 'tenant', orgId }, async () => {
      const a = (await nodes.findById(orgId, bodA.id))!;
      const moved = a.moveTo((await nodes.findById(orgId, root.id))!);
      await nodes.save(moved, a.version);
      await nodes.updateSubtreePaths(orgId, a.path, moved.path);
    });

    const inner = await h.uow.runAs({ pool: 'tenant', orgId }, () =>
      nodes.listUnder(orgId, 'rep-B/rep-A' as NodePath, 10),
    );
    expect(inner.map((n) => n.path)).toEqual(['rep-B/rep-A/rep-A-dentro']);
  });

  it('listUnder devuelve el subárbol estricto y ordenado por path', async () => {
    const w = await aWarehouse('lu');
    const under = await h.uow.runAs({ pool: 'tenant', orgId }, () =>
      nodes.listUnder(orgId, w.z1.path, 100),
    );
    // Ordered by path, so the parent comes before its children: a parent's
    // path is a strict prefix of its child's, and a prefix sorts first.
    expect(under.map((n) => n.code)).toEqual(['lu-E3', 'lu-B2', 'lu-B3']);
  });

  // A '%' is a legal code and an illegal LIKE pattern.
  it('el LIKE escapa los comodines: un nodo «50%» no arrastra medio árbol', async () => {
    const w = await aWarehouse('esc');
    const raro = await h.uow.runAs({ pool: 'tenant', orgId }, async () => {
      const n = mk('esc-50%', (await nodes.findById(orgId, w.bodA.id))!);
      await nodes.save(n);
      const hijo = mk('esc-hijo', n);
      await nodes.save(hijo);
      return n;
    });
    const under = await h.uow.runAs({ pool: 'tenant', orgId }, () =>
      nodes.listUnder(orgId, raro.path, 100),
    );
    expect(under.map((n) => n.code)).toEqual(['esc-hijo']);
  });

  it('listUnder respeta el tope que le pasan (D-29)', async () => {
    const w = await aWarehouse('cap');
    const under = await h.uow.runAs({ pool: 'tenant', orgId }, () =>
      nodes.listUnder(orgId, w.bodA.path, 2),
    );
    expect(under).toHaveLength(2);
  });

  it('listActiveChildren no cuenta los ya desactivados (D-30)', async () => {
    const w = await aWarehouse('hij');
    await h.uow.runAs({ pool: 'tenant', orgId }, async () => {
      const b3 = (await nodes.findById(orgId, w.b3.id))!;
      await nodes.save(b3.deactivate(), b3.version);
    });
    const active = await h.uow.runAs({ pool: 'tenant', orgId }, () =>
      nodes.listActiveChildren(orgId, w.e3.path, 100),
    );
    expect(active.map((n) => n.code)).toEqual(['hij-B2']);
  });

  it('el 23505 del código repetido sale como node-code-taken', async () => {
    const w = await aWarehouse('dup');
    await expect(
      h.uow.runAs({ pool: 'tenant', orgId }, () => nodes.save(mk(w.b2.code))),
    ).rejects.toMatchObject({ type: 'node-code-taken' });
  });

  // Two `withRollback` cannot prove this: they never see each other's rows.
  it('bajo concurrencia real, exactamente una transacción se queda el código', async () => {
    const code = `race-${v7().slice(-8)}`;
    const attempt = () =>
      h.uow
        .runAs({ pool: 'tenant', orgId }, () => nodes.save(mk(code)))
        .then(() => 'ok' as const)
        .catch((e: { type?: string }) => e.type ?? 'otro');

    const [a, b] = await Promise.all([attempt(), attempt()]);
    expect([a, b].filter((r) => r === 'ok')).toHaveLength(1);
    expect([a, b].filter((r) => r === 'node-code-taken')).toHaveLength(1);
  });

  /**
   * The opclass is the one guarantee of the schema that Prisma emits but cannot
   * introspect (deviation 4 of plan 3): it lives only in the hand-written SQL,
   * so nothing but this says it reached the database — and a future migration
   * could drop it without `pnpm db:check` noticing.
   *
   * What is asserted is the opclass and not the query plan. On a test table of
   * a dozen rows Postgres picks whatever index is cheapest — here the one on
   * (org_id, id) — no matter what else is available, so asserting the plan
   * would be asserting the size of the test database. `text_pattern_ops` is
   * precisely and only what makes `LIKE 'prefijo%'` indexable under a non-C
   * collation, which is the property the subtree query depends on.
   */
  it('el índice de path lleva la opclase text_pattern_ops', async () => {
    const indexes = await h.uow.runAs({ pool: 'system' }, () =>
      sql<{ indexdef: string }>`
        select indexdef from pg_indexes
        where tablename = 'node' and indexname = 'node_org_id_path_idx'
      `.execute(h.ctx.current()),
    );
    expect(indexes.rows).toHaveLength(1);
    expect(indexes.rows[0]!.indexdef).toContain('text_pattern_ops');
    expect(indexes.rows[0]!.indexdef).toContain('org_id');
  });

  it('findByCode y findManyByIds acotan por organización', async () => {
    const w = await aWarehouse('find');
    await h.uow.runAs({ pool: 'tenant', orgId }, async () => {
      const found = await nodes.findByCode(orgId, unwrap(NodeCode.of(w.z1.code)));
      expect(found?.id).toBe(w.z1.id);
      const many = await nodes.findManyByIds(orgId, [w.z1.id, w.b2.id]);
      expect([...many.keys()].sort()).toEqual([w.z1.id, w.b2.id].sort());
      expect(await nodes.findByCode(orgId, unwrap(NodeCode.of('no-existe')))).toBeNull();
    });
  });

  it('list pagina y filtra por tipo', async () => {
    const w = await aWarehouse('pag');
    await h.uow.runAs({ pool: 'tenant', orgId }, async () => {
      const page = await nodes.list(
        orgId,
        { underPath: w.bodA.path },
        { limit: 2, sort: { field: 'path', dir: 'asc' } },
      );
      expect(page.data).toHaveLength(2);
      expect(page.hasMore).toBe(true);

      const next = await nodes.list(
        orgId,
        { underPath: w.bodA.path },
        { limit: 2, sort: { field: 'path', dir: 'asc' }, cursor: page.nextCursor! },
      );
      expect(next.data.map((n) => n.id)).not.toContain(page.data[0]!.id);
    });
  });

  it('save con la versión vieja es un conflicto de versión', async () => {
    const w = await aWarehouse('ver');
    await expect(
      h.uow.runAs({ pool: 'tenant', orgId }, async () => {
        const z1 = (await nodes.findById(orgId, w.z1.id))!;
        await nodes.save(unwrap(z1.update({ name: 'uno' })), z1.version);
        await nodes.save(unwrap(z1.update({ name: 'dos' })), z1.version);
      }),
    ).rejects.toThrow();
  });

  describe('saldos, para N-3', () => {
    it('hasAnyStock y positionsIn ven el saldo de un nodo', async () => {
      const w = await aWarehouse('stk');
      const productId = v7();
      await h.uow.runAs({ pool: 'system' }, async () => {
        await h.ctx
          .current()
          .insertInto('product')
          .values({ id: productId, orgId, sku: `STK-${productId.slice(-8)}`, name: 'Con saldo', trackingMode: 'QUANTITY', uom: 'UNIT' })
          .execute();
        await h.ctx
          .current()
          .insertInto('stockBalance')
          .values({ id: v7(), orgId, nodeId: w.b2.id, productId, batchId: null, nodeKind: 'INTERNAL', quantity: '4.000' })
          .execute();
      });

      await h.uow.runAs({ pool: 'tenant', orgId }, async () => {
        expect(await balances.hasAnyStock(orgId, { nodeId: w.b2.id })).toBe(true);
        expect(await balances.hasAnyStock(orgId, { nodeId: w.b3.id })).toBe(false);
        const positions = await balances.positionsIn(orgId, { nodeId: w.b2.id }, 20);
        expect(positions).toEqual([{ productId, quantity: '4.000' }]);
      });
    });

    it('un saldo en cero no cuenta como saldo', async () => {
      const w = await aWarehouse('cero');
      const productId = v7();
      await h.uow.runAs({ pool: 'system' }, async () => {
        await h.ctx
          .current()
          .insertInto('product')
          .values({ id: productId, orgId, sku: `CERO-${productId.slice(-8)}`, name: 'Vacío', trackingMode: 'QUANTITY', uom: 'UNIT' })
          .execute();
        await h.ctx
          .current()
          .insertInto('stockBalance')
          .values({ id: v7(), orgId, nodeId: w.b2.id, productId, batchId: null, nodeKind: 'INTERNAL', quantity: '0.000' })
          .execute();
      });

      await h.uow.runAs({ pool: 'tenant', orgId }, async () => {
        expect(await balances.hasAnyStock(orgId, { nodeId: w.b2.id })).toBe(false);
      });
    });
  });
});
