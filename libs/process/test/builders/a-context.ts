import { v7 } from 'uuid';
import type { TraceId, UserId } from '@app/common';
import { Role, type RequestContext } from '@app/tenancy';
import { ORG } from './a-template.js';

export const aContext = (roles: Role[] = [Role.ADMIN]): RequestContext => ({
  orgId: ORG,
  userId: v7() as UserId,
  roles: new Set(roles),
  traceId: v7() as TraceId,
});
