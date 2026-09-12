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
