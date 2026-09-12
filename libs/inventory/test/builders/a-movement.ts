import { v7 } from 'uuid';
import { unwrap, type TraceId, type UserId } from '@app/common';
import { Batch, Product, TrackingMode, type BatchId, type ProductId } from '@app/catalog';
import { Movement, NodeKind, Quantity, type MovementId } from '@app/inventory';
import { ORG, aNode } from './a-node.js';

export const qty = (raw: string): Quantity => unwrap(Quantity.of(raw));

export const ACTOR = '018f0000-0000-7000-8000-0000000000aa' as UserId;
export const TRACE = '018f0000-0000-7000-8000-0000000000bb' as TraceId;

/** Catalogue fixtures with inventory's own ORG, so the two libraries' test
 *  worlds do not have to agree on an organisation id. */
export function aProduct(over: Partial<{ sku: string; trackingMode: TrackingMode }> = {}): Product {
  return unwrap(
    Product.create({
      id: v7() as ProductId,
      orgId: ORG,
      sku: over.sku ?? 'TOR-M8',
      name: 'Tornillo M8 galvanizado',
      trackingMode: over.trackingMode ?? TrackingMode.QUANTITY,
      uom: 'UNIT',
    }),
  );
}

export function aBatch(product: Product, over: Partial<{ lotCode: string; serial: string }> = {}): Batch {
  const serial = product.trackingMode === TrackingMode.SERIAL;
  return unwrap(
    Batch.create({
      id: v7() as BatchId,
      product,
      ...(serial ? { serial: over.serial ?? 'BSH-001' } : { lotCode: over.lotCode ?? 'L-2026-09' }),
    }),
  );
}

type Over = Partial<Omit<Parameters<typeof Movement.create>[0], 'id' | 'orgId' | 'actorId' | 'traceId'>>;

/** A plain receipt from the supplier into a bin, unless told otherwise. */
export function aMovementInput(over: Over = {}): Parameters<typeof Movement.create>[0] {
  const at = new Date('2026-09-12T12:00:00.000Z');
  return {
    id: v7() as MovementId,
    orgId: ORG,
    product: over.product ?? aProduct(),
    fromNode: over.fromNode ?? aNode({ kind: NodeKind.SOURCE, code: 'supplier-default' }),
    toNode: over.toNode ?? aNode({ code: 'B2' }),
    quantity: over.quantity ?? qty('100'),
    occurredAt: over.occurredAt ?? at,
    recordedAt: over.recordedAt ?? at,
    actorId: ACTOR,
    traceId: TRACE,
    ...over,
  };
}

export const aMovement = (over: Over = {}): Movement => unwrap(Movement.create(aMovementInput(over)));
