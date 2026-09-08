import { ResourceNotFoundError, UuidParam } from './uuid-param.pipe.js';

describe('UuidParam', () => {
  const pipe = new UuidParam();

  it('lets a UUIDv7 through unchanged', () => {
    const id = '018f3a2b-7c4d-7000-8000-a1b2c3d4e5f6';
    expect(pipe.transform(id)).toBe(id);
  });

  it.each([['no-es-uuid'], ['123'], [''], ['018f3a2b-7c4d-7000-8000'], ['018f3a2b7c4d70008000a1b2c3d4e5f6']])(
    'turns %s into a 404, never a database error',
    (value) => {
      expect(() => pipe.transform(value)).toThrow(ResourceNotFoundError);
      try {
        pipe.transform(value);
      } catch (e) {
        expect((e as ResourceNotFoundError).status).toBe(404);
        expect((e as ResourceNotFoundError).type).toBe('not-found');
      }
    },
  );
});
