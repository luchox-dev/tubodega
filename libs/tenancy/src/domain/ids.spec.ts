import { Email, Slug } from './ids.js';
import { InvalidEmailError, InvalidSlugError } from './errors.js';

describe('Email.of', () => {
  it('trims and lower-cases', () => {
    const r = Email.of('  Marta@X.com ');
    expect(r.ok && r.value).toBe('marta@x.com');
  });
  it.each(['nope', 'a@b', '@x.co', 'a b@x.co'])('rejects %s', (raw) => {
    const r = Email.of(raw);
    expect(!r.ok && r.error).toBeInstanceOf(InvalidEmailError);
  });
});

describe('Slug.of', () => {
  it.each(['la-esquina', 'abc', 'a-1', 'a'.repeat(64)])('accepts %s', (raw) => {
    expect(Slug.of(raw).ok).toBe(true);
  });
  it.each(['La Esquina', 'ab', 'a'.repeat(65), '-abc', 'abc-', 'abc_def'])('rejects %s', (raw) => {
    const r = Slug.of(raw);
    expect(!r.ok && r.error).toBeInstanceOf(InvalidSlugError);
  });
});
