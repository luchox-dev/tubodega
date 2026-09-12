import { Injectable } from '@nestjs/common';
import type { OrgId, Page, UserId } from '@app/common';
import {
  EmailTakenError,
  User,
  type Email,
  type Role,
  type UserFilter,
  type UserPage,
  type UserRepository,
} from '@app/tenancy';
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

  /**
   * The role filter is the documented escape hatch of spec 08 §5: an EXISTS
   * over `user_role`, which the DSL mixes into its own AND. And the roles of a
   * whole page are fetched with one query, not one per user.
   */
  async listPage(orgId: OrgId, filter: UserFilter, page: UserPage): Promise<Page<User>> {
    const found = await this.users.findPage(orgId, {
      take: page.limit,
      cursor: page.cursor,
      orderBy: { [page.sort.field]: page.sort.dir },
      where: {
        ...(filter.active !== undefined ? { active: filter.active } : {}),
        ...(filter.role
          ? {
              AND: [
                (eb) =>
                  eb.exists(
                    eb
                      .selectFrom('userRole')
                      .select('userId')
                      .whereRef('userRole.userId', '=', 'appUser.id')
                      .where('userRole.orgId', '=', orgId)
                      .where('userRole.role', '=', filter.role!),
                  ),
              ],
            }
          : {}),
      },
    });

    const roles = await this.roles.listByUsers(orgId, found.data.map((r) => r.id));
    const byUser = new Map<string, UserRoleModel[]>();
    for (const r of roles) byUser.set(r.userId, [...(byUser.get(r.userId) ?? []), r]);
    return { ...found, data: found.data.map((row) => toUser(row, byUser.get(row.id) ?? [])) };
  }

  /**
   * Update first, insert if it was not there: the same shape as every other
   * repository of the house. Returns the version the row ended up with — only
   * the repository knows it, and whoever answers the client needs it (D-31).
   */
  async save(user: User, expectedVersion?: number): Promise<number> {
    const data = { email: user.email, name: user.name, passwordHash: user.passwordHash, active: user.active };
    let version: number;
    try {
      const row = await this.users.update(
        user.orgId,
        user.id,
        data,
        expectedVersion !== undefined ? { expectedVersion } : {},
      );
      version = row.version;
    } catch (e) {
      // `translate` never returns, but the compiler only knows that where the
      // value is used: returning it is what makes the narrowing its job and not
      // an assumption about the line below.
      if (!(e instanceof RecordNotFoundError)) return translate(user)(e);
      const row = await this.users.create({ id: user.id, orgId: user.orgId, ...data }).catch(translate(user));
      version = row.version;
    }
    // The roles live in `user_role`, a table without a version of its own, so
    // this write does not move the one we are about to return.
    await this.roles.replaceForUser(user.orgId, user.id, [...user.roles]);
    return version;
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
