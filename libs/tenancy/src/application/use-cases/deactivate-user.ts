import { Inject, Injectable } from '@nestjs/common';
import {
  CLOCK,
  EVENT_PUBLISHER,
  ID_GENERATOR,
  unwrap,
  type Clock,
  type EventPublisher,
  type IdGenerator,
  type UserId,
} from '@app/common';
import { UserNotFoundError } from '../../domain/errors.js';
import type { RequestContext } from '../../domain/request-context.js';
import { Action } from '../../domain/role.js';
import { requireAction } from '../authorize.js';
import { tenancyEvent } from '../events.js';
import { USER_REPOSITORY, type UserRepository } from '../ports/user.repository.js';

/**
 * Deactivates instead of deleting: movements reference their actor, and the
 * ledger admits no gaps (spec 10 §7).
 */
@Injectable()
export class DeactivateUser {
  constructor(
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(EVENT_PUBLISHER) private readonly events: EventPublisher,
    @Inject(ID_GENERATOR) private readonly ids: IdGenerator,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(ctx: RequestContext, input: { readonly id: UserId }): Promise<void> {
    requireAction(ctx, Action.MANAGE_USERS);
    const user = await this.users.findById(ctx.orgId, input.id);
    if (!user) throw new UserNotFoundError();
    // Already inactive: nothing changed, so nothing is announced.
    if (!user.active) return;

    const next = unwrap(user.deactivate(await this.users.countActiveOwners(ctx.orgId)));
    await this.users.save(next);
    await this.events.publish([
      tenancyEvent(this.ids, 'user.deactivated', ctx.orgId, ctx.traceId, this.clock.now(), { userId: user.id }),
    ]);
  }
}
