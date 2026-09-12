// In-memory doubles for the inventory ports. They keep the invariants the
// database keeps — the unique (org_id, code) and the subtree rewrite of N-2 —
// so a use-case test fails for the same reason production would, and not one
// step later.
import { decodeCursor, encodeCursor, type OrgId, type Page } from '@app/common';
import type { CustomEntity, CustomFieldDefinition, CustomFieldDefinitionRepository } from '@app/catalog';
import {
  AlreadyReversedError, InsufficientStockSignal, MovementIdTakenError,
  Node, NodeCodeTakenError, NodePath, Quantity, isCustodialKind,
  type BalanceDelta, type Movement, type MovementFilter, type MovementId,
  type MovementPage, type MovementRepository, type NodeCode, type NodeFilter,
  type NodeId, type NodeKind, type NodePage, type NodeRepository,
  type OpenCustodyFilter, type OpenCustodyRow, type StockBalanceRepository,
  type StockPage, type StockPosition, type StockPositionRow, type StockQuery,
  type StockScope,
} from '@app/inventory';
import type { BatchId, ProductId } from '@app/catalog';

const key = (orgId: string, id: string) => `${orgId}:${id}`;

/** Stands in for the VersionConflictError the DAO raises; the edge turns that
 *  one into 409 stale-version. */
export class StaleVersionError extends Error {
  constructor(id: string, expected: number, actual: number) {
    super(`node#${id}: se esperaba la versión ${expected} y hay la ${actual}`);
    this.name = 'StaleVersionError';
  }
}

export class InMemoryNodeRepository implements NodeRepository {
  readonly rows = new Map<string, Node>();

  private all(orgId: OrgId): Node[] {
    return [...this.rows.values()].filter((n) => n.orgId === orgId);
  }

  async findById(orgId: OrgId, id: NodeId): Promise<Node | null> {
    return this.rows.get(key(orgId, id)) ?? null;
  }

  async findByCode(orgId: OrgId, code: NodeCode): Promise<Node | null> {
    return this.all(orgId).find((n) => n.code === code) ?? null;
  }

  async findManyByIds(orgId: OrgId, ids: readonly NodeId[]): Promise<Map<string, Node>> {
    const wanted = new Set<string>(ids);
    return new Map(this.all(orgId).filter((n) => wanted.has(n.id)).map((n) => [n.id, n]));
  }

  async listUnder(orgId: OrgId, path: NodePath, limit: number): Promise<Node[]> {
    const prefix = NodePath.descendantPrefix(path);
    return this.all(orgId)
      .filter((n) => n.path.startsWith(prefix))
      .sort((a, b) => (a.path < b.path ? -1 : 1))
      .slice(0, limit);
  }

  async listActiveChildren(orgId: OrgId, path: NodePath, limit: number): Promise<Node[]> {
    return (await this.listUnder(orgId, path, Number.MAX_SAFE_INTEGER))
      .filter((n) => n.active)
      .slice(0, limit);
  }

  async list(orgId: OrgId, filter: NodeFilter, page: NodePage): Promise<Page<Node>> {
    const prefix = filter.underPath === undefined ? undefined : NodePath.descendantPrefix(filter.underPath);
    const sorted = this.all(orgId)
      .filter((n) => filter.kind === undefined || n.kind === filter.kind)
      .filter((n) => filter.active === undefined || n.active === filter.active)
      .filter((n) => prefix === undefined || n.path.startsWith(prefix))
      .sort((a, b) => (a.path < b.path ? -1 : 1));
    // The double honours the cursor, like the keyset does: a page that silently
    // restarts would let a paging bug through every use-case test.
    const after = page.cursor === undefined ? null : (decodeCursor(page.cursor)?.[0] ?? null);
    const from = after === null ? 0 : sorted.findIndex((n) => n.id === after) + 1;
    const all = sorted.slice(from);
    const data = all.slice(0, page.limit);
    const hasMore = all.length > page.limit;
    return { data, hasMore, ...(hasMore ? { nextCursor: encodeCursor([data.at(-1)!.id]) } : {}) };
  }

  async save(node: Node, expectedVersion?: number): Promise<number> {
    // The unique index the database holds, so the double raises where it raises.
    for (const n of this.rows.values()) {
      if (n.orgId === node.orgId && n.code === node.code && n.id !== node.id) {
        throw new NodeCodeTakenError(node.code);
      }
    }
    // And the optimistic lock, for the same reason: a double that always wins
    // the race cannot fail the test that a stale If-Match must fail.
    const current = this.rows.get(key(node.orgId, node.id));
    if (expectedVersion !== undefined && current !== undefined && current.version !== expectedVersion) {
      throw new StaleVersionError(node.id, expectedVersion, current.version);
    }
    // The database bumps on update and starts at 1 on insert; the double does
    // the same, or the caller could not tell the two apart.
    const stored = current === undefined ? node : node.withVersion(current.version + 1);
    this.rows.set(key(node.orgId, node.id), stored);
    return stored.version;
  }

