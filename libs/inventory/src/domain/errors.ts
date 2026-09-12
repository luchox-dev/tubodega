import { DomainError } from '@app/common';

/** The errors of spec 12 §9 that the node graph raises, plus the four this
 *  plan adds and records as a deviation (plan 4). */

export class InvalidNodeCodeError extends DomainError {
  readonly type = 'invalid-node-code';
  readonly status = 422;
  constructor(raw: string) {
    super(`"${raw}" no es un código de nodo válido: de 1 a 64 caracteres, sin barras`, {
      errors: [{ pointer: '/code', code: 'invalid-node-code' }],
    });
  }
}

export class NodeNotFoundError extends DomainError {
  readonly type = 'not-found';
  readonly status = 404;
  constructor() {
    super('No se encontró el nodo');
  }
}

/** I-10, the half the schema CHECK cannot see: the parent must be INTERNAL too. */
export class ParentNotInternalError extends DomainError {
  readonly type = 'parent-not-internal';
  readonly status = 422;
  constructor(code: string, kind: string) {
    super(
      `Solo las ubicaciones internas se anidan: "${code}" es de tipo ${kind}, y la jerarquía es un árbol de nodos INTERNAL`,
    );
  }
}

export class ParentNotFoundError extends DomainError {
  readonly type = 'parent-not-found';
  readonly status = 422;
  constructor(id: string) {
    super(`El nodo padre "${id}" no existe en esta organización`, {
      errors: [{ pointer: '/parentId', code: 'parent-not-found' }],
    });
  }
}

/** The destination is the node itself, or one of its own descendants. */
export class NodeCycleError extends DomainError {
  readonly type = 'node-cycle';
  readonly status = 422;
  constructor(path: string, parentPath: string) {
    super(`No se puede colgar "${path}" de "${parentPath}": el destino está dentro del nodo que se mueve`);
  }
}

export class NodeCodeTakenError extends DomainError {
  readonly type = 'node-code-taken';
  readonly status = 409;
  constructor(code: string) {
    super(`El código de nodo "${code}" ya está en uso`);
  }
}

export interface BlockingPosition {
  readonly productId: string;
  readonly batchId?: string;
  readonly quantity: string;
}

/** N-3. Names what is there, so the user knows what to empty first. */
export class NodeHasStockError extends DomainError {
  readonly type = 'node-has-stock';
  readonly status = 422;
  constructor(path: string, positions: readonly BlockingPosition[], cap: number) {
    const shown = positions.slice(0, cap);
    const truncated = positions.length > cap;
    super(
      truncated
        ? `El nodo "${path}" todavía tiene saldo en ${cap} posiciones o más: vacíalo antes de desactivarlo`
        : `El nodo "${path}" todavía tiene saldo en ${shown.length} posición(es): vacíalo antes de desactivarlo`,
      { extensions: { positions: shown, truncated } },
    );
  }
}

/**
 * Decision D-30. Not a cascade and not a shrug: leaving the children active
 * would hang an operable subtree from a place that says it does not operate.
 */
export class NodeHasChildrenError extends DomainError {
  readonly type = 'node-has-children';
  readonly status = 422;
  constructor(path: string, children: readonly string[], cap: number) {
    const shown = children.slice(0, cap);
    super(
      `El nodo "${path}" todavía tiene ${children.length} nodo(s) activo(s) debajo: desactívalos antes que a él`,
      { extensions: { children: shown, truncated: children.length > cap } },
    );
  }
}

/** I-16: the movements already recorded stay valid; the new ones do not happen. */
export class NodeInactiveError extends DomainError {
  readonly type = 'node-inactive';
  readonly status = 422;
  constructor(path: string) {
    super(`El nodo "${path}" está inactivo y no admite movimientos nuevos`);
  }
}

/** Decision D-29: /tree is the only endpoint of the module without a cursor. */
export class TreeTooLargeError extends DomainError {
  readonly type = 'tree-too-large';
  readonly status = 422;
  constructor(path: string, max: number) {
    super(
      `El subárbol de "${path}" pasa de ${max} nodos: recórrelo por páginas con GET /v1/nodes?under={id}`,
      { extensions: { max } },
    );
  }
}

