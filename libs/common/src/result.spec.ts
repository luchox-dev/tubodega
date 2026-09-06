import { DomainError } from './domain-error.js';
import { err, ok, unwrap } from './result.js';

class Boom extends DomainError {
  readonly type = 'boom';
  readonly status = 422;
}

describe('Result', () => {
  it('ok wraps a value', () => {
    expect(ok(1)).toEqual({ ok: true, value: 1 });
  });

  it('err wraps a DomainError that unwrap throws', () => {
    const e = err(new Boom('x'));
    expect(e.ok).toBe(false);
    expect(() => unwrap(e)).toThrow(Boom);
  });

  it('unwrap returns the value', () => {
    expect(unwrap(ok('v'))).toBe('v');
  });

  it('DomainError exposes type, status, name and extras', () => {
    const e = new Boom('detail', { errors: [{ pointer: '/q', code: 'bad' }], extensions: { a: 1 } });
    expect(e.type).toBe('boom');
    expect(e.status).toBe(422);
    expect(e.name).toBe('Boom');
    expect(e.message).toBe('detail');
    expect(e.errors?.[0].pointer).toBe('/q');
    expect(e.extensions).toEqual({ a: 1 });
  });
});