  /** N-2, by prefix and strict, exactly like the bulk UPDATE. */
  async updateSubtreePaths(orgId: OrgId, oldPrefix: NodePath, newPrefix: NodePath): Promise<void> {
    const prefix = NodePath.descendantPrefix(oldPrefix);
    for (const n of this.all(orgId)) {
      if (!n.path.startsWith(prefix)) continue;
      this.rows.set(
        key(orgId, n.id),
        Node.rehydrate({
          id: n.id, orgId: n.orgId, kind: n.kind, code: n.code, name: n.name,
          ...(n.parentId !== undefined ? { parentId: n.parentId } : {}),
          path: `${newPrefix}${n.path.slice(oldPrefix.length)}` as NodePath,
          active: n.active, customFields: n.customFields, version: n.version + 1,
        }),
      );
    }
  }
}

const positionKey = (nodeId: string, productId: string, batchId?: string) =>
  `${nodeId}|${productId}|${batchId ?? ''}`;

const page = <T>(all: readonly T[], limit: number, cursorOf: (item: T) => string, cursor?: string): Page<T> => {
  const after = cursor === undefined ? null : (decodeCursor(cursor as never)?.[0] ?? null);
  const from = after === null ? 0 : all.findIndex((i) => cursorOf(i) === after) + 1;
  const rest = all.slice(from);
  const data = rest.slice(0, limit);
  const hasMore = rest.length > limit;
  return { data, hasMore, ...(hasMore ? { nextCursor: encodeCursor([cursorOf(data.at(-1)!)]) } : {}) };
};

/**
 * Holds real positions, keyed by the natural key the unique index uses, and
 * **simulates I-4**: `applyDelta` raises `InsufficientStockSignal` when a
 * custodial node would go negative and reverts its own writes first. A double
 * that did not revert would be lying about the savepoint, and the
 * insufficient-stock test would pass over a corrupted balance.
 */
export class InMemoryStockBalanceRepository implements StockBalanceRepository {
  readonly positions = new Map<string, StockPosition>();

  /** Optional, and only `sumUnder` needs it: a position knows its node's id, not its path. */
  constructor(private readonly nodes?: InMemoryNodeRepository) {}

  /** Arrange helper: park stock without going through a movement. */
  park(
    nodeId: NodeId,
    productId: string,
    quantity: string,
    o: { batchId?: string; nodeKind?: NodeKind } = {},
  ): void {
    const position: StockPosition = {
      nodeId,
      productId: productId as ProductId,
      ...(o.batchId !== undefined ? { batchId: o.batchId as BatchId } : {}),
      nodeKind: o.nodeKind ?? ('INTERNAL' as NodeKind),
      quantity: Quantity.rehydrate(quantity),
    };
    this.positions.set(positionKey(nodeId, productId, o.batchId), position);
  }

  private all(): StockPosition[] {
    return [...this.positions.values()];
  }

  async hasAnyStock(orgId: OrgId, scope: StockScope): Promise<boolean> {
    return (await this.positionsIn(orgId, scope, 1)).length > 0;
  }

  async positionsIn(_orgId: OrgId, scope: StockScope, cap: number): Promise<readonly StockPositionRow[]> {
    return this.all()
      .filter((p) => scope.nodeId === undefined || p.nodeId === scope.nodeId)
      .filter((p) => scope.productId === undefined || p.productId === scope.productId)
      .filter((p) => !p.quantity.isZero())
      .sort((a, b) => (a.productId < b.productId ? -1 : 1))
      .slice(0, cap)
      .map((p) => ({
        productId: p.productId,
        ...(p.batchId !== undefined ? { batchId: p.batchId } : {}),
        quantity: p.quantity.toString(),
      }));
  }

  async find(
    _orgId: OrgId, nodeId: NodeId, productId: ProductId, batchId?: BatchId,
  ): Promise<StockPosition | null> {
    return this.positions.get(positionKey(nodeId, productId, batchId)) ?? null;
  }

