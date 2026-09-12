import { CodeKind, CustomType, TrackingMode, type ProductId } from '@app/catalog';
import { Role } from '@app/tenancy';
import { aContext } from '../../../test/builders/a-context.js';
import { aCustomField } from '../../../test/builders/a-custom-field.js';
import {
  FakeMovementCounter, FakeStockChecker, InMemoryCustomFieldRepository,
  InMemoryProductCodeRepository, InMemoryProductRepository, RecordingEventPublisher,
  fakeIds, fixedClock,
} from '../../../test/doubles/in-memory.js';
import { CreateProduct } from './create-product.js';
import { DeactivateProduct } from './deactivate-product.js';
import { GetProduct } from './get-product.js';
import { ListProducts } from './list-products.js';
import { UpdateProduct } from './update-product.js';

const build = () => {
  const products = new InMemoryProductRepository();
  const codes = new InMemoryProductCodeRepository();
  const fields = new InMemoryCustomFieldRepository();
  const events = new RecordingEventPublisher();
  const movements = new FakeMovementCounter();
  const stock = new FakeStockChecker();
  return {
    products, codes, fields, events, movements, stock,
    create: new CreateProduct(products, codes, fields, events, fakeIds, fixedClock),
    update: new UpdateProduct(products, fields, movements, events, fakeIds, fixedClock),
    deactivate: new DeactivateProduct(products, stock, events, fakeIds, fixedClock),
    get: new GetProduct(products),
    list: new ListProducts(products),
  };
};

const NEW = { sku: 'TOR-M8', name: 'Tornillo M8', trackingMode: TrackingMode.QUANTITY, uom: 'UNIT' };

describe('CreateProduct', () => {
  it('stores the product and announces it', async () => {
    const t = build();
    const product = await t.create.execute(aContext(), NEW);
    expect(product.sku).toBe('TOR-M8');
    expect(t.events.types()).toEqual(['product.created']);
  });

  it('creates the codes that came with it, each in its own savepoint', async () => {
    const t = build();
    const product = await t.create.execute(aContext(), {
      ...NEW,
      codes: [
        { value: '7501234567890', kind: CodeKind.EAN },
        { value: 'QR-1', kind: CodeKind.INTERNAL_QR },
      ],
    });
    expect(await t.codes.listByProduct(product.orgId, product.id)).toHaveLength(2);
  });

  it('C-1 · the same SKU twice is a conflict', async () => {
    const t = build();
    await t.create.execute(aContext(), NEW);
    await expect(t.create.execute(aContext(), NEW)).rejects.toMatchObject({ type: 'sku-taken' });
  });

  it('C-7 · validates the custom fields against the definitions in force', async () => {
    const t = build();
    t.fields.add(aCustomField({ key: 'peso', type: CustomType.NUMBER }));
    await expect(
      t.create.execute(aContext(), { ...NEW, customFields: { peso: '3' } }),
    ).rejects.toMatchObject({ type: 'invalid-custom-field' });
    const ok = await t.create.execute(aContext(), { ...NEW, customFields: { peso: 3 } });
    expect(ok.customFields.toJSON()).toEqual({ peso: 3 });
  });

  it('an OPERATOR does not define the catalogue', async () => {
    const t = build();
    await expect(t.create.execute(aContext([Role.OPERATOR]), NEW)).rejects.toMatchObject({
      type: 'insufficient-role',
    });
  });
});

describe('UpdateProduct', () => {
  it('renames and announces the change', async () => {
    const t = build();
    const p = await t.create.execute(aContext(), NEW);
    const next = await t.update.execute(aContext(), { id: p.id, name: 'Tornillo galvanizado', expectedVersion: 1 });
    expect(next.name).toBe('Tornillo galvanizado');
    expect(t.events.types()).toContain('product.updated');
  });

  it('C-8 · the tracking mode changes while the product has no movements', async () => {
    const t = build();
    const p = await t.create.execute(aContext(), NEW);
    const next = await t.update.execute(aContext(), {
      id: p.id,
      trackingMode: TrackingMode.LOT,
      expectedVersion: 1,
    });
    expect(next.trackingMode).toBe(TrackingMode.LOT);
  });

  it('C-8 · and not once it has, with the count in the detail', async () => {
    const t = build();
    const p = await t.create.execute(aContext(), NEW);
    t.movements.count = 3;
    const failure = t.update.execute(aContext(), {
      id: p.id,
      trackingMode: TrackingMode.LOT,
      expectedVersion: 1,
    });
    await expect(failure).rejects.toMatchObject({ type: 'tracking-mode-locked' });
    await expect(failure).rejects.toThrow(/3 movimientos/);
  });

  it('C-8 · setting the same mode again is not a change, so it is never blocked', async () => {
    const t = build();
    const p = await t.create.execute(aContext(), NEW);
    t.movements.count = 99;
    await expect(
      t.update.execute(aContext(), { id: p.id, trackingMode: TrackingMode.QUANTITY, expectedVersion: 1 }),
    ).resolves.toBeDefined();
  });

  it('I-6 · a product that is not there is not found, never forbidden', async () => {
    const t = build();
    await expect(
      t.update.execute(aContext(), { id: 'nope' as ProductId, name: 'x', expectedVersion: 1 }),
    ).rejects.toMatchObject({ type: 'not-found', status: 404 });
  });

  // Lo encontró la colección de Postman: lo que vuelve de una escritura tiene que
  // llevar la versión con la que quedó la fila, o un cliente que edita dos veces
  // con la versión que acaba de recibir se lleva un 409 fantasma (D-31).
  it('devuelve la versión que quedó guardada, no la que traía', async () => {
    const t = build();
    const p = await t.create.execute(aContext(), NEW);
    const once = await t.update.execute(aContext(), { id: p.id, name: 'uno', expectedVersion: 1 });
    expect(once.version).toBe(2);
    const twice = await t.update.execute(aContext(), { id: p.id, name: 'dos', expectedVersion: once.version });
    expect(twice.version).toBe(3);
  });
});

