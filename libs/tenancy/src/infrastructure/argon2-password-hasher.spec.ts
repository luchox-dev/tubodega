import { Argon2PasswordHasher } from './argon2-password-hasher.js';

describe('Argon2PasswordHasher', () => {
  const hasher = new Argon2PasswordHasher();
  it('verifies the right password and rejects the wrong one', async () => {
    const h = await hasher.hash('correcthorse1');
    expect(h).toMatch(/^\$argon2/);
    expect(await hasher.verify('correcthorse1', h)).toBe(true);
    expect(await hasher.verify('wrong', h)).toBe(false);
    expect(await hasher.verify('x', 'not-a-hash')).toBe(false);
  });
});
