import { v7 } from 'uuid';
import { unwrap, type UserId } from '@app/common';
import { TrackingMode } from '@app/catalog';
import {
  ACTOR, aBatch, aMovement, aMovementInput, aProduct, qty,
} from '../../test/builders/a-movement.js';
import { ORG, aNode } from '../../test/builders/a-node.js';
import { Movement } from './movement.js';
import { NodeKind } from './node.js';
import { Quantity } from './quantity.js';
import type { MovementId } from './ids.js';

const failsWith = (over: Parameters<typeof aMovementInput>[0], type: string) => {
  const r = Movement.create(aMovementInput(over));
  expect(r.ok).toBe(false);
  expect(!r.ok && r.error.type).toBe(type);
};

const bin = (code: string) => aNode({ code });
const custody = (code = 'juan') => aNode({ kind: NodeKind.CUSTODY, code });
const terminal = (code = 'sale') => aNode({ kind: NodeKind.TERMINAL, code });

describe('Movement.create', () => {
  it('el camino feliz: una recepción del proveedor a un estante', () => {
    const m = aMovement();
    expect(m.quantity.toString()).toBe('100.000');
    expect(m.reversesId).toBeUndefined();
    expect(m.settlesId).toBeUndefined();
  });

  // The three denormalised columns exist so the CHECKs of I-8, I-11 and I-17
  // are enforceable without reading another table (spec 04 §3.4).
  it('copia trackingMode y los dos kind desde las entidades resueltas', () => {
    const product = aProduct({ trackingMode: TrackingMode.LOT });
    const m = unwrap(
      Movement.create(
        aMovementInput({ product, batch: aBatch(product), fromNode: bin('B2'), toNode: terminal() }),
      ),
    );
    expect(m.trackingMode).toBe(TrackingMode.LOT);
    expect(m.fromNodeKind).toBe(NodeKind.INTERNAL);
    expect(m.toNodeKind).toBe(NodeKind.TERMINAL);
  });

  it('I-1 · origen y destino distintos', () => {
    const same = bin('B2');
    failsWith({ fromNode: same, toNode: same }, 'same-node');
  });

  it('I-2 · la cantidad es estrictamente positiva', () => {
    failsWith({ quantity: Quantity.zero() }, 'non-positive-quantity');
    failsWith({ quantity: qty('1').minus(qty('5')) }, 'non-positive-quantity');
  });

  it('I-16 · un nodo inactivo no admite movimientos nuevos', () => {
    failsWith({ toNode: bin('B3').deactivate() }, 'node-inactive');
    failsWith({ fromNode: bin('B2').deactivate(), toNode: bin('B3') }, 'node-inactive');
  });

  describe('I-8 · el lote es obligatorio si y solo si el producto lo rastrea', () => {
    it('LOT sin lote y SERIAL sin lote fallan', () => {
      failsWith({ product: aProduct({ trackingMode: TrackingMode.LOT }) }, 'batch-required');
      failsWith({ product: aProduct({ trackingMode: TrackingMode.SERIAL }) }, 'batch-required');
    });

    it('QUANTITY con lote falla', () => {
      const otro = aProduct({ sku: 'LECHE-1L', trackingMode: TrackingMode.LOT });
      failsWith({ batch: aBatch(otro) }, 'batch-not-allowed');
    });

    it('el lote tiene que ser del producto que se mueve', () => {
      const leche = aProduct({ sku: 'LECHE-1L', trackingMode: TrackingMode.LOT });
      const taladro = aProduct({ sku: 'TAL-BOSCH', trackingMode: TrackingMode.SERIAL });
      failsWith({ product: leche, batch: aBatch(taladro) }, 'batch-product-mismatch');
    });

    it('LOT con su lote es válido, y el batchId queda en el asiento', () => {
      const leche = aProduct({ sku: 'LECHE-1L', trackingMode: TrackingMode.LOT });
      const lote = aBatch(leche);
      const m = unwrap(Movement.create(aMovementInput({ product: leche, batch: lote })));
      expect(m.batchId).toBe(lote.id);
    });
  });

  it('I-11 · dueAt solo hacia un nodo CUSTODY', () => {
    const dueAt = new Date('2026-09-19T12:00:00.000Z');
    failsWith({ fromNode: bin('B2'), toNode: bin('B3'), dueAt }, 'due-date-not-allowed');
    const prestamo = unwrap(
      Movement.create(aMovementInput({ fromNode: bin('B2'), toNode: custody(), dueAt })),
    );
    expect(prestamo.dueAt).toEqual(dueAt);
  });

  describe('I-14 · occurredAt no va por delante del reloj más de la tolerancia', () => {
    const recordedAt = new Date('2026-09-12T12:00:00.000Z');
    const adelantado = (minutes: number, seconds = 0) =>
      new Date(recordedAt.getTime() + minutes * 60_000 + seconds * 1000);

    it('a más de 5 minutos falla', () => {
      failsWith({ recordedAt, occurredAt: adelantado(5, 1) }, 'future-occurrence');
      failsWith({ recordedAt, occurredAt: adelantado(10) }, 'future-occurrence');
    });

    // The tolerance is there for the device with a drifting clock, which is the
    // whole reason occurredAt and recordedAt are two columns.
    it('a 4 min 59 s vale, y en el pasado siempre', () => {
      expect(Movement.create(aMovementInput({ recordedAt, occurredAt: adelantado(4, 59) })).ok).toBe(true);
      expect(Movement.create(aMovementInput({ recordedAt, occurredAt: adelantado(-1000) })).ok).toBe(true);
    });
  });

  describe('I-17 e I-18 · salir de una custodia salda un préstamo', () => {
    // The very node the check-out went to is the one the check-in leaves from:
    // that identity is what I-17 checks, so the tests have to share the object.
    const juan = custody();
    const tornillo = aProduct();
    const prestamo = () =>
      aMovement({
        product: tornillo,
        fromNode: bin('B2'),
        toNode: juan,
        dueAt: new Date('2026-09-19T12:00:00.000Z'),
      });

    it('I-17 · sin settlesId ni reversesId no se sale de la custodia', () => {
      failsWith({ fromNode: juan, toNode: bin('B2') }, 'settles-required');
    });

    it('I-17 · el check-out referenciado tiene que ir a este origen', () => {
      failsWith(
        {
          fromNode: custody('marta'),
          toNode: bin('B2'),
          settles: { movement: prestamo(), pending: qty('5') },
        },
        'settles-mismatch',
      );
    });

    it('I-17 · y no puede cambiar de producto', () => {
      failsWith(
        {
          product: aProduct({ sku: 'ARROZ-25' }),
          fromNode: juan,
          toNode: bin('B2'),
          settles: { movement: prestamo(), pending: qty('5') },
        },
        'settles-mismatch',
      );
    });

    // Two lots of the same milk are not interchangeable: one expires in March
    // and the other in June, and the loan was of one of them.
    it('I-17 · ni de lote, aunque el producto sea el mismo', () => {
      const leche = aProduct({ sku: 'LECHE-1L', trackingMode: TrackingMode.LOT });
      const marzo = aBatch(leche, { lotCode: 'L-2026-03' });
      const junio = aBatch(leche, { lotCode: 'L-2026-06' });
      const p = aMovement({ product: leche, batch: marzo, fromNode: bin('B2'), toNode: juan });
      failsWith(
        {
          product: leche,
          batch: junio,
          fromNode: juan,
          toNode: bin('B2'),
          settles: { movement: p, pending: qty('5') },
        },
        'settles-mismatch',
      );
    });

    it('I-18 · lo saldado no supera el pendiente', () => {
      failsWith(
        {
          product: tornillo,
          fromNode: juan,
          toNode: bin('B2'),
          quantity: qty('4'),
          settles: { movement: prestamo(), pending: qty('3') },
        },
        'settles-exceeded',
      );
    });

    it('una devolución parcial con pendiente suficiente es válida', () => {
      const p = prestamo();
      const devolucion = unwrap(
        Movement.create(
          aMovementInput({
            product: tornillo,
            fromNode: juan,
            toNode: bin('B2'),
            quantity: qty('2'),
            settles: { movement: p, pending: qty('5') },
          }),
        ),
      );
      expect(devolucion.settlesId).toBe(p.id);
    });

    // I-17 admits compensation: reversing a check-out also leaves the custody,
    // and there is no check-out for it to settle — it *is* the undoing of one.
    it('I-17 · salir de la custodia compensando, sin settlesId, es válido', () => {
      const r = Movement.create(
        aMovementInput({ fromNode: juan, toNode: bin('B2'), reversesId: v7() as MovementId }),
      );
      expect(r.ok).toBe(true);
      expect(r.ok && r.value.settlesId).toBeUndefined();
    });
  });

  // D-10 and decision D-36: spec 02 §10 demands a reason for adjustments and
  // shrinkage, and spec 12 §9 gives it no `type`. The node's own code decides,
  // because Movement.create holds both nodes resolved.
  describe('D-36 · el ajuste y la merma exigen motivo', () => {
    it.each(['adjustment-out', 'shrinkage'])('%s sin motivo falla', (code) => {
      failsWith({ fromNode: bin('B3'), toNode: terminal(code) }, 'reason-required');
    });

    it('adjustment-in como origen también', () => {
      failsWith(
        { fromNode: aNode({ kind: NodeKind.SOURCE, code: 'adjustment-in' }), toNode: bin('B2') },
        'reason-required',
      );
    });

    it('con motivo pasa', () => {
      const r = Movement.create(
        aMovementInput({ fromNode: bin('B3'), toNode: terminal('shrinkage'), reason: 'se rompió' }),
      );
      expect(r.ok).toBe(true);
    });

    // Consumption is not an adjustment: it is a real physical fact, and asking
    // for an explanation of it would make every internal use a paperwork step.
    it('el consumo interno sin motivo es válido, porque no es un ajuste', () => {
      expect(
        Movement.create(aMovementInput({ fromNode: bin('B3'), toNode: terminal('consumption') })).ok,
      ).toBe(true);
    });
  });

  it('recorta el motivo y descarta el que solo tiene espacios', () => {
    const m = aMovement({ reason: '  llegó mojado  ' });
    expect(m.reason).toBe('llegó mojado');
    expect(aMovement({ reason: '   ' }).reason).toBeUndefined();
  });

  it('guarda processInstanceId cuando lo trae, y nada cuando no', () => {
    expect(aMovement().processInstanceId).toBeUndefined();
    expect(aMovement({ processInstanceId: 'p-1' as never }).processInstanceId).toBe('p-1');
  });
});

