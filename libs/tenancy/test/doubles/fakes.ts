import type { Clock, DomainEvent, EventPublisher, IdGenerator, UnitOfWork } from '@app/common';
import type { OrgId } from '@app/common';
import type { PasswordHasher } from '../../src/application/ports/password-hasher.js';
import type { OrgProvisioner } from '../../src/application/ports/org-provisioner.js';
import type { RandomToken, TokenIssuer, TokenVerification } from '../../src/application/ports/token-issuer.js';
import type { User } from '../../src/domain/user.js';

/** Real behaviour, no mocks with call expectations (spec 06 §4). */
export class FixedClock implements Clock {
  constructor(private at: Date) {}
  now() {
    return new Date(this.at);
  }
  advance(ms: number) {
    this.at = new Date(this.at.getTime() + ms);
  }
}

export class SequentialIdGenerator implements IdGenerator {
  private n = 0;
  next() {
    this.n += 1;
    return `00000000-0000-7000-8000-${String(this.n).padStart(12, '0')}`;
  }
}

export class FakePasswordHasher implements PasswordHasher {
  async hash(plain: string) {
    return `hashed:${plain}`;
  }
  async verify(plain: string, hash: string) {
    return hash === `hashed:${plain}`;
  }
}

/** Tokens are readable so tests can assert who they were issued for. */
export class FakeTokenIssuer implements TokenIssuer {
  async issueAccess(user: User) {
    return `access:${user.id}:${user.orgId}`;
  }
  async verify(token: string): Promise<TokenVerification> {
    const [kind, sub, org] = token.split(':');
    if (kind !== 'access' || !sub || !org) return { ok: false, reason: 'invalid' };
    return { ok: true, claims: { sub: sub as never, org: org as never, roles: [], exp: 0 } };
  }
}

export class SequentialRandomToken implements RandomToken {
  private n = 0;
  next() {
    this.n += 1;
    return `refresh-${this.n}`;
  }
}

export class InMemoryEventPublisher implements EventPublisher {
  readonly published: DomainEvent[] = [];
  /** Interleaved log of provisioner and publisher calls, to assert ordering. */
  readonly log: string[] = [];
  async publish(events: readonly DomainEvent[]) {
    this.published.push(...events);
    this.log.push(...events.map((e) => `event:${e.type}`));
  }
}

export class RecordingOrgProvisioner implements OrgProvisioner {
  readonly calls: OrgId[] = [];
  constructor(private readonly log: string[] = []) {}
  async provision(orgId: OrgId) {
    this.calls.push(orgId);
    this.log.push(`provision:${orgId}`);
  }
}

export const noopUnitOfWork: UnitOfWork = { run: (fn) => fn() };
