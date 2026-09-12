// Row ↔ entity in both directions. The DAO knows nothing about Node (spec 08 §7).
import type { OrgId } from '@app/common';
import { CustomFieldValues } from '@app/catalog';
import { Node, NodeKind, type NodeCode, type NodeId, type NodePath } from '@app/inventory';
import type { NodeModel } from '../../models/index.js';

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
