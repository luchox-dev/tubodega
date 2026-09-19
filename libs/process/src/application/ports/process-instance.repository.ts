import type { Cursor, OrgId, Page, ProcessInstanceId, UserId } from '@app/common';
import type { TemplateCode } from '../../domain/ids.js';
import type { ProcessInstance, ProcessState } from '../../domain/instance.js';

/** What `GET /v1/process-instances` may filter by; anything else is 400 (spec 03 §8). */
export interface ProcessInstanceFilter {
  readonly state?: ProcessState;
  readonly templateCode?: TemplateCode;
  readonly actorId?: UserId;
}

/**
 * `createdAt` and nothing else, newest first (decision D-62). It is the one
 * column this plan indexes, and the same reasoning as the movement history
 * (D-37): offering a sort with no index behind it invites a seq scan over a
 * table that grows with every guided operation.
 */
export interface ProcessInstancePage {
  readonly limit: number;
  readonly cursor?: Cursor;
  readonly sort: { readonly field: 'createdAt'; readonly dir: 'asc' | 'desc' };
}

export interface ProcessInstanceRepository {
  findById(orgId: OrgId, id: ProcessInstanceId): Promise<ProcessInstance | null>;
  list(orgId: OrgId, filter: ProcessInstanceFilter, page: ProcessInstancePage): Promise<Page<ProcessInstance>>;
  /**
   * Insert or update by id with optimistic locking. Raises
   * `ProcessInstanceIdTakenError` on a primary key clash — `StartProcess`
   * accepts an id from the client (spec 13 §7).
   *
   * Returns the version the row ended up with, like every other `save` of the
   * house (decision D-31). Nothing puts it in a response body: spec 13 §9 says
   * `process_instance.version` is internal optimistic locking and **not**
   * contract, and no endpoint asks for `If-Match`. It is returned so the caller
   * that writes twice in one request does not hand back a stale number.
   */
  save(instance: ProcessInstance, expectedVersion?: number): Promise<number>;
}

export const PROCESS_INSTANCE_REPOSITORY = Symbol('ProcessInstanceRepository');
