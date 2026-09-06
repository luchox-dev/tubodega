import type { OrgId, TraceId, UserId } from '@app/common';
import type { Role } from './role.js';

/** Built by the edge from the token and the database; every use case receives it as a value (spec 10 §2). */
export interface RequestContext {
  readonly orgId: OrgId;
  readonly userId: UserId;
  readonly roles: ReadonlySet<Role>;
  readonly traceId: TraceId;
}

/** What the access token carries. Roles here only let the guard reject malformed tokens; authorization uses the database. */
export interface TokenClaims {
  readonly sub: UserId;
  readonly org: OrgId;
  readonly roles: readonly Role[];
  readonly exp: number;
}
