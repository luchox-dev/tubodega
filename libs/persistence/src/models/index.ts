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

export type ProductModel = Selectable<DB['product']>;
export type NewProduct = Insertable<DB['product']>;
export type ProductPatch = Updateable<DB['product']>;

export type ProductCodeModel = Selectable<DB['productCode']>;
export type NewProductCode = Insertable<DB['productCode']>;

export type ProductMediaModel = Selectable<DB['productMedia']>;
export type NewProductMedia = Insertable<DB['productMedia']>;

export type MediaUploadModel = Selectable<DB['mediaUpload']>;
export type NewMediaUpload = Insertable<DB['mediaUpload']>;
export type MediaUploadPatch = Updateable<DB['mediaUpload']>;

export type BatchModel = Selectable<DB['batch']>;
export type NewBatch = Insertable<DB['batch']>;

export type CustomFieldDefinitionModel = Selectable<DB['customFieldDefinition']>;
export type NewCustomFieldDefinition = Insertable<DB['customFieldDefinition']>;
export type CustomFieldDefinitionPatch = Updateable<DB['customFieldDefinition']>;

export type NodeModel = Selectable<DB['node']>;
export type NewNode = Insertable<DB['node']>;
export type NodePatch = Updateable<DB['node']>;

export type MovementModel = Selectable<DB['movement']>;
export type NewMovement = Insertable<DB['movement']>;

export type StockBalanceModel = Selectable<DB['stockBalance']>;
export type NewStockBalance = Insertable<DB['stockBalance']>;

export type ProcessTemplateModel = Selectable<DB['processTemplate']>;
export type NewProcessTemplate = Insertable<DB['processTemplate']>;
export type ProcessTemplatePatch = Updateable<DB['processTemplate']>;
