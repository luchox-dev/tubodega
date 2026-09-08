import { Inject, Injectable } from '@nestjs/common';
import { InvalidCredentialsError } from '../../domain/errors.js';
import type { RequestContext } from '../../domain/request-context.js';
import { PASSWORD_HASHER, type PasswordHasher } from '../ports/password-hasher.js';
import { USER_REPOSITORY, type UserRepository } from '../ports/user.repository.js';

/**
 * The user's own password, and only with the current one (spec 10 §7). Open
 * sessions are not revoked: nothing in the specs asks for it, and doing it
 * silently would log the person out of their other devices without warning.
 */
@Injectable()
export class ChangePassword {
  constructor(
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(PASSWORD_HASHER) private readonly hasher: PasswordHasher,
  ) {}

  async execute(ctx: RequestContext, input: { readonly current: string; readonly next: string }): Promise<void> {
    const user = await this.users.findById(ctx.orgId, ctx.userId);
    if (!user) throw new InvalidCredentialsError();
    if (!(await this.hasher.verify(input.current, user.passwordHash))) throw new InvalidCredentialsError();
    await this.users.save(user.withPasswordHash(await this.hasher.hash(input.next)));
  }
}
