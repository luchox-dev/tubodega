import type { Cursor } from '@app/common';
import { InvalidFilterError, idFilter, parsePage } from './cursor-query.js';

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

describe('idFilter', () => {
  const id = '018f3a2b-7c4d-7000-8000-a1b2c3d4e5f6';

  it('lets a well-formed identifier through', () => {
    expect(idFilter({ productId: id }, 'productId')).toBe(id);
    expect(idFilter({}, 'productId')).toBeUndefined();
  });

  // Every one of these reached the database and came back as a 500 with
  // `invalid input syntax for type uuid` in the log. The literal "null" is the
  // one that actually happens: a client whose variable came back empty.
  it.each([['null'], ['undefined'], ['no-soy-uuid'], ['123'], [''], ['018f3a2b-7c4d-7000-8000-a1b2c3d4e5f']])(
    'refuses %s as a filter instead of letting the uuid cast blow up',
    (raw) => {
      expect(() => idFilter({ productId: raw }, 'productId')).toThrow(InvalidFilterError);
    },
  );

  it('an array of ids is not an id either', () => {
    expect(() => idFilter({ productId: [id] }, 'productId')).toThrow(InvalidFilterError);
  });
});

describe('parsePage · una colección que no ofrece orden', () => {
  // El saldo: su único orden con sentido es su clave natural. Antes declaraba
  // `sortable: ['nodeId']` y el orden resuelto no llegaba al caso de uso, así
  // que `?sort=-nodeId` devolvía lo mismo que `?sort=nodeId` y el cliente se
  // quedaba creyendo que había ordenado. Aceptar y tirar es lo único inadmisible.
  const sinOrden = { sortable: [] as readonly string[], defaultSort: 'nodeId', filters: ['productId'] } as const;

  it('funciona sin que nadie pida orden', () => {
    expect(parsePage({}, sinOrden)).toEqual({ limit: 50, sort: { field: 'nodeId', dir: 'asc' } });
    expect(parsePage({ limit: '10' }, sinOrden).limit).toBe(10);
  });

  it('sigue paginando', () => {
    const cursor = 'W3siYSI6MX1d' as Cursor;
    expect(parsePage({ cursor }, sinOrden).cursor).toBe(cursor);
  });

  it('y rechaza un sort explícito en vez de descartarlo en silencio', () => {
    expect(() => parsePage({ sort: 'nodeId' }, sinOrden)).toThrow(InvalidFilterError);
    expect(() => parsePage({ sort: '-nodeId' }, sinOrden)).toThrow(InvalidFilterError);
    expect(() => parsePage({ sort: 'loquesea' }, sinOrden)).toThrow(InvalidFilterError);
  });

  it('sigue rechazando los filtros no declarados', () => {
    expect(() => parsePage({ color: 'rojo' }, sinOrden)).toThrow(InvalidFilterError);
  });
});
