import { NodeCode, NodePath } from './ids.js';

describe('NodeCode', () => {
  it('acepta un código de estante corriente', () => {
    const r = NodeCode.of('B2');
    expect(r.ok && r.value).toBe('B2');
  });

  it('recorta los espacios de los extremos', () => {
    const r = NodeCode.of('  BOD-A  ');
    expect(r.ok && r.value).toBe('BOD-A');
  });

  // '/' is the path separator. Letting it into a code would let a user forge an
  // ancestry that the chain of parents does not back.
  it.each(['BOD-A/Z1', '/', 'a/b/c'])('rechaza «%s» porque lleva la barra del path', (raw) => {
    const r = NodeCode.of(raw);
    expect(r.ok).toBe(false);
  });

  it('rechaza el vacío y el que solo tiene espacios', () => {
    expect(NodeCode.of('').ok).toBe(false);
    expect(NodeCode.of('   ').ok).toBe(false);
  });

  it('rechaza más de 64 caracteres y acepta exactamente 64', () => {
    expect(NodeCode.of('x'.repeat(65)).ok).toBe(false);
    expect(NodeCode.of('x'.repeat(64)).ok).toBe(true);
  });

  it('el error apunta a /code', () => {
    const r = NodeCode.of('a/b');
    expect(!r.ok && r.error.type).toBe('invalid-node-code');
    expect(!r.ok && r.error.errors?.[0]?.pointer).toBe('/code');
  });
});

describe('NodePath', () => {
  it('el path de una raíz es su propio código', () => {
    expect(NodePath.of(undefined, NodeCode.of('BOD-A').ok ? ('BOD-A' as never) : ('' as never))).toBe('BOD-A');
  });

  it('el path de un hijo concatena con barra', () => {
    expect(NodePath.of('BOD-A/Z1' as never, 'E3' as never)).toBe('BOD-A/Z1/E3');
  });

  // The trailing slash is the whole point: without it 'BOD-A/Z1' is a prefix of
  // 'BOD-A/Z10', which is not its descendant.
  it('el prefijo de descendencia lleva la barra final', () => {
    expect(NodePath.descendantPrefix('BOD-A/Z1' as never)).toBe('BOD-A/Z1/');
  });
});
