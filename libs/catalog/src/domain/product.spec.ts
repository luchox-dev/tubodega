import { v7 } from 'uuid';
import { CustomType, FieldKey, Product, Sku, TrackingMode, Uom, UnitOfMeasure, type ProductId } from '@app/catalog';
import { ORG, aCustomField } from '../../test/builders/a-custom-field.js';
import { aProduct } from '../../test/builders/a-product.js';

describe('Sku', () => {
  it('is upper-cased and trimmed: a label and a spreadsheet mean the same SKU', () => {
    expect((Sku.of('  tor-m8 ') as { value: string }).value).toBe('TOR-M8');
  });

  it('rejects whitespace inside, which is how a bad paste announces itself', () => {
    expect(Sku.of('TOR M8').ok).toBe(false);
    expect(Sku.of('').ok).toBe(false);
    expect(Sku.of('x'.repeat(65)).ok).toBe(false);
  });

  it('64 characters is still a SKU', () => {
    expect(Sku.of('x'.repeat(64)).ok).toBe(true);
  });
});

describe('Uom', () => {
  it('takes the nine units of spec 11 §2, case-insensitively', () => {
    expect((Uom.of('kg') as { value: UnitOfMeasure }).value).toBe(UnitOfMeasure.KG);
    expect(Uom.of('DOCENA').ok).toBe(false);
  });
});

describe('Product', () => {
  it('is born active, at version 1', () => {
    const p = aProduct();
    expect(p.active).toBe(true);
    expect(p.version).toBe(1);
  });

  it('C-3/C-4 · requiresBatch answers for the three modes', () => {
    expect(aProduct({ trackingMode: TrackingMode.QUANTITY }).requiresBatch()).toBe(false);
    expect(aProduct({ trackingMode: TrackingMode.LOT }).requiresBatch()).toBe(true);
    expect(aProduct({ trackingMode: TrackingMode.SERIAL }).requiresBatch()).toBe(true);
  });

  it('refuses to be created with an invalid SKU, unit or custom field', () => {
    const base = { id: v7() as ProductId, orgId: ORG, name: 'x', trackingMode: TrackingMode.QUANTITY };
    expect(Product.create({ ...base, sku: 'A B', uom: 'UNIT' }).ok).toBe(false);
    expect(Product.create({ ...base, sku: 'A', uom: 'DOCENA' }).ok).toBe(false);
    expect(
      Product.create({ ...base, sku: 'A', uom: 'UNIT', customFields: { color: 'azul' } }).ok,
    ).toBe(false);
  });

  it('an empty description is no description', () => {
    expect(aProduct({ description: '   ' }).description).toBeUndefined();
  });

  it('update leaves the version alone: the repository owns it', () => {
    const updated = aProduct().update({ name: 'Tornillo M8 galvanizado' });
    expect((updated as { value: Product }).value.name).toBe('Tornillo M8 galvanizado');
    expect((updated as { value: Product }).value.version).toBe(1);
  });

  it('update without a field keeps the old value', () => {
    const p = aProduct({ description: 'Rosca fina' });
    const r = p.update({ name: 'Otro' }) as { value: Product };
    expect(r.value.description).toBe('Rosca fina');
    expect(r.value.uom).toBe(p.uom);
    expect(r.value.trackingMode).toBe(p.trackingMode);
  });

  it('an explicit null clears the description, an absent one does not', () => {
    const p = aProduct({ description: 'Rosca fina' });
    expect(((p.update({ description: null }) as { value: Product }).value).description).toBeUndefined();
    expect(((p.update({}) as { value: Product }).value).description).toBe('Rosca fina');
  });

  it('update revalidates the unit and the custom fields', () => {
    const def = aCustomField({ key: 'peso', type: CustomType.NUMBER });
    const p = aProduct();
    expect(p.update({ uom: 'DOCENA' }).ok).toBe(false);
    expect(p.update({ customFields: { peso: '3' } }, [def]).ok).toBe(false);
    expect(p.update({ customFields: { peso: 3 } }, [def]).ok).toBe(true);
  });

  it('rename trims; deactivate flips active and nothing else', () => {
    const p = aProduct().rename('  Tornillo  ');
    expect(p.name).toBe('Tornillo');
    const off = p.deactivate();
    expect(off.active).toBe(false);
    expect(off.sku).toBe(p.sku);
    expect(off.version).toBe(p.version);
  });

  it('rehydration trusts the row', () => {
    const p = aProduct();
    const back = Product.rehydrate({ ...p, description: p.description });
    expect(back.sku).toBe(p.sku);
    expect(back.active).toBe(p.active);
  });
});

describe('FieldKey', () => {
  it('is snake_case: a label is not a key', () => {
    expect(FieldKey.of('ubicacion_fiscal').ok).toBe(true);
    expect(FieldKey.of('  proveedor ').ok).toBe(true);
    expect(FieldKey.of('Ubicación Fiscal').ok).toBe(false);
    expect(FieldKey.of('9lives').ok).toBe(false);
    expect(FieldKey.of('').ok).toBe(false);
  });
});
