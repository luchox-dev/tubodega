import type { Cursor, OrgId, Page } from '@app/common';
import type { NodeCode, NodeId, NodePath } from '../../domain/ids.js';
import type { Node, NodeKind } from '../../domain/node.js';

/** What `GET /v1/nodes` may filter by; anything else is 400 (spec 03 §8). */
export interface NodeFilter {
  readonly kind?: NodeKind;
  readonly active?: boolean;
  /**
   * Already resolved by the use case: the repository filters by path prefix and
   * never by id. Keeping the translation upstairs is what stops `list()` from
   * hiding a second round trip that no double could reproduce. Strict
   * descendants, so it never includes the node itself.
   */
  readonly underPath?: NodePath;
}

export interface NodePage {
  readonly limit: number;
  readonly cursor?: Cursor;
  readonly sort: { readonly field: 'path' | 'code' | 'name' | 'createdAt'; readonly dir: 'asc' | 'desc' };
}

export interface NodeRepository {
  findById(orgId: OrgId, id: NodeId): Promise<Node | null>;
  findByCode(orgId: OrgId, code: NodeCode): Promise<Node | null>;
  findManyByIds(orgId: OrgId, ids: readonly NodeId[]): Promise<Map<string, Node>>;
  /** The strict subtree, ordered by path. `limit` caps it: /tree is the only
   *  read of the module without a cursor (decision D-29). */
  listUnder(orgId: OrgId, path: NodePath, limit: number): Promise<Node[]>;
  /** How many active nodes hang from here — N-3's sibling check (decision D-30). */
  listActiveChildren(orgId: OrgId, path: NodePath, limit: number): Promise<Node[]>;
  list(orgId: OrgId, filter: NodeFilter, page: NodePage): Promise<Page<Node>>;
  /**
   * Insert or update by id with optimistic locking. Raises NodeCodeTakenError.
   * Returns the version the row ended up with: the caller has to be able to
   * hand it back to the client, and only the repository knows it.
   */
  save(node: Node, expectedVersion?: number): Promise<number>;
  /** N-2: rewrites the path of every strict descendant, by prefix. */
  updateSubtreePaths(orgId: OrgId, oldPrefix: NodePath, newPrefix: NodePath): Promise<void>;
}

export const NODE_REPOSITORY = Symbol('NodeRepository');
