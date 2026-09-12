import { Inject, Injectable } from '@nestjs/common';
import {
  CLOCK, EVENT_PUBLISHER, ID_GENERATOR,
  type Clock, type EventPublisher, type IdGenerator,
} from '@app/common';
import { Action, requireAction, type RequestContext } from '@app/tenancy';
import { NodeHasChildrenError, NodeHasStockError, NodeNotFoundError } from '../../../domain/errors.js';
import type { NodeId } from '../../../domain/ids.js';
import { inventoryEvent } from '../../events.js';
import { NODE_REPOSITORY, type NodeRepository } from '../../ports/node.repository.js';
import { STOCK_BALANCE_REPOSITORY, type StockBalanceRepository } from '../../ports/stock-balance.repository.js';

/** Enough to act on, few enough that the error stays an error and not a dump. */
const MAX_IN_ERROR = 20;

@Injectable()
export class DeactivateNode {
  constructor(
    @Inject(NODE_REPOSITORY) private readonly nodes: NodeRepository,
    @Inject(STOCK_BALANCE_REPOSITORY) private readonly balances: StockBalanceRepository,
    @Inject(EVENT_PUBLISHER) private readonly events: EventPublisher,
    @Inject(ID_GENERATOR) private readonly ids: IdGenerator,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(ctx: RequestContext, id: NodeId): Promise<void> {
    requireAction(ctx, Action.MANAGE_NODES);
    const node = await this.nodes.findById(ctx.orgId, id);
    if (!node) throw new NodeNotFoundError();
    if (!node.active) return;

    // N-3. Deactivating a node that still holds stock would leave goods in a
    // place the system says it does not operate. The error names what is there,
    // so the user knows what to empty first.
    const positions = await this.balances.positionsIn(ctx.orgId, { nodeId: id }, MAX_IN_ERROR + 1);
    if (positions.length > 0) throw new NodeHasStockError(node.path, positions, MAX_IN_ERROR);

    // Decision D-30. Neither a cascade — a DELETE of one resource must not write
    // N rows the client never named — nor a shrug, which would hang an operable
    // subtree from a place that says it does not operate.
    const children = await this.nodes.listActiveChildren(ctx.orgId, node.path, MAX_IN_ERROR + 1);
    if (children.length > 0) {
      throw new NodeHasChildrenError(node.path, children.map((c) => c.path), MAX_IN_ERROR);
    }

    await this.nodes.save(node.deactivate(), node.version);
    await this.events.publish([
      inventoryEvent(this.ids, 'node.deactivated', ctx.orgId, ctx.traceId, this.clock.now(), {
        nodeId: node.id, code: node.code, path: node.path,
      }),
    ]);
  }
}
