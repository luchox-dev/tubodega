import { CodeKind, TrackingMode, type ProductCodeId, type ProductId } from '@app/catalog';
import { Role } from '@app/tenancy';
import { aContext } from '../../../test/builders/a-context.js';
import {
  InMemoryBatchRepository, InMemoryCustomFieldRepository, InMemoryProductCodeRepository,
  InMemoryProductRepository, RecordingEventPublisher, fakeIds, fixedClock,
} from '../../../test/doubles/in-memory.js';
import { AddProductCode } from './add-product-code.js';
import { CreateProduct } from './create-product.js';
import { ListCodes } from './list-codes.js';
import { RemoveProductCode } from './remove-product-code.js';
import { ResolveCode } from './resolve-code.js';
import { CreateBatch } from './create-batch.js';

const build = () => {
  const products = new InMemoryProductRepository();
  const codes = new InMemoryProductCodeRepository();
  const batches = new InMemoryBatchRepository();
  const fields = new InMemoryCustomFieldRepository();
  const events = new RecordingEventPublisher();
  codes.skuOf = (id) => [...products.rows.values()].find((p) => p.id === id)?.sku;
  return {
    products, codes, batches, events,
    create: new CreateProduct(products, codes, fields, events, fakeIds, fixedClock),
    createBatch: new CreateBatch(products, batches, fields, events, fakeIds, fixedClock),
    add: new AddProductCode(products, codes, fakeIds),
    remove: new RemoveProductCode(products, codes),
    listCodes: new ListCodes(products, codes),
    resolve: new ResolveCode(products, codes, batches),
  };
};

const TOR = { sku: 'TOR-M8', name: 'Tornillo M8', trackingMode: TrackingMode.QUANTITY, uom: 'UNIT' };
const TAL = { sku: 'TAL-1', name: 'Taladro', trackingMode: TrackingMode.SERIAL, uom: 'UNIT' };

