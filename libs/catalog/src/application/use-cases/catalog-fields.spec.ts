import { CustomEntity, CustomType, TrackingMode, type CustomFieldId, type ProductId } from '@app/catalog';
import { Role } from '@app/tenancy';
import { aContext } from '../../../test/builders/a-context.js';
import {
  InMemoryBatchRepository, InMemoryCustomFieldRepository, InMemoryProductCodeRepository,
  InMemoryProductRepository, RecordingEventPublisher, fakeIds, fakeUow, fixedClock,
} from '../../../test/doubles/in-memory.js';
import { CreateBatch } from './create-batch.js';
import { CreateProduct } from './create-product.js';
import { DefineCustomField } from './define-custom-field.js';
import { ListBatches } from './list-batches.js';
import { ListCustomFields } from './list-custom-fields.js';
import { UpdateCustomField } from './update-custom-field.js';

const build = () => {
  const products = new InMemoryProductRepository();
  const batches = new InMemoryBatchRepository();
  const fields = new InMemoryCustomFieldRepository();
  const codes = new InMemoryProductCodeRepository();
  const events = new RecordingEventPublisher();
  return {
    products, batches, fields, events,
    create: new CreateProduct(products, codes, fields, events, fakeIds, fixedClock, fakeUow),
    createBatch: new CreateBatch(products, batches, fields, events, fakeIds, fixedClock),
    listBatches: new ListBatches(products, batches),
    define: new DefineCustomField(fields, events, fakeIds, fixedClock),
    update: new UpdateCustomField(fields),
    list: new ListCustomFields(fields),
  };
};

const LEC = { sku: 'LEC-1', name: 'Leche entera', trackingMode: TrackingMode.LOT, uom: 'L' };
const TAL = { sku: 'TAL-1', name: 'Taladro', trackingMode: TrackingMode.SERIAL, uom: 'UNIT' };
const TOR = { sku: 'TOR-M8', name: 'Tornillo', trackingMode: TrackingMode.QUANTITY, uom: 'UNIT' };

