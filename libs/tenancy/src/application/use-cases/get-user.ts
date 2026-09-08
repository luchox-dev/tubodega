import { Inject, Injectable } from '@nestjs/common';
import type { UserId } from '@app/common';
import { UserNotFoundError } from '../../domain/errors.js';
import type { RequestContext } from '../../domain/request-context.js';
import { Action } from '../../domain/role.js';
import type { User } from '../../domain/user.js';
import { requireAction } from '../authorize.js';
import { USER_REPOSITORY, type UserRepository } from '../ports/user.repository.js';

/**
 * Not in the table of spec 10 §7, but the WAVE 1 acceptance walk needs it: it
 * is how «another company sees nothing» is shown to be a 404 and not a 403.
 */
@Injectable()
export class GetUser {
  constructor(@Inject(USER_REPOSITORY) private readonly users: UserRepository) {}

  async execute(ctx: RequestContext, input: { readonly id: UserId }): Promise<User> {
    requireAction(ctx, Action.MANAGE_USERS);
    const user = await this.users.findById(ctx.orgId, input.id);
    if (!user) throw new UserNotFoundError();
    return user;
  }
}