/** The `under` filter naming a node that is not there (decision D-28). */
export class UnknownFilterNodeError extends DomainError {
  readonly type = 'invalid-filter';
  readonly status = 400;
  constructor(id: string) {
    super(`El nodo "${id}" del filtro "under" no existe en esta organización`, {
      errors: [{ pointer: '/under', code: 'invalid-filter' }],
    });
  }
}

// ── The ledger (spec 12 §9). Wave 3.

/**
 * I-2. A negative is not a small amount, it is a direction — and the direction
 * of a movement lives in its pair of nodes, never in its number (decision D-32).
 */
export class NonPositiveQuantityError extends DomainError {
  readonly type = 'non-positive-quantity';
  readonly status = 422;
  constructor(raw: string) {
    super(`La cantidad de un movimiento se escribe en positivo, y "${raw}" no lo es`, {
      errors: [{ pointer: '/quantity', code: 'non-positive-quantity' }],
    });
  }
}

/**
 * Not in the table of spec 12 §9: the edge already refuses a malformed decimal
 * with 400 validation-failed, so this covers the amount that reaches the domain
 * by another door. Declared as a deviation in the plan-5 document.
 */
export class InvalidQuantityError extends DomainError {
  readonly type = 'invalid-quantity';
  readonly status = 422;
  constructor(raw: string) {
    super(`"${raw}" no es una cantidad: hasta 15 enteros y 3 decimales, con punto`, {
      errors: [{ pointer: '/quantity', code: 'invalid-quantity' }],
    });
  }
}

/** I-1. A movement is a double entry, and both ends being the same place is not one. */
export class SameNodeError extends DomainError {
  readonly type = 'same-node';
  readonly status = 422;
  constructor(path: string) {
    super(`Un movimiento va de un sitio a otro, y "${path}" es los dos`, {
      errors: [{ pointer: '/toNodeId', code: 'same-node' }],
    });
  }
}

/** I-8, the half where the product tracks batches and none came. */
export class BatchRequiredError extends DomainError {
  readonly type = 'batch-required';
  readonly status = 422;
  constructor(sku: string, mode: string) {
    super(`"${sku}" se rastrea por ${mode === 'SERIAL' ? 'número de serie' : 'lote'}: hay que decir cuál se mueve`, {
      errors: [{ pointer: '/batchId', code: 'batch-required' }],
    });
  }
}

/** I-8, the other half: a QUANTITY product has no batches to speak of. */
export class BatchNotAllowedError extends DomainError {
  readonly type = 'batch-not-allowed';
  readonly status = 422;
  constructor(sku: string) {
    super(`"${sku}" se lleva por cantidad, así que no tiene lotes ni series`, {
      errors: [{ pointer: '/batchId', code: 'batch-not-allowed' }],
    });
  }
}

export class BatchProductMismatchError extends DomainError {
  readonly type = 'batch-product-mismatch';
  readonly status = 422;
  constructor(sku: string) {
    super(`Ese lote no es de "${sku}"`, {
      errors: [{ pointer: '/batchId', code: 'batch-product-mismatch' }],
    });
  }
}

/** I-11. A due date on stock that is not on loan has nobody to come back from. */
export class DueDateNotAllowedError extends DomainError {
  readonly type = 'due-date-not-allowed';
  readonly status = 422;
  constructor(path: string) {
    super(`Solo un préstamo tiene fecha de devolución, y "${path}" no es una custodia`, {
      errors: [{ pointer: '/dueAt', code: 'due-date-not-allowed' }],
    });
  }
}

/**
 * I-14. The five minutes of tolerance are for the device with a drifting clock,
 * which is the whole reason occurredAt and recordedAt are two columns.
 */
export class FutureOccurrenceError extends DomainError {
  readonly type = 'future-occurrence';
  readonly status = 422;
  constructor(toleranceMinutes: number) {
    super(`El movimiento dice haber ocurrido en el futuro: se admiten hasta ${toleranceMinutes} minutos de desfase`, {
      errors: [{ pointer: '/occurredAt', code: 'future-occurrence' }],
    });
  }
}

