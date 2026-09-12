import { Inject, Injectable } from '@nestjs/common';
import { Action, requireAction, type RequestContext } from '@app/tenancy';
import { NodeNotFoundError, TreeTooLargeError } from '../../../domain/errors.js';
import type { NodeId } from '../../../domain/ids.js';
import type { Node } from '../../../domain/node.js';
import { NODE_REPOSITORY, type NodeRepository } from '../../ports/node.repository.js';

export interface NodeTree {
  readonly node: Node;
  readonly children: readonly NodeTree[];
}

/** Decision D-29: /tree is the only read of the module without a cursor, so it
 *  is the only one that needs a ceiling of its own. */
export const MAX_TREE_NODES = 1000;

/**
 * Two passes, O(n), no recursion — and deliberately order-independent. Ordering
 * by `path` does put every parent before its children (a parent's path is a
 * strict prefix of its child's), but leaning on that would tie the result to
 * the database collation. Building the map first costs nothing and removes the
 * assumption.
 *
 * Every parent is present: `listUnder` returns the whole subtree by path prefix
 * and N-1 guarantees the path reflects the real chain of parents.
 */
export function buildTree(root: Node, descendants: readonly Node[]): NodeTree {
  const entries = new Map<string, { node: Node; children: NodeTree[] }>();
  entries.set(root.id, { node: root, children: [] });
  for (const n of descendants) entries.set(n.id, { node: n, children: [] });
  for (const n of descendants) entries.get(n.parentId!)?.children.push(entries.get(n.id)!);
  return entries.get(root.id)!;
}

@Injectable()
export class GetNodeTree {
  constructor(@Inject(NODE_REPOSITORY) private readonly nodes: NodeRepository) {}

  async execute(ctx: RequestContext, id: NodeId): Promise<NodeTree> {
    requireAction(ctx, Action.READ);
    const root = await this.nodes.findById(ctx.orgId, id);
    if (!root) throw new NodeNotFoundError();

    // One over the cap, so "too many" is distinguishable from "exactly the cap".
    const descendants = await this.nodes.listUnder(ctx.orgId, root.path, MAX_TREE_NODES + 1);
    if (descendants.length > MAX_TREE_NODES) throw new TreeTooLargeError(root.path, MAX_TREE_NODES);

    // Inactive nodes stay in: one deactivated shelf between an active zone and
    // an active bin cannot be dropped without orphaning its children (D-29).
    return buildTree(root, descendants);
  }
}