  async query(_orgId: OrgId, q: StockQuery, p: StockPage): Promise<Page<StockPosition>> {
    const under = q.underPath === undefined ? undefined : NodePath.descendantPrefix(q.underPath);
    const rows = this.all()
      .filter((x) => q.productId === undefined || x.productId === q.productId)
      .filter((x) => q.nodeId === undefined || x.nodeId === q.nodeId)
      .filter((x) => q.batchId === undefined || x.batchId === q.batchId)
      .filter((x) => under === undefined || (this.pathOf(x.nodeId) ?? '').startsWith(under))
      .filter((x) => q.custodialOnly !== true || isCustodialKind(x.nodeKind))
      .filter((x) => q.nonZeroOnly === false || !x.quantity.isZero())
      .sort((a, b) => (positionKey(a.nodeId, a.productId, a.batchId) < positionKey(b.nodeId, b.productId, b.batchId) ? -1 : 1));
    return page(rows, p.limit, (x) => positionKey(x.nodeId, x.productId, x.batchId), p.cursor);
  }

  private pathOf(nodeId: NodeId): string | undefined {
    for (const n of this.nodes?.rows.values() ?? []) if (n.id === nodeId) return n.path;
    return undefined;
  }

  async sumUnder(_orgId: OrgId, path: NodePath, productId?: ProductId): Promise<StockPosition[]> {
    const prefix = NodePath.descendantPrefix(path);
    const totals = new Map<string, StockPosition>();
    for (const p of this.all()) {
      const nodePath = this.pathOf(p.nodeId);
      if (nodePath === undefined || !(nodePath === path || nodePath.startsWith(prefix))) continue;
      if (productId !== undefined && p.productId !== productId) continue;
      if (!isCustodialKind(p.nodeKind)) continue;
      const k = positionKey('', p.productId, p.batchId);
      const seen = totals.get(k);
      totals.set(k, seen === undefined ? p : { ...seen, quantity: seen.quantity.plus(p.quantity) });
    }
    return [...totals.values()];
  }

  async custodialTotal(_orgId: OrgId, batchId: BatchId): Promise<Quantity> {
    return this.all()
      .filter((p) => p.batchId === batchId && isCustodialKind(p.nodeKind))
      .reduce((sum, p) => sum.plus(p.quantity), Quantity.zero());
  }

  async applyDelta(_orgId: OrgId, deltas: readonly BalanceDelta[]): Promise<StockPosition[]> {
    const ordered = [...deltas].sort((a, b) =>
      positionKey(a.nodeId, a.productId, a.batchId) < positionKey(b.nodeId, b.productId, b.batchId) ? -1 : 1);
    const snapshot = new Map(this.positions);
    const out: StockPosition[] = [];

    for (const d of ordered) {
      const k = positionKey(d.nodeId, d.productId, d.batchId);
      const before = snapshot.get(k)?.quantity ?? Quantity.zero();
      const after = before.plus(d.delta);

      // I-4: only the boundary of the system may go negative.
      if (after.isNegative() && isCustodialKind(d.nodeKind)) {
        this.positions.clear();
        for (const [key2, value] of snapshot) this.positions.set(key2, value);
        throw new InsufficientStockSignal({
          nodeId: d.nodeId,
          productId: d.productId,
          ...(d.batchId !== undefined ? { batchId: d.batchId } : {}),
          available: before,
        });
      }

      const position: StockPosition = {
        nodeId: d.nodeId,
        productId: d.productId,
        ...(d.batchId !== undefined ? { batchId: d.batchId } : {}),
        nodeKind: d.nodeKind,
        quantity: after,
      };
      this.positions.set(k, position);
      out.push(position);
    }
    return out;
  }
}

/**
 * Keeps the two indexes the table has: the primary key on the client's id, and
 * the partial UNIQUE (org_id, reverses_id) that is I-13. No update, no delete —
 * the port does not have them, and neither does the double (I-3).
 */
export class InMemoryMovementRepository implements MovementRepository {
  readonly rows: Movement[] = [];

  private of(orgId: OrgId): Movement[] {
    return this.rows.filter((m) => m.orgId === orgId);
  }

  async findById(orgId: OrgId, id: MovementId): Promise<Movement | null> {
    return this.of(orgId).find((m) => m.id === id) ?? null;
  }

  async existsReversalOf(orgId: OrgId, id: MovementId): Promise<boolean> {
    return this.of(orgId).some((m) => m.reversesId === id);
  }

  /** I-18: a check-in that was itself compensated stops counting, and the loan re-opens. */
  async settledQuantity(orgId: OrgId, checkOutId: MovementId): Promise<Quantity> {
    const reversed = new Set(this.of(orgId).map((m) => m.reversesId).filter(Boolean));
    return this.of(orgId)
      .filter((m) => m.settlesId === checkOutId && !reversed.has(m.id))
      .reduce((sum, m) => sum.plus(m.quantity), Quantity.zero());
  }