describe('DeactivateProduct', () => {
  it('C-9 · a product without stock is retired', async () => {
    const t = build();
    const p = await t.create.execute(aContext(), NEW);
    await t.deactivate.execute(aContext(), p.id);
    expect((await t.products.findById(p.orgId, p.id))!.active).toBe(false);
    expect(t.events.types()).toContain('product.deactivated');
  });

  it('C-9 · one with stock is not, and the error says where it is', async () => {
    const t = build();
    const p = await t.create.execute(aContext(), NEW);
    t.stock.nodes = [{ nodeId: 'n1', path: 'BOD-A/Z1/E3', quantity: '4.000' }];
    const failure = t.deactivate.execute(aContext(), p.id);
    await expect(failure).rejects.toMatchObject({ type: 'product-has-stock' });
    await expect(failure).rejects.toThrow(/BOD-A\/Z1\/E3/);
  });

  it('retiring what is already retired changes nothing and announces nothing', async () => {
    const t = build();
    const p = await t.create.execute(aContext(), NEW);
    await t.deactivate.execute(aContext(), p.id);
    const before = t.events.published.length;
    await t.deactivate.execute(aContext(), p.id);
    expect(t.events.published).toHaveLength(before);
  });
});

describe('GetProduct and ListProducts', () => {
  const page = { limit: 50, sort: { field: 'name', dir: 'asc' } } as const;

  it('a VIEWER can read the catalogue', async () => {
    const t = build();
    const p = await t.create.execute(aContext(), NEW);
    await expect(t.get.execute(aContext([Role.VIEWER]), p.id)).resolves.toMatchObject({ sku: 'TOR-M8' });
  });

  it('filters by q over sku and name', async () => {
    const t = build();
    await t.create.execute(aContext(), NEW);
    await t.create.execute(aContext(), { ...NEW, sku: 'LEC-1', name: 'Leche entera' });
    expect((await t.list.execute(aContext(), { ...page, q: 'leche' })).data).toHaveLength(1);
    expect((await t.list.execute(aContext(), { ...page, q: 'tor' })).data).toHaveLength(1);
    expect((await t.list.execute(aContext(), page)).data).toHaveLength(2);
  });

  it('filters by tracking mode and by active', async () => {
    const t = build();
    const a = await t.create.execute(aContext(), NEW);
    await t.create.execute(aContext(), { ...NEW, sku: 'LEC-1', trackingMode: TrackingMode.LOT });
    await t.deactivate.execute(aContext(), a.id);
    expect((await t.list.execute(aContext(), { ...page, trackingMode: TrackingMode.LOT })).data).toHaveLength(1);
    expect((await t.list.execute(aContext(), { ...page, active: false })).data).toHaveLength(1);
  });

  it('says there is more instead of counting', async () => {
    const t = build();
    for (let i = 0; i < 3; i++) await t.create.execute(aContext(), { ...NEW, sku: `S-${i}` });
    const first = await t.list.execute(aContext(), { ...page, limit: 2 });
    expect(first.data).toHaveLength(2);
    expect(first.hasMore).toBe(true);
    expect(first.nextCursor).toBeDefined();
  });
});

/** The paths that only show up when something is missing or already done. */
describe('the edges', () => {
  it('GetProduct 404s for an id that is not in this organization (I-6)', async () => {
    const t = build();
    await expect(t.get.execute(aContext(), 'nope' as ProductId)).rejects.toMatchObject({
      type: 'not-found',
      status: 404,
    });
  });

  it('DeactivateProduct 404s for an id that is not there', async () => {
    const t = build();
    await expect(t.deactivate.execute(aContext(), 'nope' as ProductId)).rejects.toMatchObject({
      status: 404,
    });
  });

  it('UpdateProduct only reads the definitions when custom fields come with the patch', async () => {
    const t = build();
    t.fields.add(aCustomField({ key: 'peso', type: CustomType.NUMBER }));
    const p = await t.create.execute(aContext(), NEW);
    const next = await t.update.execute(aContext(), {
      id: p.id,
      customFields: { peso: 3 },
      expectedVersion: 1,
    });
    expect(next.customFields.toJSON()).toEqual({ peso: 3 });
  });
});
