import { DomainError, type ProblemFieldError } from '@app/common';

/** The errors of spec 11 §9 that the catalogue itself raises. */

export class InvalidSkuError extends DomainError {
  readonly type = 'validation-failed';
  readonly status = 422;
  constructor(raw: string) {
    super(`"${raw}" no es un SKU válido: de 1 a 64 caracteres, sin espacios`, {
      errors: [{ pointer: '/sku', code: 'invalid-sku' }],
    });
  }
}

export class InvalidFieldKeyError extends DomainError {
  readonly type = 'validation-failed';
  readonly status = 422;
  constructor(raw: string) {
    super(`"${raw}" no es una clave de campo válida: snake_case, de 1 a 64 caracteres`, {
      errors: [{ pointer: '/key', code: 'invalid-field-key' }],
    });
  }
}

export class InvalidCodeValueError extends DomainError {
  readonly type = 'validation-failed';
  readonly status = 422;
  constructor(raw: string) {
    super(`"${raw}" no es un código válido: de 1 a 128 caracteres`, {
      errors: [{ pointer: '/value', code: 'invalid-code' }],
    });
  }
}

export class InvalidUomError extends DomainError {
  readonly type = 'validation-failed';
  readonly status = 422;
  constructor(raw: string) {
    super(`"${raw}" no es una unidad de medida conocida`, {
      errors: [{ pointer: '/uom', code: 'invalid-uom' }],
    });
  }
}

/** C-7: one entry per offending field, so the client can mark them all at once. */
export class InvalidCustomFieldError extends DomainError {
  readonly type = 'invalid-custom-field';
  readonly status = 422;
  /** Narrower than the base: this error always names at least one field. */
  declare readonly errors: readonly ProblemFieldError[];
  constructor(errors: readonly ProblemFieldError[]) {
    super(
      errors.length === 1
        ? `El campo ${errors[0]!.pointer.split('/').pop()} no es válido`
        : `${errors.length} campos propios no son válidos`,
      { errors },
    );
  }
}

/** C-4: a product tracked by quantity has no batches at all. */
export class BatchNotAllowedError extends DomainError {
  readonly type = 'batch-not-allowed';
  readonly status = 422;
  constructor(sku: string) {
    super(`"${sku}" se lleva por cantidad: no admite lotes ni números de serie`);
  }
}

/** C-3: a LOT product needs a lot code; a SERIAL one, a serial. */
export class BatchRequiredError extends DomainError {
  readonly type = 'batch-required';
  readonly status = 422;
  constructor(sku: string, mode: 'LOT' | 'SERIAL') {
    super(
      mode === 'LOT'
        ? `"${sku}" se lleva por lote: hace falta el código de lote`
        : `"${sku}" se lleva por número de serie: hace falta el número de serie`,
      { errors: [{ pointer: mode === 'LOT' ? '/lotCode' : '/serial', code: 'batch-required' }] },
    );
  }
}

export class SkuTakenError extends DomainError {
  readonly type = 'sku-taken';
  readonly status = 409;
  constructor(sku: string) {
    super(`El SKU "${sku}" ya está en uso`);
  }
}

/** C-2. The detail names the product that already holds it: without it the
 *  user has to go hunting through the catalogue for the collision. */
export class CodeTakenError extends DomainError {
  readonly type = 'code-taken';
  readonly status = 409;
  constructor(value: string, bySku?: string) {
    super(
      bySku
        ? `El código "${value}" ya lo usa el producto "${bySku}"`
        : `El código "${value}" ya está en uso`,
    );
  }
}

export class SerialTakenError extends DomainError {
  readonly type = 'serial-taken';
  readonly status = 409;
  constructor(serial: string) {
    super(`El número de serie "${serial}" ya existe`);
  }
}

export class LotCodeTakenError extends DomainError {
  readonly type = 'lot-code-taken';
  readonly status = 409;
  constructor(lotCode: string) {
    super(`El lote "${lotCode}" ya existe para este producto`);
  }
}

/** C-8 / I-15. The detail says how many movements block it, because "no" without
 *  a number leaves the user guessing whether it is one or a thousand. */
export class TrackingModeLockedError extends DomainError {
  readonly type = 'tracking-mode-locked';
  readonly status = 422;
  constructor(movements: number) {
    super(
      `No se puede cambiar la forma de seguimiento: el producto ya tiene ${movements} ${movements === 1 ? 'movimiento' : 'movimientos'}. Cree un producto nuevo y desactive este`,
      { extensions: { movements } },
    );
  }
}

/** C-9. Lists where the stock is, so the user knows what to empty first. */
export class ProductHasStockError extends DomainError {
  readonly type = 'product-has-stock';
  readonly status = 422;
  constructor(nodes: readonly { readonly nodeId: string; readonly path: string; readonly quantity: string }[]) {
    super(
      `No se puede desactivar: todavía hay existencias en ${nodes.map((n) => n.path).join(', ')}`,
      { extensions: { nodes } },
    );
  }
}

/** C-10: a required field is born optional and becomes required once everyone has it. */
export class RequiredFieldWouldInvalidateError extends DomainError {
  readonly type = 'required-field-would-invalidate';
  readonly status = 422;
  constructor(key: string, missing: number) {
    super(
      `No se puede exigir "${key}": ${missing} ${missing === 1 ? 'entidad quedaría inválida' : 'entidades quedarían inválidas'}. Rellénelas primero`,
      { extensions: { missing } },
    );
  }
}

/** D-10: the type of a field with values already stored cannot change. */
export class CustomFieldTypeLockedError extends DomainError {
  readonly type = 'custom-field-type-locked';
  readonly status = 422;
  constructor(key: string, used: number) {
    super(`No se puede cambiar el tipo de "${key}": ${used} ${used === 1 ? 'entidad ya tiene' : 'entidades ya tienen'} un valor`);
  }
}

export class ProductNotFoundError extends DomainError {
  readonly type = 'not-found';
  readonly status = 404;
  constructor() {
    super('No se encontró el producto');
  }
}

export class CodeNotFoundError extends DomainError {
  readonly type = 'code-not-found';
  readonly status = 404;
  constructor(value: string) {
    super(`Ningún producto ni lote responde al código "${value}"`);
  }
}

export class CustomFieldNotFoundError extends DomainError {
  readonly type = 'not-found';
  readonly status = 404;
  constructor() {
    super('No se encontró la definición de campo');
  }
}

export class BatchNotFoundError extends DomainError {
  readonly type = 'not-found';
  readonly status = 404;
  constructor() {
    super('No se encontró el lote');
  }
}
