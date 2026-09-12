import { v7 } from 'uuid';
import { CodeKind, ProductCode, type ProductCodeId, type ProductId } from '@app/catalog';
import { ORG } from '../../test/builders/a-custom-field.js';

describe('ProductCode', () => {
  const make = (value: string) =>
    ProductCode.create({
      id: v7() as ProductCodeId,
      orgId: ORG,
      productId: v7() as ProductId,
      value,
      kind: CodeKind.EAN,
    });

  it('normalises the whitespace a scanner adds', () => {
    expect((make(' 7501234567890\n') as { value: ProductCode }).value.value).toBe('7501234567890');
  });

  it('but keeps the case: codes are not SKUs', () => {
    expect((make('qr-AbC') as { value: ProductCode }).value.value).toBe('qr-AbC');
  });

  it('rejects empty and over-long codes', () => {
    expect(make('   ').ok).toBe(false);
    expect(make('x'.repeat(129)).ok).toBe(false);
    expect(make('x'.repeat(128)).ok).toBe(true);
  });

  it('rehydration trusts the row', () => {
    const id = v7() as ProductCodeId;
    const back = ProductCode.rehydrate({ id, orgId: ORG, productId: v7() as ProductId, value: 'X', kind: CodeKind.UPC });
    expect(back.kind).toBe(CodeKind.UPC);
  });
});
