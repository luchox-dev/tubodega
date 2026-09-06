import type { Cursor } from './page.js';
import { decodeCursor, encodeCursor } from './page.js';

describe('Cursor', () => {
  it('round-trips its parts', () => {
    const c = encodeCursor(['2026-09-06T00:00:00.000Z', 'abc', null, 3]);
    expect(decodeCursor(c)).toEqual(['2026-09-06T00:00:00.000Z', 'abc', null, 3]);
  });

  it('is url-safe', () => {
    expect(encodeCursor(['a/b+c'])).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('returns null for garbage', () => {
    expect(decodeCursor('***' as Cursor)).toBeNull();
    expect(decodeCursor(Buffer.from('{"x":1}').toString('base64url') as Cursor)).toBeNull();
  });
});