/** I-17. Stock leaving a custody is either a return or the undoing of a loan. */
export class SettlesRequiredError extends DomainError {
  readonly type = 'settles-required';
  readonly status = 422;
  constructor(path: string) {
    super(`Lo que sale de la custodia "${path}" salda un préstamo: falta decir cuál`, {
      errors: [{ pointer: '/settlesId', code: 'settles-required' }],
    });
  }
}

export class SettlesMismatchError extends DomainError {
  readonly type = 'settles-mismatch';
  readonly status = 422;
  constructor(detail: string) {
    super(`El préstamo que se dice saldar no cuadra: ${detail}`, {
      errors: [{ pointer: '/settlesId', code: 'settles-mismatch' }],
    });
  }
}

/** I-18. The pending amount is an aggregate, so no CHECK can hold it. */
export class SettlesExceededError extends DomainError {
  readonly type = 'settles-exceeded';
  readonly status = 422;
  constructor(pending: string, requested: string) {
    super(`De ese préstamo quedan ${pending} por devolver, y se intentan devolver ${requested}`, {
      errors: [{ pointer: '/quantity', code: 'settles-exceeded', pending, requested }],
    });
  }
}

/**
 * Decision D-10 and D-36. Spec 02 §10 demands an explanation for adjustments
 * and shrinkage; spec 12 §9 gives it no `type`, so it is fixed here. Consumption
 * is deliberately not on the list: it is a physical fact, not a correction.
 */
export class ReasonRequiredError extends DomainError {
  readonly type = 'reason-required';
  readonly status = 422;
  constructor(code: string) {
    super(`Un movimiento contra "${code}" tiene que explicar por qué`, {
      errors: [{ pointer: '/reason', code: 'reason-required' }],
    });
  }
}

/** I-13, from the partial UNIQUE (org_id, reverses_id). */
export class AlreadyReversedError extends DomainError {
  readonly type = 'already-reversed';
  readonly status = 409;
  constructor(id: string) {
    super(`El movimiento "${id}" ya fue compensado: un error se corrige una vez`);
  }
}

/**
 * Decision D-10. The client's UUIDv7 is the primary key, so a retry that slips
 * past the idempotency table still hits it — which is I-7's last line.
 */
export class MovementIdTakenError extends DomainError {
  readonly type = 'movement-id-taken';
  readonly status = 409;
  constructor(id: string) {
    super(`Ya existe un movimiento con el id "${id}"`);
  }
}

export class MovementNotFoundError extends DomainError {
  readonly type = 'not-found';
  readonly status = 404;
  constructor() {
    super('No se encontró el movimiento');
  }
}

/**
 * I-9 and decision D-10. A serial is one physical unit: it cannot be on two
 * shelves at once. Only entering from a boundary trips this — moving it between
 * two custodial nodes is the same unit leaving and entering in one entry.
 */
export class SerialAlreadyPlacedError extends DomainError {
  readonly type = 'serial-already-placed';
  readonly status = 422;
  constructor(serial: string) {
    super(`La unidad "${serial}" ya está en el inventario: una serie es una sola cosa`, {
      errors: [{ pointer: '/batchId', code: 'serial-already-placed' }],
    });
  }
}

export class BatchTooLargeError extends DomainError {
  readonly type = 'batch-too-large';
  readonly status = 422;
  constructor(count: number, max: number) {
    super(`Un lote admite hasta ${max} movimientos y llegaron ${count}`, {
      errors: [{ pointer: '/movements', code: 'batch-too-large' }],
    });
  }
}

/** A product that no longer exists for the business does not move either. */
export class ProductInactiveError extends DomainError {
  readonly type = 'product-inactive';
  readonly status = 422;
  constructor(sku: string) {
    super(`"${sku}" está retirado del catálogo y no admite movimientos`, {
      errors: [{ pointer: '/productId', code: 'product-inactive' }],
    });
  }
}

/**
 * I-4, the most frequent error of the daily operation. Its detail names the node
 * by its readable path — not by its uuid — and carries available and requested,
 * because that is where the message the operator reads comes from.
 */
export class InsufficientStockError extends DomainError {
  readonly type = 'insufficient-stock';
  readonly status = 422;
  constructor(path: string, available: string, requested: string) {
    super(`En "${path}" hay ${available} y se intentan mover ${requested}`, {
      errors: [{ pointer: '/quantity', code: 'insufficient-stock', available, requested }],
    });
  }
}
