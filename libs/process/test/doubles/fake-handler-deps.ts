import { v7 } from 'uuid';
import { unwrap, type Clock, type OrgId } from '@app/common';
import { Batch, Product, TrackingMode, type BatchId, type ProductId } from '@app/catalog';
import { Node, NodeKind, type NodeId } from '@app/inventory';
import type { HandlerDeps, ResolvedCode } from '@app/process';
import { ORG } from '../builders/a-template.js';

export const AHORA = new Date('2026-09-12T12:00:00.000Z');

export const unProducto = (over: Partial<{ sku: string; trackingMode: TrackingMode; uom: string }> = {}): Product =>
  unwrap(
    Product.create({
      id: v7() as ProductId,
      orgId: ORG,
      sku: over.sku ?? 'TOR-M8',
      name: over.sku ?? 'Tornillo M8',
      trackingMode: over.trackingMode ?? TrackingMode.QUANTITY,
      uom: over.uom ?? 'UNIT',
    }),
  );

export const unLote = (product: Product, over: Partial<{ lotCode: string; serial: string; expiresAt: Date }> = {}): Batch =>
  unwrap(
    Batch.create({
      id: v7() as BatchId,
      product,
      ...(over.lotCode !== undefined ? { lotCode: over.lotCode } : {}),
      ...(over.serial !== undefined ? { serial: over.serial } : {}),
      ...(over.expiresAt !== undefined ? { expiresAt: over.expiresAt } : {}),
    }),
  );

export const unNodo = (code: string, kind: NodeKind = NodeKind.INTERNAL): Node =>
  unwrap(Node.create({ id: v7() as NodeId, orgId: ORG, kind, code, name: code }));

export interface MundoDePapel {
  readonly productos: readonly Product[];
  readonly nodos: readonly Node[];
  readonly lotes: readonly Batch[];
  /** Lo que devuelve escanear un código: producto, y unidad si era una serie. */
  readonly codigos: ReadonlyMap<string, ResolvedCode>;
  readonly ahora: Date;
}

export const relojFijo = (at: Date = AHORA): Clock => ({ now: () => at });

/**
 * `HandlerDeps` es un objeto de funciones y no de puertos (D-46), así que el
 * doble es un objeto literal sobre mapas en memoria: no hay clase que escribir,
 * y las firmas son exactamente las de los repositorios de verdad.
 */
export function fakeHandlerDeps(mundo: Partial<MundoDePapel> = {}): HandlerDeps {
  const productos = mundo.productos ?? [];
  const nodos = mundo.nodos ?? [];
  const lotes = mundo.lotes ?? [];
  const codigos = mundo.codigos ?? new Map<string, ResolvedCode>();
  const orgId: OrgId = ORG;

  return {
    orgId,
    // Devuelve null en vez de lanzar, como `ResolveCode` de [11 §4].
    resolveCode: (_org, raw) => Promise.resolve(codigos.get(raw) ?? null),
    findNode: (_org, id) => Promise.resolve(nodos.find((n) => n.id === id) ?? null),
    findNodeByCode: (_org, code) => Promise.resolve(nodos.find((n) => n.code === code) ?? null),
    findProduct: (_org, id) => Promise.resolve(productos.find((p) => p.id === id) ?? null),
    findBatchByLot: (_org, productId, lotCode) =>
      Promise.resolve(lotes.find((b) => b.productId === productId && b.lotCode === lotCode) ?? null),
    findBatchBySerial: (_org, serial) => Promise.resolve(lotes.find((b) => b.serial === serial) ?? null),
    clock: relojFijo(mundo.ahora ?? AHORA),
  };
}
