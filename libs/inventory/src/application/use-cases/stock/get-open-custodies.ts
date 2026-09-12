import { Inject, Injectable } from '@nestjs/common';
import { CLOCK, type Clock, type Cursor, type Page } from '@app/common';
import { Action, requireAction, type RequestContext } from '@app/tenancy';
import type { NodeId } from '../../../domain/ids.js';
import type { Movement } from '../../../domain/movement.js';
import type { Quantity } from '../../../domain/quantity.js';
import { MOVEMENT_REPOSITORY, type MovementPage, type MovementRepository } from '../../ports/movement.repository.js';

export interface OpenCustody {
  readonly checkOut: Movement;
  /** The check-out's quantity minus everything that has settled it. */
  readonly pending: Quantity;
  readonly overdue: boolean;
}

export interface GetOpenCustodiesInput {
  readonly nodeId?: NodeId;
  readonly overdueOnly?: boolean;
}

export interface GetOpenCustodiesPage {
  readonly limit: number;
  readonly cursor?: Cursor;
  readonly sort: MovementPage['sort'];
}

/**
 * *"What is on loan and has not come back?"* — **by loan**, not by balance.
 * Each check-out with a pending amount above zero is a row, with its own dueAt.
 * This is the query `settlesId` (I-17) exists to make possible: over the
 * aggregate balance of the custody node there would be no way to say which of
 * two loans of the same product is still open.
 */
@Injectable()
export class GetOpenCustodies {
  constructor(
    @Inject(MOVEMENT_REPOSITORY) private readonly movements: MovementRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(
    ctx: RequestContext, input: GetOpenCustodiesInput, page: GetOpenCustodiesPage,
  ): Promise<Page<OpenCustody>> {
    requireAction(ctx, Action.READ);
    // `now` is decided here and handed down: overdue is a question about the
    // present, and infrastructure has no business knowing what the present is.
    const now = this.clock.now();
    const { limit, cursor, sort } = page;

    const found = await this.movements.listOpenCustodies(
      ctx.orgId,
      {
        ...(input.nodeId !== undefined ? { nodeId: input.nodeId } : {}),
        ...(input.overdueOnly === true ? { overdueBefore: now } : {}),
      },
      { limit, sort, ...(cursor !== undefined ? { cursor } : {}) },
    );

    return {
      ...found,
      data: found.data.map((row) => ({
        ...row,
        overdue: row.checkOut.dueAt !== undefined && row.checkOut.dueAt < now,
      })),
    };
  }
}
