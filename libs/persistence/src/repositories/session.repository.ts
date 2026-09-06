import { Injectable } from '@nestjs/common';
import type { OrgId, UserId } from '@app/common';
import type { Session, SessionRepository } from '@app/tenancy';
import { RefreshTokenDao } from '../dao/refresh-token.dao.js';
import type { RefreshTokenModel } from '../models/index.js';

const toSession = (row: RefreshTokenModel): Session => ({
  id: row.id,
  userId: row.userId as UserId,
  orgId: row.orgId as OrgId,
  tokenHash: row.tokenHash,
  expiresAt: row.expiresAt,
  revokedAt: row.revokedAt ?? undefined,
});

@Injectable()
export class KyselySessionRepository implements SessionRepository {
  constructor(private readonly dao: RefreshTokenDao) {}

  async create(session: Omit<Session, 'revokedAt'>): Promise<void> {
    await this.dao.create({
      id: session.id,
      orgId: session.orgId,
      userId: session.userId,
      tokenHash: session.tokenHash,
      expiresAt: session.expiresAt,
    });
  }

  async findByHash(tokenHash: string): Promise<Session | null> {
    const row = await this.dao.findByHashGlobal(tokenHash);
    return row ? toSession(row) : null;
  }

  async revoke(id: string, at: Date): Promise<void> {
    await this.dao.revoke(id, at);
  }
}
