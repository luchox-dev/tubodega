import { Inject, Injectable } from '@nestjs/common';
import {
  CLOCK, EVENT_PUBLISHER, ID_GENERATOR, unwrap,
  type Clock, type EventPublisher, type IdGenerator,
} from '@app/common';
import { CUSTOM_FIELD_REPOSITORY, CustomEntity, type CustomFieldDefinitionRepository } from '@app/catalog';
import { Action, requireAction, type RequestContext } from '@app/tenancy';
import { NodeNotFoundError } from '../../../domain/errors.js';
import type { NodeId } from '../../../domain/ids.js';
import type { Node } from '../../../domain/node.js';
import { inventoryEvent } from '../../events.js';
import { NODE_REPOSITORY, type NodeRepository } from '../../ports/node.repository.js';

export interface UpdateNodeInput {
  readonly id: NodeId;
  readonly name?: string;
  readonly customFields?: Readonly<Record<string, unknown>>;
  /** From If-Match; the repository turns a mismatch into 409 stale-version. */
  readonly expectedVersion: number;
}

/**
 * Name and custom fields, and nothing else. `kind` is denormalised into the
 * ledger and `code` is the path segment, so both are immutable (decision D-25);
 * the place of a node changes through MoveNode, explicitly.
 */
@Injectable()
export class UpdateNode {
  constructor(
    @Inject(NODE_REPOSITORY) private readonly nodes: NodeRepository,
    @Inject(CUSTOM_FIELD_REPOSITORY) private readonly fields: CustomFieldDefinitionRepository,
    @Inject(EVENT_PUBLISHER) private readonly events: EventPublisher,
    @Inject(ID_GENERATOR) private readonly ids: IdGenerator,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(ctx: RequestContext, input: UpdateNodeInput): Promise<Node> {
    requireAction(ctx, Action.MANAGE_NODES);
    const node = await this.nodes.findById(ctx.orgId, input.id);
    if (!node) throw new NodeNotFoundError();

    const defs =
      input.customFields === undefined ? [] : await this.fields.listByEntity(ctx.orgId, CustomEntity.NODE);
    const next = unwrap(node.update(input, defs));

    await this.nodes.save(next, input.expectedVersion);
    await this.events.publish([
      inventoryEvent(this.ids, 'node.updated', ctx.orgId, ctx.traceId, this.clock.now(), {
        nodeId: next.id, code: next.code, path: next.path,
      }),
    ]);
    return next;
  }
}
