import type { OrgId, TraceId, UserId } from '@app/common';
import { requireAction } from './authorize.js';
import { InsufficientRoleError } from '../domain/errors.js';
import { Action, Role } from '../domain/role.js';
import type { RequestContext } from '../domain/request-context.js';

const ctx = (roles: Role[]): RequestContext => ({
  orgId: 'o' as OrgId,
  userId: 'u' as UserId,
  roles: new Set(roles),
  traceId: 't' as TraceId,
});

describe('requireAction', () => {
  it('passes when one of the roles grants the action', () => {
    expect(() => requireAction(ctx([Role.VIEWER, Role.OPERATOR]), Action.RECORD_MOVEMENT)).not.toThrow();
  });
  it('throws insufficient-role naming the action otherwise', () => {
    expect(() => requireAction(ctx([Role.OPERATOR]), Action.REVERSE_MOVEMENT)).toThrow(InsufficientRoleError);
    expect(() => requireAction(ctx([]), Action.READ)).toThrow(/READ/);
  });
});