  async listOpenCustodies(
    orgId: OrgId, filter: OpenCustodyFilter, p: MovementPage,
  ): Promise<Page<OpenCustodyRow>> {
    const rows: OpenCustodyRow[] = [];
    for (const m of this.of(orgId)) {
      if (m.toNodeKind !== 'CUSTODY') continue;
      if (m.settlesId !== undefined || m.reversesId !== undefined) continue;
      if (filter.nodeId !== undefined && m.toNodeId !== filter.nodeId) continue;
      if (filter.overdueBefore !== undefined && !(m.dueAt && m.dueAt < filter.overdueBefore)) continue;
      if (await this.existsReversalOf(orgId, m.id)) continue;
      const pending = m.quantity.minus(await this.settledQuantity(orgId, m.id));
      if (pending.isPositive()) rows.push({ checkOut: m, pending });
    }
    rows.sort((a, b) => a.checkOut.occurredAt.getTime() - b.checkOut.occurredAt.getTime());
    return page(rows, p.limit, (r) => r.checkOut.id, p.cursor);
  }

  async countByProduct(orgId: OrgId, productId: ProductId): Promise<number> {
    return this.of(orgId).filter((m) => m.productId === productId).length;
  }

  async list(orgId: OrgId, f: MovementFilter, p: MovementPage): Promise<Page<Movement>> {
    const rows = this.of(orgId)
      .filter((m) => f.productId === undefined || m.productId === f.productId)
      .filter((m) => f.nodeId === undefined || m.fromNodeId === f.nodeId || m.toNodeId === f.nodeId)
      .filter((m) => f.batchId === undefined || m.batchId === f.batchId)
      .filter((m) => f.actorId === undefined || m.actorId === f.actorId)
      .filter((m) => f.from === undefined || m.occurredAt >= f.from)
      .filter((m) => f.to === undefined || m.occurredAt <= f.to)
      .sort((a, b) => {
        const d = a.occurredAt.getTime() - b.occurredAt.getTime() || (a.id < b.id ? -1 : 1);
        return p.sort.dir === 'asc' ? d : -d;
      });
    return page(rows, p.limit, (m) => m.id, p.cursor);
  }

  async append(movement: Movement): Promise<void> {
    if (this.rows.some((m) => m.id === movement.id)) throw new MovementIdTakenError(movement.id);
    if (
      movement.reversesId !== undefined &&
      this.of(movement.orgId).some((m) => m.reversesId === movement.reversesId)
    ) {
      throw new AlreadyReversedError(movement.reversesId);
    }
    this.rows.push(movement);
  }

  async appendMany(movements: readonly Movement[]): Promise<void> {
    for (const m of movements) await this.append(m);
  }
}

/** Only what the node use cases reach for; the rest of the port is the
 *  catalogue's business and is doubled over there. */
export class InMemoryCustomFieldRepository implements CustomFieldDefinitionRepository {
  readonly rows: CustomFieldDefinition[] = [];

  async findById(_orgId: OrgId, id: string): Promise<CustomFieldDefinition | null> {
    return this.rows.find((d) => d.id === id) ?? null;
  }

  async listByEntity(_orgId: OrgId, entity: CustomEntity): Promise<CustomFieldDefinition[]> {
    return this.rows.filter((d) => d.entity === entity);
  }

  async countEntitiesMissing(): Promise<number> {
    return 0;
  }

  async countEntitiesWith(): Promise<number> {
    return 0;
  }

  // Nodes only ever read the definitions; the version is here to satisfy the
  // port, which carries it for the sake of the catalogue's own PATCH (D-31).
  async save(def: CustomFieldDefinition): Promise<number> {
    this.rows.push(def);
    return def.version;
  }

  /** Convenience for arranging: put a definition in without going through a use case. */
  add(def: CustomFieldDefinition): CustomFieldDefinition {
    this.rows.push(def);
    return def;
  }
}

let seq = 0;
export const fakeIds = { next: () => `018f0000-0000-7000-8000-${String(++seq).padStart(12, '0')}` };
export const fixedClock = { now: () => new Date('2026-09-12T12:00:00.000Z') };

export class RecordingEventPublisher {
  readonly published: { type: string; data: Record<string, unknown> }[] = [];
  async publish(events: readonly { type: string; data: Readonly<Record<string, unknown>> }[]): Promise<void> {
    for (const e of events) this.published.push({ type: e.type, data: { ...e.data } });
  }
  types(): string[] {
    return this.published.map((e) => e.type);
  }
}
