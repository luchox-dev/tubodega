import { err, ok, type OrgId, type Result, type UserId } from '@app/common';
import { Email } from './ids.js';
import { InvalidEmailError, LastOwnerError } from './errors.js';
import { Action, Role, canAny } from './role.js';

export class User {
  private constructor(
    readonly id: UserId,
    readonly orgId: OrgId,
    readonly email: Email,
    readonly name: string,
    readonly passwordHash: string,
    readonly roles: ReadonlySet<Role>,
    readonly active: boolean,
    readonly version: number,
  ) {}

  static create(input: {
    id: UserId;
    orgId: OrgId;
    email: string;
    name: string;
    passwordHash: string;
    roles: readonly Role[];
  }): Result<User, InvalidEmailError> {
    const email = Email.of(input.email);
    if (!email.ok) return email;
    return ok(new User(input.id, input.orgId, email.value, input.name.trim(), input.passwordHash, new Set(input.roles), true, 1));
  }

  static rehydrate(p: {
    id: UserId;
    orgId: OrgId;
    email: Email;
    name: string;
    passwordHash: string;
    roles: readonly Role[];
    active: boolean;
    version: number;
  }): User {
    return new User(p.id, p.orgId, p.email, p.name, p.passwordHash, new Set(p.roles), p.active, p.version);
  }

  can(action: Action): boolean {
    return canAny(this.roles, action);
  }

  isOwner(): boolean {
    return this.roles.has(Role.OWNER);
  }

  /**
   * T-2: an organization always keeps at least one active OWNER. The rule
   * lives here; the count of active owners comes from the repository.
   */
  withRoles(roles: readonly Role[], activeOwnersInOrg: number): Result<User, LastOwnerError> {
    const next = new Set(roles);
    if (this.active && this.isOwner() && !next.has(Role.OWNER) && activeOwnersInOrg <= 1) {
      return err(new LastOwnerError());
    }
    return ok(new User(this.id, this.orgId, this.email, this.name, this.passwordHash, next, this.active, this.version));
  }

  deactivate(activeOwnersInOrg: number): Result<User, LastOwnerError> {
    if (this.active && this.isOwner() && activeOwnersInOrg <= 1) return err(new LastOwnerError());
    return ok(new User(this.id, this.orgId, this.email, this.name, this.passwordHash, this.roles, false, this.version));
  }

  withPasswordHash(passwordHash: string): User {
    return new User(this.id, this.orgId, this.email, this.name, passwordHash, this.roles, this.active, this.version);
  }
}
