import { Inject, Injectable } from '@nestjs/common';
import {
  CLOCK, EVENT_PUBLISHER, ID_GENERATOR, unwrap,
  type Clock, type EventPublisher, type IdGenerator,
} from '@app/common';
import { CUSTOM_FIELD_REPOSITORY, CustomEntity, type CustomFieldDefinitionRepository } from '@app/catalog';
import { Action, requireAction, type RequestContext } from '@app/tenancy';
import { ParentNotFoundError, ParentNotInternalError } from '../../../domain/errors.js';
import type { NodeId } from '../../../domain/ids.js';
import { Node, NodeKind } from '../../../domain/node.js';
import { inventoryEvent } from '../../events.js';
import { NODE_REPOSITORY, type NodeRepository } from '../../ports/node.repository.js';

export interface CreateNodeInput {
  readonly kind: NodeKind;
  readonly code: string;
  readonly name: string;
  readonly parentId?: NodeId;
  readonly customFields?: Readonly<Record<string, unknown>>;
}

/**
 * I-10 is checked on both ends here. The schema CHECK only guards the child
 * half (`parent_id IS NULL OR kind = 'INTERNAL'`); that the *parent* is also
 * INTERNAL is something only a query can tell.
 */
@Injectable()
export class CreateNode {
  constructor(
    @Inject(NODE_REPOSITORY) private readonly nodes: NodeRepository,
    @Inject(CUSTOM_FIELD_REPOSITORY) private readonly fields: CustomFieldDefinitionRepository,
    @Inject(EVENT_PUBLISHER) private readonly events: EventPublisher,
    @Inject(ID_GENERATOR) private readonly ids: IdGenerator,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(ctx: RequestContext, input: CreateNodeInput): Promise<Node> {
    requireAction(ctx, Action.MANAGE_NODES);

    let parent: Node | undefined;
    if (input.parentId !== undefined) {
      parent = (await this.nodes.findById(ctx.orgId, input.parentId)) ?? undefined;
      if (!parent) throw new ParentNotFoundError(input.parentId);
      if (parent.kind !== NodeKind.INTERNAL) throw new ParentNotInternalError(parent.code, parent.kind);
      if (input.kind !== NodeKind.INTERNAL) throw new ParentNotInternalError(input.code, input.kind);
    }

    const defs = await this.fields.listByEntity(ctx.orgId, CustomEntity.NODE);
    const node = unwrap(
      Node.create({ id: this.ids.next() as NodeId, orgId: ctx.orgId, ...input }, parent, defs),
    );

    await this.nodes.save(node);
    await this.events.publish([
      inventoryEvent(this.ids, 'node.created', ctx.orgId, ctx.traceId, this.clock.now(), {
        nodeId: node.id, kind: node.kind, code: node.code, path: node.path,
      }),
    ]);
    return node;
  }
}
