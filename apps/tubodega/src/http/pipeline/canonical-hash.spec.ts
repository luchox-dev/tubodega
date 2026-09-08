import { canonicalHash } from './canonical-hash.js';

describe('canonicalHash', () => {
  it('is stable under key order, at any depth', () => {
    expect(canonicalHash({ a: 1, b: { c: 2, d: 3 } })).toBe(canonicalHash({ b: { d: 3, c: 2 }, a: 1 }));
  });

  it('is not stable under array order: a list is data, not a set', () => {
    expect(canonicalHash({ roles: ['OWNER', 'ADMIN'] })).not.toBe(canonicalHash({ roles: ['ADMIN', 'OWNER'] }));
  });

  it('drops undefined and keeps null: they are different requests', () => {
    expect(canonicalHash({ a: 1, b: undefined })).toBe(canonicalHash({ a: 1 }));
    expect(canonicalHash({ a: 1, b: null })).not.toBe(canonicalHash({ a: 1 }));
  });

  it('different bodies give different hashes', () => {
    expect(canonicalHash({ email: 'a@x.co' })).not.toBe(canonicalHash({ email: 'b@x.co' }));
    expect(canonicalHash({ n: 1 })).not.toBe(canonicalHash({ n: '1' }));
  });

  it('an absent body hashes like an empty one, and always the same', () => {
    expect(canonicalHash(undefined)).toBe(canonicalHash(undefined));
    expect(canonicalHash(undefined)).not.toBe(canonicalHash({}));
  });

  it('multipart is hashed by its bytes', () => {
    expect(canonicalHash(Buffer.from('abc'))).toBe(canonicalHash(Buffer.from('abc')));
    expect(canonicalHash(Buffer.from('abc'))).not.toBe(canonicalHash(Buffer.from('abd')));
  });

  it('is a SHA-256 in hex', () => {
    expect(canonicalHash({ a: 1 })).toMatch(/^[0-9a-f]{64}$/);
  });
});
