import { CustomEntity, CustomType, SkuTakenError, TrackingMode } from '@app/catalog';
import { Role } from '@app/tenancy';
import { aContext } from '../../../test/builders/a-context.js';
import { aCustomField } from '../../../test/builders/a-custom-field.js';
import {
  InMemoryCustomFieldRepository, InMemoryProductCodeRepository, InMemoryProductRepository,
  RecordingEventPublisher, fakeIds, fixedClock,
} from '../../../test/doubles/in-memory.js';
import { ImportProducts, MAX_IMPORT_ROWS, type ProductRow } from './import-products.js';

const build = () => {
  const products = new InMemoryProductRepository();
  const codes = new InMemoryProductCodeRepository();
  const fields = new InMemoryCustomFieldRepository();
  const events = new RecordingEventPublisher();
  return {
    products, codes, fields, events,
    imp: new ImportProducts(products, codes, fields, events, fakeIds, fixedClock),
  };
};

const row = (over: Partial<ProductRow> = {}): ProductRow => ({ sku: 'TOR-M8', name: 'Tornillo', ...over });

describe('ImportProducts · the onboarding', () => {
  it('creates what is new and counts it', async () => {
    const t = build();
    const r = await t.imp.execute(aContext(), [row(), row({ sku: 'LEC-1', name: 'Leche' })]);
    expect(r).toMatchObject({ created: 2, updated: 0, errors: [] });
  });

  it('re-importing updates instead of duplicating', async () => {
    const t = build();
    await t.imp.execute(aContext(), [row()]);
    const r = await t.imp.execute(aContext(), [row({ name: 'Tornillo NUEVO' })]);
    expect(r).toMatchObject({ created: 0, updated: 1 });
    expect(t.products.rows.size).toBe(1);
    expect((await t.products.findBySku(aContext().orgId, 'TOR-M8'))!.name).toBe('Tornillo NUEVO');
  });

  it('an absent column does not overwrite what the product already had', async () => {
    const t = build();
    await t.imp.execute(aContext(), [row({ uom: 'KG', description: 'Rosca fina' })]);
    await t.imp.execute(aContext(), [{ sku: 'TOR-M8' }]);
    const p = (await t.products.findBySku(aContext().orgId, 'TOR-M8'))!;
    expect(p.uom).toBe('KG');
    expect(p.description).toBe('Rosca fina');
    expect(p.name).toBe('Tornillo');
  });

  it('one bad row does not abort the batch, and says which line it was', async () => {
    const t = build();
    t.fields.add(aCustomField({ key: 'familia', type: CustomType.SELECT, options: ['ferretería'] }));
    const r = await t.imp.execute(aContext(), [
      row({ sku: 'A-1' }),
      { sku: '' },
      row({ sku: 'B-1', customFields: { familia: 'lácteos' } }),
      row({ sku: 'C-1' }),
    ]);

    expect(r.created).toBe(2);
    expect(r.errors).toHaveLength(2);
    expect(r.errors[0]).toMatchObject({ line: 2, type: 'validation-failed' });
    expect(r.errors[1]).toMatchObject({ line: 3, sku: 'B-1', type: 'invalid-custom-field' });
  });

  it('a SKU with whitespace inside is reported, not silently normalised away', async () => {
    const t = build();
    const r = await t.imp.execute(aContext(), [{ sku: 'TOR M8' }]);
    expect(r.created).toBe(0);
    expect(r.errors[0]).toMatchObject({ line: 1, sku: 'TOR M8', type: 'validation-failed' });
  });

  it('lower-case and upper-case are the same SKU, so a re-import matches', async () => {
    const t = build();
    await t.imp.execute(aContext(), [{ sku: 'tor-m8', name: 'Tornillo' }]);
    const r = await t.imp.execute(aContext(), [{ sku: 'TOR-M8', name: 'Tornillo' }]);
    expect(r).toMatchObject({ created: 0, updated: 1 });
  });

  it('brings the codes along, and a repeat of the same code is not an error', async () => {
    const t = build();
    await t.imp.execute(aContext(), [row({ codes: ['7501', 'QR-1'] })]);
    const p = (await t.products.findBySku(aContext().orgId, 'TOR-M8'))!;
    expect(await t.codes.listByProduct(p.orgId, p.id)).toHaveLength(2);
    const again = await t.imp.execute(aContext(), [row({ codes: ['7501'] })]);
    expect(again.errors).toEqual([]);
  });

  it("a code another product holds is reported next to its line, and the row still counts", async () => {
    const t = build();
    t.codes.skuOf = (id) => [...t.products.rows.values()].find((p) => p.id === id)?.sku;
    await t.imp.execute(aContext(), [row({ sku: 'A-1', codes: ['7501'] })]);
    const r = await t.imp.execute(aContext(), [row({ sku: 'B-1', codes: ['7501'] })]);
    expect(r.created).toBe(1);
    expect(r.errors[0]).toMatchObject({ line: 1, sku: 'B-1', type: 'code-taken' });
  });

  it('defaults a new product to QUANTITY, UNIT and its own SKU as the name', async () => {
    const t = build();
    await t.imp.execute(aContext(), [{ sku: 'X-1' }]);
    const p = (await t.products.findBySku(aContext().orgId, 'X-1'))!;
    expect(p.trackingMode).toBe(TrackingMode.QUANTITY);
    expect(p.uom).toBe('UNIT');
    expect(p.name).toBe('X-1');
  });

  it('takes the custom fields it is given', async () => {
    const t = build();
    t.fields.add(aCustomField({ key: 'proveedor', type: CustomType.TEXT, entity: CustomEntity.PRODUCT }));
    await t.imp.execute(aContext(), [row({ customFields: { proveedor: 'Mundial' } })]);
    const p = (await t.products.findBySku(aContext().orgId, 'TOR-M8'))!;
    expect(p.customFields.toJSON()).toEqual({ proveedor: 'Mundial' });
  });

  it('D-11 · beyond a thousand rows it stops being an import', async () => {
    const t = build();
    const many = Array.from({ length: MAX_IMPORT_ROWS + 1 }, (_, i) => row({ sku: `S-${i}` }));
    await expect(t.imp.execute(aContext(), many)).rejects.toMatchObject({ type: 'import-too-large' });
  });

  it('a thousand exactly is still an import', async () => {
    const t = build();
    const many = Array.from({ length: MAX_IMPORT_ROWS }, (_, i) => row({ sku: `S-${i}` }));
    await expect(t.imp.execute(aContext(), many)).resolves.toMatchObject({ created: MAX_IMPORT_ROWS });
  });

  it('an empty batch does nothing and announces nothing', async () => {
    const t = build();
    expect(await t.imp.execute(aContext(), [])).toEqual({ created: 0, updated: 0, errors: [] });
    expect(t.events.published).toEqual([]);
  });

  it('an OPERATOR does not import the catalogue', async () => {
    const t = build();
    await expect(t.imp.execute(aContext([Role.OPERATOR]), [row()])).rejects.toMatchObject({
      type: 'insufficient-role',
    });
  });
});

describe('the rows the import has to survive', () => {
  it('an unusable code is reported and the product still lands', async () => {
    const t = build();
    const r = await t.imp.execute(aContext(), [row({ codes: ['x'.repeat(129)] })]);
    expect(r.created).toBe(1);
    expect(r.errors[0]).toMatchObject({ line: 1, sku: 'TOR-M8', type: 'validation-failed' });
  });

  it('a SKU that collides mid-batch is reported, not thrown', async () => {
    const t = build();
    const clashing = new InMemoryProductRepository();
    clashing.save = async () => {
      throw new SkuTakenError('TOR-M8');
    };
    const imp = new ImportProducts(clashing, t.codes, t.fields, t.events, fakeIds, fixedClock);
    const r = await imp.execute(aContext(), [row()]);
    expect(r).toMatchObject({ created: 0, updated: 0 });
    expect(r.errors[0]).toMatchObject({ line: 1, type: 'sku-taken' });
  });
});
