import {
  InvalidNodeCodeError,
  NodeCodeTakenError,
  NodeCycleError,
  NodeHasChildrenError,
  NodeHasStockError,
  NodeInactiveError,
  NodeNotFoundError,
  ParentNotFoundError,
  ParentNotInternalError,
  TreeTooLargeError,
  UnknownFilterNodeError,
} from '@app/inventory';

/**
 * Spec 12 §9 says the blocking errors must carry what the user needs in order
 * to act — insufficient-stock names the node by its readable path, not its
 * uuid. The wording is part of the contract, so it is tested like it.
 */
describe('los errores que tienen que decir por qué', () => {
  it('node-has-stock nombra el nodo y lista lo que estorba', () => {
    const positions = [
      { productId: 'p1', quantity: '4.000' },
      { productId: 'p2', batchId: 'b1', quantity: '1.000' },
    ];
    const e = new NodeHasStockError('BOD-A/Z1/E3', positions, 20);
    expect(e.status).toBe(422);
    expect(e.type).toBe('node-has-stock');
    expect(e.message).toContain('BOD-A/Z1/E3');
    expect(e.message).toContain('2 posición(es)');
    expect(e.extensions).toEqual({ positions, truncated: false });
  });

  it('node-has-stock trunca y lo dice cuando hay más de la cuenta', () => {
    const many = Array.from({ length: 5 }, (_, i) => ({ productId: `p${i}`, quantity: '1.000' }));
    const e = new NodeHasStockError('BOD-A', many, 2);
    expect(e.message).toContain('2 posiciones o más');
    expect(e.extensions).toEqual({ positions: many.slice(0, 2), truncated: true });
  });

  it('node-has-children cuenta los hijos activos (D-30)', () => {
    const e = new NodeHasChildrenError('BOD-A/Z1', ['BOD-A/Z1/E3', 'BOD-A/Z1/E3/B2'], 20);
    expect(e.status).toBe(422);
    expect(e.message).toContain('2 nodo(s) activo(s)');
    expect(e.extensions).toEqual({ children: ['BOD-A/Z1/E3', 'BOD-A/Z1/E3/B2'], truncated: false });
  });

  it('node-has-children trunca la lista larga', () => {
    const e = new NodeHasChildrenError('BOD-A', ['a', 'b', 'c'], 1);
    expect(e.extensions).toEqual({ children: ['a'], truncated: true });
  });

  it('node-cycle dice qué se movía y adónde', () => {
    const e = new NodeCycleError('BOD-A/Z1', 'BOD-A/Z1/E3/B2');
    expect(e.status).toBe(422);
    expect(e.message).toContain('BOD-A/Z1');
    expect(e.message).toContain('BOD-A/Z1/E3/B2');
  });

  it('parent-not-internal nombra el tipo que estorba (I-10)', () => {
    const e = new ParentNotInternalError('juan', 'CUSTODY');
    expect(e.status).toBe(422);
    expect(e.message).toContain('juan');
    expect(e.message).toContain('CUSTODY');
  });

  it('parent-not-found apunta a /parentId', () => {
    const e = new ParentNotFoundError('018f-abc');
    expect(e.status).toBe(422);
    expect(e.errors?.[0]?.pointer).toBe('/parentId');
  });

  it('invalid-filter apunta a /under y es 400, no 404 (D-28)', () => {
    const e = new UnknownFilterNodeError('018f-abc');
    expect(e.status).toBe(400);
    expect(e.type).toBe('invalid-filter');
    expect(e.errors?.[0]?.pointer).toBe('/under');
  });

  it('tree-too-large remite al listado paginado (D-29)', () => {
    const e = new TreeTooLargeError('BOD-A', 1000);
    expect(e.status).toBe(422);
    expect(e.message).toContain('GET /v1/nodes?under=');
    expect(e.extensions).toEqual({ max: 1000 });
  });

  it('los demás llevan su estado y su tipo', () => {
    expect(new NodeNotFoundError().status).toBe(404);
    expect(new NodeNotFoundError().type).toBe('not-found');
    expect(new NodeCodeTakenError('B2').status).toBe(409);
    expect(new NodeCodeTakenError('B2').message).toContain('B2');
    expect(new NodeInactiveError('BOD-A/Z1').status).toBe(422);
    expect(new NodeInactiveError('BOD-A/Z1').message).toContain('BOD-A/Z1');
    expect(new InvalidNodeCodeError('a/b').status).toBe(422);
  });
});
