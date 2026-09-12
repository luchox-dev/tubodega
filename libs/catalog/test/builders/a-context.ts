import { v7 } from 'uuid';
import type { OrgId, TraceId, UserId } from '@app/common';
import { Role, type RequestContext } from '@app/tenancy';
import { ORG } from './a-custom-field.js';

export const aContext = (roles: Role[] = [Role.ADMIN]): RequestContext => ({
  orgId: ORG,
  userId: v7() as UserId,
  roles: new Set(roles),
  traceId: v7() as TraceId,
});

export const otherOrg = '018f0000-0000-7000-8000-000000000002' as OrgId;
