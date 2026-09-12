import { Inject, Injectable } from '@nestjs/common';
import type { Cursor, Page } from '@app/common';
import { Action, requireAction, type RequestContext } from '@app/tenancy';
import { UnknownFilterNodeError } from '../../../domain/errors.js';
import type { NodeId, NodePath } from '../../../domain/ids.js';
import type { Node, NodeKind } from '../../../domain/node.js';
import { NODE_REPOSITORY, type NodePage, type NodeRepository } from '../../ports/node.repository.js';

export interface ListNodesInput {
  readonly kind?: NodeKind;
  readonly active?: boolean;
  /** A node id; this use case turns it into the path the repository filters by. */
  readonly under?: NodeId;
  readonly limit: number;
  readonly cursor?: Cursor;
  readonly sort: NodePage['sort'];
}

@Injectable()
export class ListNodes {
  constructor(@Inject(NODE_REPOSITORY) private readonly nodes: NodeRepository) {}

  async execute(ctx: RequestContext, input: ListNodesInput): Promise<Page<Node>> {
    requireAction(ctx, Action.READ);
    const { limit, cursor, sort, under, ...filter } = input;

    // Resolved here and not in the repository: the port speaks paths, so `list`
    // never hides a second round trip that no double could reproduce. It also
    // puts the "and if it is not there?" decision in the layer allowed to have
    // business errors — 400 invalid-filter, because `/v1/nodes` does exist and
    // an empty page would be indistinguishable from an empty subtree (D-28).
    let underPath: NodePath | undefined;
    if (under !== undefined) {
      const parent = await this.nodes.findById(ctx.orgId, under);
      if (!parent) throw new UnknownFilterNodeError(under);
      underPath = parent.path;
    }

    return this.nodes.list(
      ctx.orgId,
      { ...filter, ...(underPath !== undefined ? { underPath } : {}) },
      { limit, sort, ...(cursor !== undefined ? { cursor } : {}) },
    );
  }
}
