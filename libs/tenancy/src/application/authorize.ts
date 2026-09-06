import { InsufficientRoleError } from '../domain/errors.js';
import type { RequestContext } from '../domain/request-context.js';
import { Action, canAny } from '../domain/role.js';

/** Authorization by action against the roles loaded from the database, never from the token (spec 07 §3). */
export function requireAction(ctx: RequestContext, action: Action): void {
  if (!canAny(ctx.roles, action)) throw new InsufficientRoleError(action);
}