describe('I-12 · reverse() produce el inverso exacto', () => {
  const original = () =>
    aMovement({ fromNode: bin('MUELLE'), toNode: bin('B2'), quantity: qty('100') });

  const at = new Date('2026-09-13T09:00:00.000Z');
  const by = '018f0000-0000-7000-8000-0000000000cc' as UserId;
  const compensar = (m: Movement) =>
    m.reverse({ id: v7() as MovementId, by, at, reason: 'eran 10, no 100' });

  it('invierte los nodos y conserva producto, lote y cantidad', () => {
    const m = original();
    const r = compensar(m);
    expect(r.fromNodeId).toBe(m.toNodeId);
    expect(r.toNodeId).toBe(m.fromNodeId);
    expect(r.fromNodeKind).toBe(m.toNodeKind);
    expect(r.toNodeKind).toBe(m.fromNodeKind);
    expect(r.productId).toBe(m.productId);
    expect(r.batchId).toBe(m.batchId);
    expect(r.quantity.toString()).toBe(m.quantity.toString());
    expect(r.trackingMode).toBe(m.trackingMode);
  });

  it('reversesId apunta al original, y el motivo y el actor son los nuevos', () => {
    const m = original();
    const r = compensar(m);
    expect(r.reversesId).toBe(m.id);
    expect(r.reason).toBe('eran 10, no 100');
    expect(r.actorId).toBe(by);
    expect(r.occurredAt).toEqual(at);
    expect(r.recordedAt).toEqual(at);
    expect(r.traceId).toBe(m.traceId);
  });

  // settlesId would claim this reversal settles the check-out the original
  // settled, and it does the opposite: it re-opens it. dueAt would set a due
  // date on stock coming *back*.
  it('no copia settlesId ni dueAt', () => {
    const juan = custody();
    const tornillo = aProduct();
    const prestamo = aMovement({
      product: tornillo,
      fromNode: bin('B2'),
      toNode: juan,
      dueAt: new Date('2026-09-19T12:00:00.000Z'),
    });
    const devolucion = aMovement({
      product: tornillo,
      fromNode: juan,
      toNode: bin('B2'),
      quantity: qty('2'),
      settles: { movement: prestamo, pending: qty('5') },
    });
    expect(compensar(devolucion).settlesId).toBeUndefined();
    expect(compensar(prestamo).dueAt).toBeUndefined();
  });

  it('no toca el original: un movimiento es inmutable (I-3)', () => {
    const m = original();
    const antes = { from: m.fromNodeId, to: m.toNodeId, reversesId: m.reversesId };
    compensar(m);
    expect({ from: m.fromNodeId, to: m.toNodeId, reversesId: m.reversesId }).toEqual(antes);
  });

  it('compensar una compensación vuelve al sentido original', () => {
    const m = original();
    const dos = compensar(compensar(m));
    expect(dos.fromNodeId).toBe(m.fromNodeId);
    expect(dos.toNodeId).toBe(m.toNodeId);
  });
});

describe('Movement.rehydrate', () => {
  it('devuelve la fila tal cual, sin volver a validar', () => {
    const m = aMovement();
    const copia = Movement.rehydrate({
      id: m.id, orgId: ORG, productId: m.productId, fromNodeId: m.fromNodeId,
      toNodeId: m.toNodeId, quantity: m.quantity, occurredAt: m.occurredAt,
      recordedAt: m.recordedAt, actorId: ACTOR, traceId: m.traceId,
      trackingMode: m.trackingMode, fromNodeKind: m.fromNodeKind, toNodeKind: m.toNodeKind,
    });
    expect(copia.id).toBe(m.id);
    expect(copia.batchId).toBeUndefined();
    expect(copia.quantity.toString()).toBe('100.000');
  });
});
