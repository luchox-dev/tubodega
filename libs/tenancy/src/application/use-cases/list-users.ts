import { Inject, Injectable } from '@nestjs/common';
import type { Cursor, Page } from '@app/common';
import type { RequestContext } from '../../domain/request-context.js';
import { Action, type Role } from '../../domain/role.js';
import type { User } from '../../domain/user.js';
import { requireAction } from '../authorize.js';
import { USER_REPOSITORY, type UserRepository } from '../ports/user.repository.js';

export interface ListUsersInput {
  readonly active?: boolean;
  readonly role?: Role;
  readonly limit: number;
  readonly cursor?: Cursor;
  readonly sort: { readonly field: 'name' | 'email'; readonly dir: 'asc' | 'desc' };
}

@Injectable()
export class ListUsers {
  constructor(@Inject(USER_REPOSITORY) private readonly users: UserRepository) {}

  // async, like every other use case: authorization must fail as a rejected
  // promise, not as a synchronous throw the caller has to catch differently.
  async execute(ctx: RequestContext, input: ListUsersInput): Promise<Page<User>> {
    requireAction(ctx, Action.MANAGE_USERS);
    const { limit, cursor, sort, ...filter } = input;
    return this.users.listPage(ctx.orgId, filter, { limit, cursor, sort });
  }
}