describe('CreateBatch', () => {
  it('an OPERATOR creates the lot that arrives with the goods', async () => {
    const t = build();
    const lec = await t.create.execute(aContext(), LEC);
    const batch = await t.createBatch.execute(aContext([Role.OPERATOR]), {
      productId: lec.id,
      lotCode: 'L-2026-09',
      expiresAt: new Date('2026-10-01T00:00:00.000Z'),
    });
    expect(batch.lotCode).toBe('L-2026-09');
    expect(t.events.types()).toContain('batch.created');
  });

  it('but a VIEWER does not', async () => {
    const t = build();
    const lec = await t.create.execute(aContext(), LEC);
    await expect(
      t.createBatch.execute(aContext([Role.VIEWER]), { productId: lec.id, lotCode: 'L-1' }),
    ).rejects.toMatchObject({ type: 'insufficient-role' });
  });

  it('C-4 · a QUANTITY product admits no lots', async () => {
    const t = build();
    const tor = await t.create.execute(aContext(), TOR);
    await expect(
      t.createBatch.execute(aContext(), { productId: tor.id, lotCode: 'L-1' }),
    ).rejects.toMatchObject({ type: 'batch-not-allowed' });
  });

  it('C-3 · a LOT product without a lot code is rejected', async () => {
    const t = build();
    const lec = await t.create.execute(aContext(), LEC);
    await expect(t.createBatch.execute(aContext(), { productId: lec.id })).rejects.toMatchObject({
      type: 'batch-required',
    });
  });

  it('C-5 · the serial is unique across the organization', async () => {
    const t = build();
    const tal = await t.create.execute(aContext(), TAL);
    const otro = await t.create.execute(aContext(), { ...TAL, sku: 'TAL-2' });
    await t.createBatch.execute(aContext(), { productId: tal.id, serial: 'BSH-001' });
    await expect(
      t.createBatch.execute(aContext(), { productId: otro.id, serial: 'BSH-001' }),
    ).rejects.toMatchObject({ type: 'serial-taken' });
  });

  it('C-6 · the lot code is unique per product, and only per product', async () => {
    const t = build();
    const lec = await t.create.execute(aContext(), LEC);
    const otra = await t.create.execute(aContext(), { ...LEC, sku: 'LEC-2' });
    await t.createBatch.execute(aContext(), { productId: lec.id, lotCode: 'L-2026-09' });
    await expect(
      t.createBatch.execute(aContext(), { productId: lec.id, lotCode: 'L-2026-09' }),
    ).rejects.toMatchObject({ type: 'lot-code-taken' });
    await expect(
      t.createBatch.execute(aContext(), { productId: otra.id, lotCode: 'L-2026-09' }),
    ).resolves.toBeDefined();
  });

  it('lists the batches of a product, and 404s for one that is not there', async () => {
    const t = build();
    const lec = await t.create.execute(aContext(), LEC);
    await t.createBatch.execute(aContext(), { productId: lec.id, lotCode: 'L-1' });
    expect(await t.listBatches.execute(aContext(), lec.id)).toHaveLength(1);
    await expect(t.listBatches.execute(aContext(), 'nope' as ProductId)).rejects.toMatchObject({
      status: 404,
    });
    await expect(
      t.createBatch.execute(aContext(), { productId: 'nope' as ProductId, lotCode: 'L' }),
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe('custom field definitions', () => {
  const TEXT = { entity: CustomEntity.PRODUCT, key: 'proveedor', label: 'Proveedor', type: CustomType.TEXT };

  it('defines a field and announces it', async () => {
    const t = build();
    const def = await t.define.execute(aContext(), TEXT);
    expect(def.key).toBe('proveedor');
    expect(t.events.types()).toEqual(['custom_field.defined']);
  });

  it('lists them in the order the organization chose', async () => {
    const t = build();
    await t.define.execute(aContext(), { ...TEXT, key: 'segundo', position: 2 });
    await t.define.execute(aContext(), { ...TEXT, key: 'primero', position: 1 });
    expect((await t.list.execute(aContext(), CustomEntity.PRODUCT)).map((d) => d.key)).toEqual([
      'primero',
      'segundo',
    ]);
  });

  it('C-10 · a required field is refused while entities are missing it', async () => {
    const t = build();
    t.fields.missing = 2;
    const failure = t.define.execute(aContext(), { ...TEXT, key: 'ubicacion_fiscal', required: true });
    await expect(failure).rejects.toMatchObject({ type: 'required-field-would-invalidate' });
    await expect(failure).rejects.toThrow(/2 entidades/);
  });

  it('C-10 · and accepted once everyone has a value', async () => {
    const t = build();
    t.fields.missing = 0;
    await expect(
      t.define.execute(aContext(), { ...TEXT, key: 'ubicacion_fiscal', required: true }),
    ).resolves.toBeDefined();
  });

  it('C-10 · the same rule applies when an existing field becomes required', async () => {
    const t = build();
    const def = await t.define.execute(aContext(), TEXT);
    t.fields.missing = 5;
    await expect(
      t.update.execute(aContext(), { id: def.id, required: true, expectedVersion: 1 }),
    ).rejects.toMatchObject({ type: 'required-field-would-invalidate' });
  });

  it('the label changes freely', async () => {
    const t = build();
    const def = await t.define.execute(aContext(), TEXT);
    const next = await t.update.execute(aContext(), {
      id: def.id,
      label: 'Proveedor principal',
      expectedVersion: 1,
    });
    expect(next.label).toBe('Proveedor principal');
  });

  it('D-10 · the type changes while nobody has a value', async () => {
    const t = build();
    const def = await t.define.execute(aContext(), { ...TEXT, key: 'familia', type: CustomType.TEXT });
    t.fields.used = 0;
    await expect(
      t.update.execute(aContext(), { id: def.id, type: CustomType.NUMBER, expectedVersion: 1 }),
    ).resolves.toBeDefined();
  });

  it('D-10 · and not once somebody does', async () => {
    const t = build();
    const def = await t.define.execute(aContext(), { ...TEXT, key: 'familia' });
    t.fields.used = 5;
    const failure = t.update.execute(aContext(), {
      id: def.id,
      type: CustomType.NUMBER,
      expectedVersion: 1,
    });
    await expect(failure).rejects.toMatchObject({ type: 'custom-field-type-locked' });
    await expect(failure).rejects.toThrow(/5 entidades/);
  });

  it('setting the same type again is not a change', async () => {
    const t = build();
    const def = await t.define.execute(aContext(), TEXT);
    t.fields.used = 99;
    await expect(
      t.update.execute(aContext(), { id: def.id, type: CustomType.TEXT, expectedVersion: 1 }),
    ).resolves.toBeDefined();
  });

  it('a definition that is not there is a 404', async () => {
    const t = build();
    await expect(
      t.update.execute(aContext(), { id: 'nope' as CustomFieldId, label: 'x', expectedVersion: 1 }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('a SELECT needs its options', async () => {
    const t = build();
    await expect(
      t.define.execute(aContext(), { ...TEXT, key: 'familia', type: CustomType.SELECT }),
    ).rejects.toMatchObject({ type: 'invalid-custom-field' });
  });

  it('a VIEWER reads the definitions but does not write them', async () => {
    const t = build();
    await expect(t.list.execute(aContext([Role.VIEWER]), CustomEntity.PRODUCT)).resolves.toEqual([]);
    await expect(t.define.execute(aContext([Role.VIEWER]), TEXT)).rejects.toMatchObject({
      type: 'insufficient-role',
    });
  });
});

describe('more edges of the definitions', () => {
  it('a field that is already required stays required without counting anything', async () => {
    const t = build();
    t.fields.missing = 0;
    const def = await t.define.execute(aContext(), {
      entity: CustomEntity.PRODUCT, key: 'proveedor', label: 'Proveedor',
      type: CustomType.TEXT, required: true,
    });
    t.fields.missing = 99;
    await expect(
      t.update.execute(aContext(), { id: def.id, required: true, expectedVersion: 1 }),
    ).resolves.toMatchObject({ required: true });
  });
});
