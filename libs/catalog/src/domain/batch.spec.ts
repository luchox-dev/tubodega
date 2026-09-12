import { v7 } from 'uuid';
import { Batch, CustomType, TrackingMode, type BatchId } from '@app/catalog';
import { aCustomField } from '../../test/builders/a-custom-field.js';
import { aProduct } from '../../test/builders/a-product.js';

const make = (over: Parameters<typeof Batch.create>[0] extends infer T ? Partial<T> : never, defs = []) =>
  Batch.create({ id: v7() as BatchId, product: aProduct(), ...over } as Parameters<typeof Batch.create>[0], defs);

describe('Batch.create', () => {
  it('C-4 · a QUANTITY product has no batches at all', () => {
    const r = make({ product: aProduct({ trackingMode: TrackingMode.QUANTITY }), lotCode: 'L-1' });
    expect(r.ok).toBe(false);
    expect((r as { error: { type: string } }).error.type).toBe('batch-not-allowed');
  });

  it('C-3 · a LOT product needs a lot code', () => {
    const product = aProduct({ trackingMode: TrackingMode.LOT });
    expect(make({ product, serial: 'S-1' }).ok).toBe(false);
    expect((make({ product, serial: 'S-1' }) as { error: { type: string } }).error.type).toBe('batch-required');
    expect(make({ product, lotCode: 'L-2026-09' }).ok).toBe(true);
  });

  it('C-3 · a SERIAL product needs a serial', () => {
    const product = aProduct({ trackingMode: TrackingMode.SERIAL });
    expect(make({ product, lotCode: 'L-1' }).ok).toBe(false);
    expect(make({ product, serial: 'BSH-001' }).ok).toBe(true);
  });

  it('blank is the same as absent', () => {
    const product = aProduct({ trackingMode: TrackingMode.LOT });
    expect(make({ product, lotCode: '   ' }).ok).toBe(false);
    expect(((make({ product, lotCode: ' L-1 ' }) as { value: Batch }).value).lotCode).toBe('L-1');
  });

  it('validates its own custom fields against the BATCH definitions', () => {
    const def = aCustomField({ key: 'temperatura', type: CustomType.NUMBER });
    const product = aProduct({ trackingMode: TrackingMode.LOT });
    expect(make({ product, lotCode: 'L-1', customFields: { temperatura: '4' } }, [def] as never).ok).toBe(false);
    expect(make({ product, lotCode: 'L-1', customFields: { temperatura: 4 } }, [def] as never).ok).toBe(true);
  });
});

describe('Batch expiry', () => {
  const at = new Date('2026-09-12T12:00:00.000Z');
  const withExpiry = (expiresAt?: Date) =>
    (make({ product: aProduct({ trackingMode: TrackingMode.LOT }), lotCode: 'L-1', expiresAt }) as { value: Batch }).value;

  it('a batch without an expiry date never expires', () => {
    const b = withExpiry();
    expect(b.isExpired(at)).toBe(false);
    expect(b.expiresWithin(365, at)).toBe(false);
  });

  it('the exact instant of expiry counts as expired', () => {
    expect(withExpiry(new Date(at)).isExpired(at)).toBe(true);
    expect(withExpiry(new Date(at.getTime() + 1)).isExpired(at)).toBe(false);
  });

  it('expiresWithin is true at the exact edge of the window', () => {
    const b = withExpiry(new Date(at.getTime() + 7 * 86_400_000));
    expect(b.expiresWithin(7, at)).toBe(true);
    expect(b.expiresWithin(6, at)).toBe(false);
  });

  it('and stays true once expired: an alert that goes quiet helps nobody', () => {
    expect(withExpiry(new Date(at.getTime() - 86_400_000)).expiresWithin(7, at)).toBe(true);
  });
});

describe('Batch rehydration', () => {
  it('trusts the row, serial included', () => {
    const product = aProduct({ trackingMode: TrackingMode.SERIAL });
    const b = (make({ product, serial: 'BSH-001' }) as { value: Batch }).value;
    const back = Batch.rehydrate({ ...b, lotCode: b.lotCode, serial: b.serial, expiresAt: b.expiresAt });
    expect(back.serial).toBe('BSH-001');
    expect(back.lotCode).toBeUndefined();
  });
});
