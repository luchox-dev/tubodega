import { Inject, Injectable } from '@nestjs/common';
import { Action, requireAction, type RequestContext } from '@app/tenancy';
import { MovementNotFoundError } from '../../../domain/errors.js';
import type { MovementId } from '../../../domain/ids.js';
import type { Movement } from '../../../domain/movement.js';
import { MOVEMENT_REPOSITORY, type MovementRepository } from '../../ports/movement.repository.js';

@Injectable()
export class GetMovementById {
  constructor(@Inject(MOVEMENT_REPOSITORY) private readonly movements: MovementRepository) {}

  async execute(ctx: RequestContext, id: MovementId): Promise<Movement> {
    requireAction(ctx, Action.READ);
    // Scoped by organization, so one from another tenant is a 404 and never a
    // 403: telling them apart would confirm the row exists (I-6).
    const movement = await this.movements.findById(ctx.orgId, id);
    if (!movement) throw new MovementNotFoundError();
    return movement;
  }
}
