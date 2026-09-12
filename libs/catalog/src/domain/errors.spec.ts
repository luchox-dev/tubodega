import {
  BatchNotAllowedError,
  BatchNotFoundError,
  BatchRequiredError,
  CodeNotFoundError,
  CodeTakenError,
  CustomFieldNotFoundError,
  CustomFieldTypeLockedError,
  InvalidCodeValueError,
  InvalidCustomFieldError,
  InvalidFieldKeyError,
  InvalidSkuError,
  InvalidUomError,
  LotCodeTakenError,
  ProductHasStockError,
  ProductNotFoundError,
  RequiredFieldWouldInvalidateError,
  SerialTakenError,
  SkuTakenError,
  TrackingModeLockedError,
} from '@app/catalog';

/**
 * Spec 11 §9 is explicit that the details of the blocking errors must carry
 * what the user needs in order to act. An error that only says no makes them
 * guess, so the wording is part of the contract and is tested like it.
 */
describe('the errors that have to say why', () => {
  it('tracking-mode-locked counts the movements, and counts one in singular', () => {
    expect(new TrackingModeLockedError(3).message).toContain('3 movimientos');
    expect(new TrackingModeLockedError(1).message).toContain('1 movimiento');
    expect(new TrackingModeLockedError(3).extensions).toEqual({ movements: 3 });
    expect(new TrackingModeLockedError(3).status).toBe(422);
  });

  it('product-has-stock names the nodes, so the user knows what to empty', () => {
    const nodes = [
      { nodeId: 'n1', path: 'BOD-A/Z1/E3', quantity: '4.000' },
      { nodeId: 'n2', path: 'BOD-B', quantity: '1.000' },
    ];
    const e = new ProductHasStockError(nodes);
    expect(e.message).toContain('BOD-A/Z1/E3, BOD-B');
    expect(e.extensions).toEqual({ nodes });
  });

  it('required-field-would-invalidate counts what would break', () => {
    expect(new RequiredFieldWouldInvalidateError('ubicacion_fiscal', 2).message).toContain('2 entidades');
    expect(new RequiredFieldWouldInvalidateError('ubicacion_fiscal', 1).message).toContain('1 entidad');
  });

  it('code-taken names the product holding the code, when it is known', () => {
    expect(new CodeTakenError('7501', 'TOR-M8').message).toContain('TOR-M8');
    expect(new CodeTakenError('7501').message).toContain('7501');
  });

  it('custom-field-type-locked counts the entities that already have a value', () => {
    expect(new CustomFieldTypeLockedError('familia', 5).message).toContain('5 entidades ya tienen');
    expect(new CustomFieldTypeLockedError('familia', 1).message).toContain('1 entidad ya tiene');
  });

  it('batch-required points at the field that is missing, per tracking mode', () => {
    expect(new BatchRequiredError('LEC-1', 'LOT').errors).toEqual([
      { pointer: '/lotCode', code: 'batch-required' },
    ]);
    expect(new BatchRequiredError('TAL-1', 'SERIAL').errors).toEqual([
      { pointer: '/serial', code: 'batch-required' },
    ]);
  });

  it('invalid-custom-field says how many fields failed', () => {
    const one = new InvalidCustomFieldError([{ pointer: '/customFields/peso', code: 'expected-number' }]);
    expect(one.message).toContain('peso');
    const many = new InvalidCustomFieldError([
      { pointer: '/customFields/peso', code: 'expected-number' },
      { pointer: '/customFields/familia', code: 'not-an-option' },
    ]);
    expect(many.message).toContain('2 campos');
  });

  it('every error carries its own problem+json type and status', () => {
    const cases: readonly [{ type: string; status: number }, string, number][] = [
      [new SkuTakenError('A'), 'sku-taken', 409],
      [new SerialTakenError('S'), 'serial-taken', 409],
      [new LotCodeTakenError('L'), 'lot-code-taken', 409],
      [new BatchNotAllowedError('A'), 'batch-not-allowed', 422],
      [new ProductNotFoundError(), 'not-found', 404],
      [new BatchNotFoundError(), 'not-found', 404],
      [new CustomFieldNotFoundError(), 'not-found', 404],
      [new CodeNotFoundError('X'), 'code-not-found', 404],
      [new InvalidSkuError('A B'), 'validation-failed', 422],
      [new InvalidFieldKeyError('Mal'), 'validation-failed', 422],
      [new InvalidCodeValueError(''), 'validation-failed', 422],
      [new InvalidUomError('DOCENA'), 'validation-failed', 422],
    ];
    for (const [e, type, status] of cases) {
      expect(e.type).toBe(type);
      expect(e.status).toBe(status);
    }
  });
});
