import { Inject, Injectable } from '@nestjs/common';
import {
  CLOCK, EVENT_PUBLISHER, ID_GENERATOR,
  type Clock, type EventPublisher, type IdGenerator,
} from '@app/common';
import { Action, requireAction, type RequestContext } from '@app/tenancy';
import { NodeCycleError, NodeNotFoundError, ParentNotFoundError, ParentNotInternalError } from '../../../domain/errors.js';
import type { NodeId } from '../../../domain/ids.js';
import { NodeKind, type Node } from '../../../domain/node.js';
import { inventoryEvent } from '../../events.js';
import { NODE_REPOSITORY, type NodeRepository } from '../../ports/node.repository.js';

export interface MoveNodeInput {
  readonly id: NodeId;
  /** Absent means "to the root". */
  readonly parentId?: NodeId;
  readonly expectedVersion: number;
}

@Injectable()
export class MoveNode {
  constructor(
    @Inject(NODE_REPOSITORY) private readonly nodes: NodeRepository,
    @Inject(EVENT_PUBLISHER) private readonly events: EventPublisher,
    @Inject(ID_GENERATOR) private readonly ids: IdGenerator,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(ctx: RequestContext, input: MoveNodeInput): Promise<Node> {
    requireAction(ctx, Action.MANAGE_NODES);

    const node = await this.nodes.findById(ctx.orgId, input.id);
    if (!node) throw new NodeNotFoundError();

    let parent: Node | undefined;
    if (input.parentId !== undefined) {
      parent = (await this.nodes.findById(ctx.orgId, input.parentId)) ?? undefined;
      if (!parent) throw new ParentNotFoundError(input.parentId);

      // Cycle detection with the path, no recursion (spec 12 §4.1): in a tree
      // the only two ways to make one are hanging a node from itself or from
      // one of its own descendants, and the path already holds the whole chain.
      if (parent.id === node.id || parent.isDescendantOf(node)) {
        throw new NodeCycleError(node.path, parent.path);
      }
      if (parent.kind !== NodeKind.INTERNAL) throw new ParentNotInternalError(parent.code, parent.kind);
      if (node.kind !== NodeKind.INTERNAL) throw new ParentNotInternalError(node.code, node.kind);
    }

    const oldPath = node.path;
    const moved = node.moveTo(parent);
    // Same parent: nothing moved, so no empty UPDATE and no event about a
    // non-event.
    if (moved.path === oldPath) return node;

    // N-1 and N-2, in this order and in the transaction the edge already opened
    // (spec 07 §3). The moved node first: `save` is the cheap check that can
    // fail — stale-version, the composite FK on the new parent — and there is
    // no point rewriting N descendant rows before knowing it passes.
    await this.nodes.save(moved, input.expectedVersion);
    await this.nodes.updateSubtreePaths(ctx.orgId, oldPath, moved.path);

    await this.events.publish([
      inventoryEvent(this.ids, 'node.moved', ctx.orgId, ctx.traceId, this.clock.now(), {
        nodeId: moved.id, fromPath: oldPath, toPath: moved.path,
        ...(moved.parentId !== undefined ? { parentId: moved.parentId } : {}),
      }),
    ]);
    return moved;
  }
}
