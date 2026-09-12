import type { OrgId } from '@app/common';
import type { CustomFieldDefinition } from '../../domain/custom-field.js';
import type { CustomEntity } from '../../domain/enums.js';
import type { CustomFieldId, FieldKey } from '../../domain/ids.js';

export interface CustomFieldDefinitionRepository {
  findById(orgId: OrgId, id: CustomFieldId): Promise<CustomFieldDefinition | null>;
  /** Ordered by position: the form renders in the order the organization chose. */
  listByEntity(orgId: OrgId, entity: CustomEntity): Promise<CustomFieldDefinition[]>;
  /** C-10: how many products, nodes or batches have no value for the key yet. */
  countEntitiesMissing(orgId: OrgId, entity: CustomEntity, key: FieldKey): Promise<number>;
  /** D-10: how many already hold one, which is what locks the type. */
  countEntitiesWith(orgId: OrgId, entity: CustomEntity, key: FieldKey): Promise<number>;
  save(def: CustomFieldDefinition, expectedVersion?: number): Promise<void>;
}

export const CUSTOM_FIELD_REPOSITORY = Symbol('CustomFieldDefinitionRepository');
