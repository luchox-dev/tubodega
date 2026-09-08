// Three aliases per table, derived from the generated DB type (spec 08 §2):
// Model = a row that exists, New = a row about to exist, Patch = a partial change.
// These never leave libs/persistence; repositories map them to domain entities.
import type { Insertable, Selectable, Updateable } from 'kysely';
import type { DB } from '../generated/db.js';

export type OrganizationModel = Selectable<DB['organization']>;
export type NewOrganization = Insertable<DB['organization']>;
export type OrganizationPatch = Updateable<DB['organization']>;

export type UserModel = Selectable<DB['appUser']>;
export type NewUser = Insertable<DB['appUser']>;
export type UserPatch = Updateable<DB['appUser']>;

export type UserRoleModel = Selectable<DB['userRole']>;
export type NewUserRole = Insertable<DB['userRole']>;

export type RefreshTokenModel = Selectable<DB['refreshToken']>;
export type NewRefreshToken = Insertable<DB['refreshToken']>;
export type RefreshTokenPatch = Updateable<DB['refreshToken']>;

export type OutboxEventModel = Selectable<DB['outboxEvent']>;
export type NewOutboxEvent = Insertable<DB['outboxEvent']>;

export type IdempotencyKeyModel = Selectable<DB['idempotencyKey']>;
export type NewIdempotencyKey = Insertable<DB['idempotencyKey']>;
export type IdempotencyKeyPatch = Updateable<DB['idempotencyKey']>;
