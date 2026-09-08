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
import type { RequestContext } from '../../domain/request-context.js';
import { Action, type Role } from '../../domain/role.js';
import { User } from '../../domain/user.js';
import { requireAction } from '../authorize.js';
import { tenancyEvent } from '../events.js';
import { PASSWORD_HASHER, type PasswordHasher } from '../ports/password-hasher.js';
import { USER_REPOSITORY, type UserRepository } from '../ports/user.repository.js';

export interface CreateUserInput {
  readonly email: string;
  readonly name: string;
  readonly password: string;
  readonly roles: readonly Role[];
}

/** Spec 10 §4. T-1 (email unique per organization) is enforced by the repository. */
@Injectable()
export class CreateUser {
  constructor(
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(PASSWORD_HASHER) private readonly hasher: PasswordHasher,
    @Inject(EVENT_PUBLISHER) private readonly events: EventPublisher,
    @Inject(ID_GENERATOR) private readonly ids: IdGenerator,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(ctx: RequestContext, input: CreateUserInput): Promise<User> {
    requireAction(ctx, Action.MANAGE_USERS);
    const user = unwrap(
      User.create({
        id: this.ids.next() as UserId,
        orgId: ctx.orgId,
        email: input.email,
        name: input.name,
        passwordHash: await this.hasher.hash(input.password),
        roles: input.roles,
      }),
    );
    await this.users.save(user);
    await this.events.publish([
      tenancyEvent(this.ids, 'user.created', ctx.orgId, ctx.traceId, this.clock.now(), {
        userId: user.id,
        email: user.email,
        roles: [...user.roles],
      }),
    ]);
    return user;
  }
}
