import { MissingIfMatchError, parseIfMatch } from './if-match.js';

describe('parseIfMatch', () => {
  it.each([
    ['"3"', 3],
    ['3', 3],
    ['W/"3"', 3],
    [' "12" ', 12],
  ])('accepts %s', (header, expected) => expect(parseIfMatch(header)).toBe(expected));

  it.each([[undefined], [''], ['"abc"'], ['*'], ['"-1"'], ['"1.5"']])('rejects %s', (header) => {
    expect(() => parseIfMatch(header)).toThrow(MissingIfMatchError);
  });

  it('is a 400 that names the header', () => {
    try {
      parseIfMatch(undefined);
      expect.unreachable();
    } catch (e) {
      expect((e as MissingIfMatchError).status).toBe(400);
      expect((e as MissingIfMatchError).type).toBe('missing-if-match');
    }
  });
});
