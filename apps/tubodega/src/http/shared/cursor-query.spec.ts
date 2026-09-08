import type { Cursor } from '@app/common';
import { InvalidFilterError, parsePage } from './cursor-query.js';

const opts = { sortable: ['name', 'email'], defaultSort: 'name', filters: ['active', 'role'] } as const;

describe('parsePage', () => {
  it('defaults to 50 items ordered by the declared default, ascending', () => {
    expect(parsePage({}, opts)).toEqual({ limit: 50, sort: { field: 'name', dir: 'asc' } });
  });

  it('takes limit and cursor', () => {
    const cursor = 'W3siYSI6MX1d' as Cursor;
    expect(parsePage({ limit: '25', cursor }, opts)).toEqual({
      limit: 25,
      cursor,
      sort: { field: 'name', dir: 'asc' },
    });
    expect(parsePage({ limit: '200' }, opts).limit).toBe(200);
  });

  it.each([['0'], ['201'], ['-1'], ['abc'], ['1.5']])('rejects limit=%s', (limit) => {
    expect(() => parsePage({ limit }, opts)).toThrow(InvalidFilterError);
  });

  it('a leading minus is descending', () => {
    expect(parsePage({ sort: '-name' }, opts).sort).toEqual({ field: 'name', dir: 'desc' });
    expect(parsePage({ sort: 'email' }, opts).sort).toEqual({ field: 'email', dir: 'asc' });
  });

  it('an undeclared sort field is rejected, not ignored', () => {
    expect(() => parsePage({ sort: 'passwordHash' }, opts)).toThrow(InvalidFilterError);
    expect(() => parsePage({ sort: '-createdAt' }, opts)).toThrow(InvalidFilterError);
  });

  it('declared filters pass through; anything else is rejected', () => {
    expect(() => parsePage({ role: 'OPERATOR', active: 'true' }, opts)).not.toThrow();
    expect(() => parsePage({ foo: '1' }, opts)).toThrow(InvalidFilterError);
  });

  it('T-4 · orgId in the query is an undeclared filter, not a way in', () => {
    expect(() => parsePage({ orgId: 'other-org' }, opts)).toThrow(InvalidFilterError);
  });

  it('the error says which parameter it was', () => {
    try {
      parsePage({ foo: '1' }, opts);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(InvalidFilterError);
      expect((e as InvalidFilterError).errors).toEqual([{ pointer: '/foo', code: 'invalid-filter' }]);
      expect((e as InvalidFilterError).status).toBe(400);
      expect((e as InvalidFilterError).type).toBe('invalid-filter');
    }
  });
});
