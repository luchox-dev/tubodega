import type { Branded } from './brand.js';

export type OrgId = Branded<string, 'OrgId'>;
export type UserId = Branded<string, 'UserId'>;
export type TraceId = Branded<string, 'TraceId'>;
/** Lives here, not in `process`, because `inventory` references it (spec 01 §4). */
export type ProcessInstanceId = Branded<string, 'ProcessInstanceId'>;

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID_RE.test(v);
