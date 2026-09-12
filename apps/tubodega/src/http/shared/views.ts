import type { Page } from '@app/common';
import type {
  Batch, CustomFieldDefinition, Product, ProductCode, StoredMedia,
} from '@app/catalog';
import type { Movement, Node, NodeTree, OpenCustody, StockPosition } from '@app/inventory';
import type { Organization, User } from '@app/tenancy';
import type { CustomFieldView } from '../custom-fields/custom-fields.dto.js';
import type { MovementView, StockPositionView } from '../movements/movements.dto.js';
import type { NodeTreeView, NodeView } from '../nodes/nodes.dto.js';
import type { OpenCustodyView } from '../stock/stock.dto.js';
import type {
  BatchView, MediaView, ProductCodeView, ProductView,
} from '../products/products.dto.js';
import type { OrganizationView, UserView } from './shared.dto.js';

export const userView = (u: User): UserView => ({
  id: u.id,
  email: u.email,
  name: u.name,
  roles: [...u.roles],
  active: u.active,
  version: u.version,
});

export const organizationView = (o: Organization): OrganizationView => ({ id: o.id, name: o.name, slug: o.slug });

/** `{ data, page: { nextCursor, hasMore } }` — the envelope of spec 03 §6. */
export const pageView = <T, V>(page: Page<T>, view: (item: T) => V) => ({
  data: page.data.map(view),
  page: { nextCursor: page.nextCursor, hasMore: page.hasMore },
});

// ── Catalogue (spec 11 §7). The entity never leaves: a view is the contract.

export const mediaView = (m: StoredMedia): MediaView => ({
  id: m.id,
  storageKey: m.storageKey,
  contentType: m.contentType,
  byteSize: m.byteSize,
  position: m.position,
});

export const productView = (p: Product, media?: readonly StoredMedia[]): ProductView => ({
  id: p.id,
  sku: p.sku,
  name: p.name,
  ...(p.description !== undefined ? { description: p.description } : {}),
  trackingMode: p.trackingMode,
  uom: p.uom,
  active: p.active,
  customFields: p.customFields.toJSON(),
  version: p.version,
  ...(media !== undefined ? { media: media.map(mediaView) } : {}),
});

export const productCodeView = (c: ProductCode): ProductCodeView => ({
  id: c.id,
  productId: c.productId,
  value: c.value,
  kind: c.kind,
});

export const batchView = (b: Batch): BatchView => ({
  id: b.id,
  productId: b.productId,
  ...(b.lotCode !== undefined ? { lotCode: b.lotCode } : {}),
  ...(b.serial !== undefined ? { serial: b.serial } : {}),
  ...(b.expiresAt !== undefined ? { expiresAt: b.expiresAt.toISOString() } : {}),
  customFields: b.customFields.toJSON(),
});

export const customFieldView = (d: CustomFieldDefinition): CustomFieldView => ({
  id: d.id,
  entity: d.entity,
  key: d.key,
  label: d.label,
  type: d.type,
  ...(d.options !== undefined ? { options: [...d.options] } : {}),
  required: d.required,
  position: d.position,
  version: d.version,
});

// ── Locations (spec 12 §7). The entity never leaves: a view is the contract.

export const nodeView = (n: Node): NodeView => ({
  id: n.id,
  kind: n.kind,
  code: n.code,
  name: n.name,
  ...(n.parentId !== undefined ? { parentId: n.parentId } : {}),
  path: n.path,
  active: n.active,
  customFields: n.customFields.toJSON(),
  version: n.version,
});

/** Recursive, like the tree it renders (decision D-11). */
export const nodeTreeView = (t: NodeTree): NodeTreeView => ({
  node: nodeView(t.node),
  children: t.children.map(nodeTreeView),
});

// ── The ledger (spec 12 §7). The entity never leaves: a view is the contract.

export const movementView = (m: Movement): MovementView => ({
  id: m.id,
  productId: m.productId,
  ...(m.batchId !== undefined ? { batchId: m.batchId } : {}),
  fromNodeId: m.fromNodeId,
  toNodeId: m.toNodeId,
  // A string, out as well as in: a JSON number would lose the third decimal on
  // the way to a client that parses it as a double.
  quantity: m.quantity.toString(),
  occurredAt: m.occurredAt.toISOString(),
  recordedAt: m.recordedAt.toISOString(),
  actorId: m.actorId,
  ...(m.reason !== undefined ? { reason: m.reason } : {}),
  ...(m.dueAt !== undefined ? { dueAt: m.dueAt.toISOString() } : {}),
  ...(m.reversesId !== undefined ? { reversesId: m.reversesId } : {}),
  ...(m.settlesId !== undefined ? { settlesId: m.settlesId } : {}),
  ...(m.processInstanceId !== undefined ? { processInstanceId: m.processInstanceId } : {}),
});

export const stockPositionView = (p: StockPosition): StockPositionView => ({
  nodeId: p.nodeId,
  productId: p.productId,
  ...(p.batchId !== undefined ? { batchId: p.batchId } : {}),
  nodeKind: p.nodeKind,
  quantity: p.quantity.toString(),
});

export const custodyView = (c: OpenCustody): OpenCustodyView => ({
  checkOut: movementView(c.checkOut),
  pending: c.pending.toString(),
  overdue: c.overdue,
});
