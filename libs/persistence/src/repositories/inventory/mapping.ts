// Row ↔ entity in both directions. The DAO knows nothing about Node (spec 08 §7).
import type { OrgId, ProcessInstanceId, TraceId, UserId } from '@app/common';
import { CustomFieldValues, type BatchId, type ProductId, type TrackingMode } from '@app/catalog';
import {
  Movement, Node, NodeKind, Quantity,
  type MovementId, type NodeCode, type NodeId, type NodePath, type StockPosition,
} from '@app/inventory';
import type {
  MovementModel, NewMovement, NodeModel, StockBalanceModel,
} from '../../models/index.js';

const asRecord = (v: unknown): Record<string, unknown> =>
  v !== null && typeof v === 'object' ? (v as Record<string, unknown>) : {};

export const toNode = (row: NodeModel): Node =>
  Node.rehydrate({
    id: row.id as NodeId,
    orgId: row.orgId as OrgId,
    kind: row.kind as NodeKind,
    code: row.code as NodeCode,
    name: row.name,
    ...(row.parentId !== null ? { parentId: row.parentId as NodeId } : {}),
    path: row.path as NodePath,
    active: row.active,
    customFields: CustomFieldValues.rehydrate(asRecord(row.customFields)),
    version: row.version,
  });

export const nodeValues = (n: Node) => ({
  kind: n.kind,
  code: n.code as string,
  name: n.name,
  parentId: n.parentId ?? null,
  path: n.path as string,
  active: n.active,
  customFields: JSON.stringify(n.customFields.toJSON()),
});

// ── The ledger (spec 12 §2). Same direction both ways, no entity in the DAO.

export const toMovement = (row: MovementModel): Movement =>
  Movement.rehydrate({
    id: row.id as MovementId,
    orgId: row.orgId as OrgId,
    productId: row.productId as ProductId,
    ...(row.batchId !== null ? { batchId: row.batchId as BatchId } : {}),
    fromNodeId: row.fromNodeId as NodeId,
    toNodeId: row.toNodeId as NodeId,
    quantity: Quantity.rehydrate(row.quantity),
    occurredAt: row.occurredAt,
    recordedAt: row.recordedAt,
    actorId: row.actorId as UserId,
    ...(row.reason !== null ? { reason: row.reason } : {}),
    ...(row.dueAt !== null ? { dueAt: row.dueAt } : {}),
    ...(row.reversesId !== null ? { reversesId: row.reversesId as MovementId } : {}),
    ...(row.settlesId !== null ? { settlesId: row.settlesId as MovementId } : {}),
    ...(row.processInstanceId !== null
      ? { processInstanceId: row.processInstanceId as ProcessInstanceId }
      : {}),
    traceId: row.traceId as TraceId,
    trackingMode: row.trackingMode as TrackingMode,
    fromNodeKind: row.fromNodeKind as NodeKind,
    toNodeKind: row.toNodeKind as NodeKind,
  });

export const movementValues = (m: Movement): NewMovement => ({
  id: m.id,
  orgId: m.orgId,
  productId: m.productId,
  batchId: m.batchId ?? null,
  fromNodeId: m.fromNodeId,
  toNodeId: m.toNodeId,
  quantity: m.quantity.toString(),
  occurredAt: m.occurredAt,
  recordedAt: m.recordedAt,
  actorId: m.actorId,
  reason: m.reason ?? null,
  dueAt: m.dueAt ?? null,
  reversesId: m.reversesId ?? null,
  settlesId: m.settlesId ?? null,
  processInstanceId: m.processInstanceId ?? null,
  traceId: m.traceId,
  trackingMode: m.trackingMode,
  fromNodeKind: m.fromNodeKind,
  toNodeKind: m.toNodeKind,
});

export const toStockPosition = (row: StockBalanceModel): StockPosition => ({
  nodeId: row.nodeId as NodeId,
  productId: row.productId as ProductId,
  ...(row.batchId !== null ? { batchId: row.batchId as BatchId } : {}),
  nodeKind: row.nodeKind as NodeKind,
  quantity: Quantity.rehydrate(row.quantity),
});
