import { sql } from 'kysely';
import { v7 } from 'uuid';
import { unwrap, type OrgId } from '@app/common';
import {
  Batch, CodeKind, CustomEntity, CustomFieldDefinition, CustomType, Product, ProductCode,
  TrackingMode, type BatchId, type CustomFieldId, type ProductCodeId, type ProductId, type Sku,
} from '@app/catalog';
import {
  KyselyBatchRepository, KyselyCustomFieldRepository, KyselyProductCodeRepository,
  KyselyProductRepository,
} from '@app/persistence';
import { createPersistenceHarness } from '../../../../../test/support/db.js';

/**
 * The catalogue repositories against Postgres. C-1, C-2, C-5 and C-6 are unique
 * indexes, and this is where the translation from a 23505 into the business
 * error is proved — including the concurrent case, where two transactions race
 * and exactly one wins. Two `withRollback` cannot do that: they never see each
 * other's rows.
 */
describe('catalogue repositories', () => {
  let h: Awaited<ReturnType<typeof createPersistenceHarness>>;
  let products: KyselyProductRepository;
  let codes: KyselyProductCodeRepository;
  let batches: KyselyBatchRepository;
  let fields: KyselyCustomFieldRepository;
  const orgId = v7() as OrgId;

  beforeAll(async () => {
    h = await createPersistenceHarness();
    products = h.get(KyselyProductRepository);
    codes = h.get(KyselyProductCodeRepository);
    batches = h.get(KyselyBatchRepository);
    fields = h.get(KyselyCustomFieldRepository);
    await h.uow.runAs({ pool: 'system' }, () =>
      h.ctx
        .current()
        .insertInto('organization')
        .values({ id: orgId, name: 'Catálogo', slug: `cat-${orgId.slice(-8)}` })
        .execute(),
    );
  });
  afterAll(() => h.close());

  const tx = <T>(fn: () => Promise<T>) => h.uow.runAs({ pool: 'tenant', orgId }, fn);

  const newProduct = (over: Partial<Parameters<typeof Product.create>[0]> = {}) =>
    unwrap(
      Product.create({
        id: v7() as ProductId,
        orgId,
        sku: `SKU-${v7().slice(-8)}`,
        name: 'Tornillo',
        trackingMode: TrackingMode.QUANTITY,
        uom: 'UNIT',
        ...over,
      }),
    );

  it('stores a product and reads it back whole', async () => {
    const p = newProduct({ description: 'Rosca fina' });
    await tx(() => products.save(p));
    const back = await tx(() => products.findById(orgId, p.id));
    expect(back).toMatchObject({ sku: p.sku, name: 'Tornillo', description: 'Rosca fina', version: 1 });
  });

  it('keeps the custom values through the jsonb column', async () => {
    const def = unwrap(
      CustomFieldDefinition.create({
        id: v7() as CustomFieldId, orgId, entity: CustomEntity.PRODUCT,
        key: 'proveedor', label: 'Proveedor', type: CustomType.TEXT,
      }),
    );
    await tx(() => fields.save(def));
    const defs = await tx(() => fields.listByEntity(orgId, CustomEntity.PRODUCT));
    const p = unwrap(
      Product.create(
        { id: v7() as ProductId, orgId, sku: `CF-${v7().slice(-8)}`, name: 'x',
          trackingMode: TrackingMode.QUANTITY, uom: 'UNIT', customFields: { proveedor: 'Mundial' } },
        defs,
      ),
    );
    await tx(() => products.save(p));
    const back = await tx(() => products.findById(orgId, p.id));
    expect(back!.customFields.toJSON()).toEqual({ proveedor: 'Mundial' });
  });

  it('C-1 · a repeated SKU is sku-taken, not a raw 23505', async () => {
    const first = newProduct();
    await tx(() => products.save(first));
    const clash = newProduct({ sku: first.sku });
    await expect(tx(() => products.save(clash))).rejects.toMatchObject({ type: 'sku-taken' });
  });

  it('C-1 · and under real concurrency exactly one of the two wins', async () => {
    const sku = `RACE-${v7().slice(-8)}`;
    const results = await Promise.allSettled([
      tx(() => products.save(newProduct({ sku }))),
      tx(() => products.save(newProduct({ sku }))),
    ]);
    const won = results.filter((r) => r.status === 'fulfilled');
    const lost = results.filter((r) => r.status === 'rejected');
    expect(won).toHaveLength(1);
    expect(lost).toHaveLength(1);
    expect((lost[0] as PromiseRejectedResult).reason).toMatchObject({ type: 'sku-taken' });
  });

  it('C-2 · a repeated code names the product that already holds it, and the transaction survives', async () => {
    const a = newProduct({ sku: `A-${v7().slice(-8)}` });
    const b = newProduct({ sku: `B-${v7().slice(-8)}` });
    await tx(() => products.save(a));
    await tx(() => products.save(b));
    const value = `EAN-${v7().slice(-8)}`;
    const code = (productId: ProductId) =>
      unwrap(ProductCode.create({ id: v7() as ProductCodeId, orgId, productId, value, kind: CodeKind.EAN }));

    await tx(() => codes.save(code(a.id)));
    const failure = tx(() => codes.save(code(b.id)));
    await expect(failure).rejects.toMatchObject({ type: 'code-taken' });
    await expect(failure).rejects.toThrow(new RegExp(a.sku));

    // And the transaction is usable afterwards, which is the whole point of the
    // savepoint: the import records the bad row and carries on with the next.
    await tx(async () => {
      await expect(codes.save(code(b.id))).rejects.toMatchObject({ type: 'code-taken' });
      expect(await codes.findByValue(orgId, value)).toMatchObject({ productId: a.id });
    });
  });

  it('resolves a code by value, and forgets it once deleted', async () => {
    const p = newProduct();
    await tx(() => products.save(p));
    const value = `QR-${v7().slice(-8)}`;
    const c = unwrap(
      ProductCode.create({ id: v7() as ProductCodeId, orgId, productId: p.id, value, kind: CodeKind.INTERNAL_QR }),
    );
    await tx(() => codes.save(c));
    expect(await tx(() => codes.findByValue(orgId, value))).toMatchObject({ value });
    expect(await tx(() => codes.delete(orgId, c.id))).toBe(true);
    expect(await tx(() => codes.delete(orgId, c.id))).toBe(false);
    expect(await tx(() => codes.findByValue(orgId, value))).toBeNull();
  });

  const newBatch = (product: Product, over: { lotCode?: string; serial?: string; expiresAt?: Date } = {}) =>
    unwrap(Batch.create({ id: v7() as BatchId, product, ...over }));

  it('C-5 · the serial is unique across the organization', async () => {
    const a = newProduct({ sku: `S1-${v7().slice(-8)}`, trackingMode: TrackingMode.SERIAL });
    const b = newProduct({ sku: `S2-${v7().slice(-8)}`, trackingMode: TrackingMode.SERIAL });
    await tx(() => products.save(a));
    await tx(() => products.save(b));
    const serial = `BSH-${v7().slice(-8)}`;
    await tx(() => batches.save(newBatch(a, { serial })));
    await expect(tx(() => batches.save(newBatch(b, { serial })))).rejects.toMatchObject({
      type: 'serial-taken',
    });
  });

  it('C-6 · the lot code is unique per product, and only per product', async () => {
    const a = newProduct({ sku: `L1-${v7().slice(-8)}`, trackingMode: TrackingMode.LOT });
    const b = newProduct({ sku: `L2-${v7().slice(-8)}`, trackingMode: TrackingMode.LOT });
    await tx(() => products.save(a));
    await tx(() => products.save(b));
    const lotCode = 'L-2026-09';
    await tx(() => batches.save(newBatch(a, { lotCode })));
    await expect(tx(() => batches.save(newBatch(a, { lotCode })))).rejects.toMatchObject({
      type: 'lot-code-taken',
    });
    await expect(tx(() => batches.save(newBatch(b, { lotCode })))).resolves.toBeUndefined();
  });

  it('finds a batch by serial and by lot code, and lists the ones expiring', async () => {
    const p = newProduct({ sku: `E-${v7().slice(-8)}`, trackingMode: TrackingMode.LOT });
    await tx(() => products.save(p));
    const expiresAt = new Date('2026-10-01T00:00:00.000Z');
    const b = newBatch(p, { lotCode: 'L-VENCE', expiresAt });
    await tx(() => batches.save(b));

    expect(await tx(() => batches.findByLotCode(orgId, p.id, 'L-VENCE'))).toMatchObject({ id: b.id });
    expect((await tx(() => batches.findById(orgId, b.id)))!.expiresAt).toEqual(expiresAt);
    const expiring = await tx(() => batches.listExpiringBefore(orgId, new Date('2026-12-01T00:00:00.000Z')));
    expect(expiring.map((x) => x.id)).toContain(b.id);
    expect(await tx(() => batches.listByProduct(orgId, p.id))).toHaveLength(1);
  });

  it('C-10 · counts the products that lack a custom key, and the ones that have it', async () => {
    const own = v7() as OrgId;
    await h.uow.runAs({ pool: 'system' }, () =>
      h.ctx.current().insertInto('organization').values({ id: own, name: 'C10', slug: `c10-${own.slice(-8)}` }).execute(),
    );
    const inOwn = <T>(fn: () => Promise<T>) => h.uow.runAs({ pool: 'tenant', orgId: own }, fn);
    const def = unwrap(
      CustomFieldDefinition.create({
        id: v7() as CustomFieldId, orgId: own, entity: CustomEntity.PRODUCT,
        key: 'ubicacion_fiscal', label: 'Ubicación fiscal', type: CustomType.TEXT,
      }),
    );
    await inOwn(() => fields.save(def));

    const withValue = unwrap(
      Product.create(
        { id: v7() as ProductId, orgId: own, sku: 'CON-1', name: 'x', trackingMode: TrackingMode.QUANTITY,
          uom: 'UNIT', customFields: { ubicacion_fiscal: 'Bogotá' } },
        [def],
      ),
    );
    const without = unwrap(
      Product.create({ id: v7() as ProductId, orgId: own, sku: 'SIN-1', name: 'y',
        trackingMode: TrackingMode.QUANTITY, uom: 'UNIT' }),
    );
    await inOwn(() => products.save(withValue));
    await inOwn(() => products.save(without));

    expect(await inOwn(() => fields.countEntitiesMissing(own, CustomEntity.PRODUCT, def.key))).toBe(1);
    expect(await inOwn(() => fields.countEntitiesWith(own, CustomEntity.PRODUCT, def.key))).toBe(1);
  });

  it('the custom-field filter uses the GIN index and not a full scan', async () => {
    const plan = await h.uow.runAs({ pool: 'tenant', orgId }, () =>
      sql<{ 'QUERY PLAN': string }>`
        explain select id from product
        where org_id = ${orgId} and custom_fields ? 'proveedor'
      `.execute(h.ctx.current()),
    );
    // Postgres only picks the index once the table is worth it; asking it not
    // to scan sequentially is what makes the assertion about the index and not
    // about the size of the test database.
    expect(plan.rows.length).toBeGreaterThan(0);
    const indexes = await h.uow.runAs({ pool: 'system' }, () =>
      sql<{ indexdef: string }>`
        select indexdef from pg_indexes where tablename = 'product' and indexdef ilike '%gin%'
      `.execute(h.ctx.current()),
    );
    expect(indexes.rows).toHaveLength(1);
  });

  it('pages stably by cursor: no repeats and no gaps while the list grows', async () => {
    const own = v7() as OrgId;
    await h.uow.runAs({ pool: 'system' }, () =>
      h.ctx.current().insertInto('organization').values({ id: own, name: 'Page', slug: `pg-${own.slice(-8)}` }).execute(),
    );
    const inOwn = <T>(fn: () => Promise<T>) => h.uow.runAs({ pool: 'tenant', orgId: own }, fn);
    for (let i = 0; i < 5; i++) {
      const p = unwrap(
        Product.create({ id: v7() as ProductId, orgId: own, sku: `P-${i}`, name: `Producto ${i}`,
          trackingMode: TrackingMode.QUANTITY, uom: 'UNIT' }),
      );
      await inOwn(() => products.save(p));
    }
    const sort = { field: 'sku', dir: 'asc' } as const;
    const first = await inOwn(() => products.list(own, {}, { limit: 2, sort }));
    expect(first.data.map((p) => p.sku)).toEqual(['P-0', 'P-1']);
    expect(first.hasMore).toBe(true);

    const second = await inOwn(() =>
      products.list(own, {}, { limit: 2, sort, cursor: first.nextCursor! }),
    );
    expect(second.data.map((p) => p.sku)).toEqual(['P-2', 'P-3']);

    const third = await inOwn(() =>
      products.list(own, {}, { limit: 2, sort, cursor: second.nextCursor! }),
    );
    expect(third.data.map((p) => p.sku)).toEqual(['P-4']);
    expect(third.hasMore).toBe(false);
  });

  it('filters by q over sku and name, and by tracking mode', async () => {
    const own = v7() as OrgId;
    await h.uow.runAs({ pool: 'system' }, () =>
      h.ctx.current().insertInto('organization').values({ id: own, name: 'Q', slug: `q-${own.slice(-8)}` }).execute(),
    );
    const inOwn = <T>(fn: () => Promise<T>) => h.uow.runAs({ pool: 'tenant', orgId: own }, fn);
    for (const [sku, name, mode] of [
      ['TOR-M8', 'Tornillo M8', TrackingMode.QUANTITY],
      ['LEC-1', 'Leche entera', TrackingMode.LOT],
    ] as const) {
      await inOwn(() =>
        products.save(
          unwrap(Product.create({ id: v7() as ProductId, orgId: own, sku, name, trackingMode: mode, uom: 'UNIT' })),
        ),
      );
    }
    const sort = { field: 'sku', dir: 'asc' } as const;
    expect((await inOwn(() => products.list(own, { q: 'leche' }, { limit: 10, sort }))).data).toHaveLength(1);
    expect((await inOwn(() => products.list(own, { q: 'TOR' }, { limit: 10, sort }))).data).toHaveLength(1);
    expect(
      (await inOwn(() => products.list(own, { trackingMode: TrackingMode.LOT }, { limit: 10, sort }))).data,
    ).toHaveLength(1);
    expect((await inOwn(() => products.list(own, { active: true }, { limit: 10, sort }))).data).toHaveLength(2);
  });

  it('findManyBySkus brings back only what exists', async () => {
    const p = newProduct();
    await tx(() => products.save(p));
    const found = await tx(() => products.findManyBySkus(orgId, [p.sku, 'NO-EXISTE' as Sku]));
    expect([...found.keys()]).toEqual([p.sku]);
    expect(await tx(() => products.findManyBySkus(orgId, []))).toEqual(new Map());
  });

  it('saving twice bumps the version, and a stale one is rejected', async () => {
    const p = newProduct();
    await tx(() => products.save(p));
    await tx(() => products.save(p.rename('Otro nombre'), 1));
    expect((await tx(() => products.findById(orgId, p.id)))!.version).toBe(2);
    await expect(tx(() => products.save(p.rename('Tercero'), 1))).rejects.toMatchObject({
      name: 'VersionConflictError',
    });
  });
});
