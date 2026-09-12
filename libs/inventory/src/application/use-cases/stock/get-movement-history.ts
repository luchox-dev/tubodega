import { Inject, Injectable } from '@nestjs/common';
import type { Cursor, Page, UserId } from '@app/common';
import type { BatchId, ProductId } from '@app/catalog';
import { Action, requireAction, type RequestContext } from '@app/tenancy';
import type { NodeId } from '../../../domain/ids.js';
import type { Movement } from '../../../domain/movement.js';
import { MOVEMENT_REPOSITORY, type MovementPage, type MovementRepository } from '../../ports/movement.repository.js';

export interface GetMovementHistoryInput {
  readonly productId?: ProductId;
  /** Either end: "everything that touched this shelf". */
  readonly nodeId?: NodeId;
  readonly batchId?: BatchId;
  readonly actorId?: UserId;
  readonly from?: Date;
  readonly to?: Date;
}

export interface GetMovementHistoryPage {
  readonly limit: number;
  readonly cursor?: Cursor;
  readonly sort: MovementPage['sort'];
}

/** The ledger, read. Append-only, so what came out yesterday is still there. */
@Injectable()
export class GetMovementHistory {
  constructor(@Inject(MOVEMENT_REPOSITORY) private readonly movements: MovementRepository) {}

  async execute(
    ctx: RequestContext, input: GetMovementHistoryInput, page: GetMovementHistoryPage,
  ): Promise<Page<Movement>> {
    requireAction(ctx, Action.READ);
    const { limit, cursor, sort } = page;
    return this.movements.list(ctx.orgId, input, {
      limit, sort, ...(cursor !== undefined ? { cursor } : {}),
    });
  }
}
