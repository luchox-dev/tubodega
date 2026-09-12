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
import { Action, type Role } from '../../domain/role.js';
import type { User } from '../../domain/user.js';
import { requireAction } from '../authorize.js';
import { tenancyEvent } from '../events.js';
import { USER_REPOSITORY, type UserRepository } from '../ports/user.repository.js';

export interface UpdateUserRolesInput {
  readonly id: UserId;
  readonly roles: readonly Role[];
  /** From If-Match; the repository turns a mismatch into 409 stale-version. */
  readonly expectedVersion: number;
}

@Injectable()
export class UpdateUserRoles {
  constructor(
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(EVENT_PUBLISHER) private readonly events: EventPublisher,
    @Inject(ID_GENERATOR) private readonly ids: IdGenerator,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(ctx: RequestContext, input: UpdateUserRolesInput): Promise<User> {
    requireAction(ctx, Action.MANAGE_USERS);
    const user = await this.users.findById(ctx.orgId, input.id);
    if (!user) throw new UserNotFoundError();

    // T-2 lives in the domain (spec 10 §10); the count comes from here.
    const next = unwrap(user.withRoles(input.roles, await this.users.countActiveOwners(ctx.orgId)));
    const version = await this.users.save(next, input.expectedVersion);
    await this.events.publish([
      tenancyEvent(this.ids, 'user.roles_changed', ctx.orgId, ctx.traceId, this.clock.now(), {
        userId: user.id,
        roles: [...next.roles],
      }),
    ]);
    return next.withVersion(version);
  }
}
