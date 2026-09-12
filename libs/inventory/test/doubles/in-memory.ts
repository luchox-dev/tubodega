// In-memory doubles for the inventory ports. They keep the invariants the
// database keeps — the unique (org_id, code) and the subtree rewrite of N-2 —
// so a use-case test fails for the same reason production would, and not one
// step later.
import { decodeCursor, encodeCursor, type OrgId, type Page } from '@app/common';
import type { CustomEntity, CustomFieldDefinition, CustomFieldDefinitionRepository } from '@app/catalog';
import {
  Node, NodeCodeTakenError, NodePath,
  type NodeCode, type NodeFilter, type NodeId, type NodePage, type NodeRepository,
  type StockBalanceRepository, type StockPositionRow, type StockScope,
} from '@app/inventory';

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

export class InMemoryStockBalanceRepository implements StockBalanceRepository {
  /** Keyed by nodeId, so a test can park stock on a node in one line. */
  readonly byNode = new Map<string, StockPositionRow[]>();

  async hasAnyStock(orgId: OrgId, scope: StockScope): Promise<boolean> {
    return (await this.positionsIn(orgId, scope, 1)).length > 0;
  }

  async positionsIn(_orgId: OrgId, scope: StockScope, cap: number): Promise<readonly StockPositionRow[]> {
    const rows = scope.nodeId === undefined ? [] : (this.byNode.get(scope.nodeId) ?? []);
    return rows
      .filter((r) => scope.productId === undefined || r.productId === scope.productId)
      .slice(0, cap);
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
