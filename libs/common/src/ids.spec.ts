import { isUuid } from './ids.js';

describe('isUuid', () => {
  it('accepts canonical UUIDs of any version', () => {
    expect(isUuid('018f3a2b-7c4d-7000-8000-a1b2c3d4e5f6')).toBe(true);
    expect(isUuid('550E8400-E29B-41D4-A716-446655440000')).toBe(true);
  });
  it('rejects everything else', () => {
    expect(isUuid('req-123')).toBe(false);
    expect(isUuid(42)).toBe(false);
  });
});