describe('product codes', () => {
  it('adds a code and lists it', async () => {
    const t = build();
    const p = await t.create.execute(aContext(), TOR);
    await t.add.execute(aContext(), { productId: p.id, value: '7501234567890', kind: CodeKind.EAN });
    expect(await t.listCodes.execute(aContext(), p.id)).toHaveLength(1);
  });

  it('C-2 · the same code on another product names the one that holds it', async () => {
    const t = build();
    const tor = await t.create.execute(aContext(), TOR);
    const other = await t.create.execute(aContext(), { ...TOR, sku: 'OTRO-1' });
    await t.add.execute(aContext(), { productId: tor.id, value: '7501', kind: CodeKind.EAN });
    const failure = t.add.execute(aContext(), { productId: other.id, value: '7501', kind: CodeKind.EAN });
    await expect(failure).rejects.toMatchObject({ type: 'code-taken', status: 409 });
    await expect(failure).rejects.toThrow(/TOR-M8/);
  });

  it('removes a code, and removing it twice is a 404', async () => {
    const t = build();
    const p = await t.create.execute(aContext(), TOR);
    const code = await t.add.execute(aContext(), { productId: p.id, value: '7501', kind: CodeKind.EAN });
    await t.remove.execute(aContext(), p.id, code.id);
    await expect(t.remove.execute(aContext(), p.id, code.id)).rejects.toMatchObject({
      type: 'code-not-found',
    });
  });

  it('an OPERATOR reads codes but does not touch them', async () => {
    const t = build();
    const p = await t.create.execute(aContext(), TOR);
    await expect(t.listCodes.execute(aContext([Role.OPERATOR]), p.id)).resolves.toEqual([]);
    await expect(
      t.add.execute(aContext([Role.OPERATOR]), { productId: p.id, value: 'X', kind: CodeKind.OTHER }),
    ).rejects.toMatchObject({ type: 'insufficient-role' });
  });

  it('a code for a product that is not there is a 404', async () => {
    const t = build();
    await expect(
      t.add.execute(aContext(), { productId: 'nope' as ProductId, value: 'X', kind: CodeKind.OTHER }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(t.listCodes.execute(aContext(), 'nope' as ProductId)).rejects.toMatchObject({ status: 404 });
    await expect(
      t.remove.execute(aContext(), 'nope' as ProductId, 'x' as ProductCodeId),
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe('ResolveCode · the scan in the aisle', () => {
  it('resolves by product code', async () => {
    const t = build();
    const p = await t.create.execute(aContext(), TOR);
    await t.add.execute(aContext(), { productId: p.id, value: '7501234567890', kind: CodeKind.EAN });
    const r = await t.resolve.execute(aContext(), '7501234567890');
    expect(r?.product.sku).toBe('TOR-M8');
    expect(r?.batch).toBeUndefined();
  });

  it('resolves by serial, and hands back the product and the unit', async () => {
    const t = build();
    const tal = await t.create.execute(aContext(), TAL);
    await t.createBatch.execute(aContext(), { productId: tal.id, serial: 'BSH-001' });
    const r = await t.resolve.execute(aContext(), 'BSH-001');
    expect(r?.product.sku).toBe('TAL-1');
    expect(r?.batch?.serial).toBe('BSH-001');
  });

  it('resolves by SKU, so a spreadsheet works as well as a scanner', async () => {
    const t = build();
    await t.create.execute(aContext(), TOR);
    expect((await t.resolve.execute(aContext(), 'tor-m8'))?.product.sku).toBe('TOR-M8');
  });

  it('ignores the whitespace a reader adds', async () => {
    const t = build();
    const p = await t.create.execute(aContext(), TOR);
    await t.add.execute(aContext(), { productId: p.id, value: '7501', kind: CodeKind.EAN });
    expect((await t.resolve.execute(aContext(), '  7501\n'))?.product.id).toBe(p.id);
  });

  it('a lot code does not resolve: without a product it is ambiguous', async () => {
    const t = build();
    const lec = await t.create.execute(aContext(), {
      sku: 'LEC-1', name: 'Leche', trackingMode: TrackingMode.LOT, uom: 'L',
    });
    await t.createBatch.execute(aContext(), { productId: lec.id, lotCode: 'L-2026-09' });
    expect(await t.resolve.execute(aContext(), 'L-2026-09')).toBeNull();
  });

  it('returns null when nothing matches: not finding a code is a normal outcome', async () => {
    const t = build();
    expect(await t.resolve.execute(aContext(), 'NOEXISTE')).toBeNull();
    expect(await t.resolve.execute(aContext(), '   ')).toBeNull();
  });

  it('an OPERATOR scans: it is the reading the whole warehouse does', async () => {
    const t = build();
    await t.create.execute(aContext(), TOR);
    await expect(t.resolve.execute(aContext([Role.OPERATOR]), 'TOR-M8')).resolves.not.toBeNull();
  });
});

describe('ResolveCode when the data is half there', () => {
  it('a code pointing at a product that is gone falls through to the next attempt', async () => {
    const t = build();
    const p = await t.create.execute(aContext(), TOR);
    await t.add.execute(aContext(), { productId: p.id, value: 'HUERFANO', kind: CodeKind.OTHER });
    t.products.rows.clear();
    expect(await t.resolve.execute(aContext(), 'HUERFANO')).toBeNull();
  });

  it('a serial pointing at a product that is gone does the same', async () => {
    const t = build();
    const tal = await t.create.execute(aContext(), TAL);
    await t.createBatch.execute(aContext(), { productId: tal.id, serial: 'BSH-001' });
    t.products.rows.clear();
    expect(await t.resolve.execute(aContext(), 'BSH-001')).toBeNull();
  });

  it('something that could never be a SKU is simply not found', async () => {
    const t = build();
    expect(await t.resolve.execute(aContext(), 'con espacios')).toBeNull();
  });
});
