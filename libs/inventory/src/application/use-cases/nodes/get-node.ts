import { Inject, Injectable } from '@nestjs/common';
import { Action, requireAction, type RequestContext } from '@app/tenancy';
import { NodeNotFoundError } from '../../../domain/errors.js';
import type { NodeId } from '../../../domain/ids.js';
import type { Node } from '../../../domain/node.js';
import { NODE_REPOSITORY, type NodeRepository } from '../../ports/node.repository.js';

@Injectable()
export class GetNode {
  constructor(@Inject(NODE_REPOSITORY) private readonly nodes: NodeRepository) {}

  async execute(ctx: RequestContext, id: NodeId): Promise<Node> {
    requireAction(ctx, Action.READ);
    const node = await this.nodes.findById(ctx.orgId, id);
    if (!node) throw new NodeNotFoundError();
    return node;
  }
}
