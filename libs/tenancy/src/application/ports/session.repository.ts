import type { OrgId, UserId } from '@app/common';

/** A refresh session: the opaque token is stored only by SHA-256 hash (spec 10 §4). */
export interface Session {
  readonly id: string;
  readonly userId: UserId;
  readonly orgId: OrgId;
  readonly tokenHash: string;
  readonly expiresAt: Date;
  readonly revokedAt?: Date;
}

export interface SessionRepository {
  create(session: Omit<Session, 'revokedAt'>): Promise<void>;
  /** System context: the refresh flow has no organization yet. */
  findByHash(tokenHash: string): Promise<Session | null>;
  revoke(id: string, at: Date): Promise<void>;
}
export const SESSION_REPOSITORY = Symbol('SessionRepository');
