import { Injectable } from '@nestjs/common';
import type { OrgId, UserId } from '@app/common';
import { EmailTakenError, User, type Email, type Role, type UserRepository } from '@app/tenancy';
import { UserDao } from '../dao/user.dao.js';
import { UserRoleDao } from '../dao/user-role.dao.js';
import { RecordNotFoundError, UniqueViolationError } from '../dao/base/errors.js';
import type { UserModel, UserRoleModel } from '../models/index.js';

const toUser = (row: UserModel, roles: readonly UserRoleModel[]): User =>
  User.rehydrate({
    id: row.id as UserId,
    orgId: row.orgId as OrgId,
    email: row.email as Email,
    name: row.name,
    passwordHash: row.passwordHash,
    roles: roles.map((r) => r.role as Role),
    active: row.active,
    version: row.version,
  });

/** Row ↔ entity mapping in both directions; the DAO knows nothing about `User` (spec 08 §7). */
@Injectable()
export class KyselyUserRepository implements UserRepository {
  constructor(
    private readonly users: UserDao,
    private readonly roles: UserRoleDao,
  ) {}

  async findById(orgId: OrgId, id: UserId): Promise<User | null> {
    const row = await this.users.findUnique(orgId, id);
    return row ? this.hydrate(row) : null;
  }

  async findByEmail(orgId: OrgId, email: Email): Promise<User | null> {
    const row = await this.users.findFirst(orgId, { where: { email } });
    return row ? this.hydrate(row) : null;
  }

  async findByEmailGlobal(email: Email): Promise<User[]> {
    const rows = await this.users.findByEmailGlobal(email);
    return Promise.all(rows.map((row) => this.hydrate(row)));
  }

  countActiveOwners(orgId: OrgId): Promise<number> {
    return this.roles.countActiveOwners(orgId);
  }

  async save(user: User): Promise<void> {
    const data = { email: user.email, name: user.name, passwordHash: user.passwordHash, active: user.active };
    try {
      await this.users.update(user.orgId, user.id, data, { expectedVersion: user.version });
    } catch (e) {
      if (!(e instanceof RecordNotFoundError)) translate(user)(e);
      await this.users.create({ id: user.id, orgId: user.orgId, ...data }).catch(translate(user));
    }
    await this.roles.replaceForUser(user.orgId, user.id, [...user.roles]);
  }

  private async hydrate(row: UserModel): Promise<User> {
    return toUser(row, await this.roles.listByUser(row.orgId as OrgId, row.id));
  }
}

const translate = (user: User) => (e: unknown): never => {
  if (e instanceof UniqueViolationError && e.constraint === 'app_user_org_id_email_key') {
    throw new EmailTakenError(user.email);
  }
  throw e;
};
