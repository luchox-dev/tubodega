import type { Session, SessionRepository } from '../../src/application/ports/session.repository.js';

export class InMemorySessionRepository implements SessionRepository {
  readonly rows = new Map<string, Session>();

  async create(session: Omit<Session, 'revokedAt'>) {
    this.rows.set(session.id, session);
  }
  async findByHash(tokenHash: string) {
    return [...this.rows.values()].find((s) => s.tokenHash === tokenHash) ?? null;
  }
  async revoke(id: string, at: Date) {
    const s = this.rows.get(id);
    if (s) this.rows.set(id, { ...s, revokedAt: at });
  }
}
