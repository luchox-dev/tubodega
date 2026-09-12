import { Injectable } from '@nestjs/common';
import type { OrgId } from '@app/common';
import {
  CustomEntity,
  type CustomFieldDefinition, type CustomFieldDefinitionRepository,
  type CustomFieldId, type FieldKey,
} from '@app/catalog';
import { BatchDao } from '../../dao/batch.dao.js';
import { CustomFieldDefinitionDao } from '../../dao/custom-field-definition.dao.js';
import { NodeDao } from '../../dao/node.dao.js';
import { ProductDao } from '../../dao/product.dao.js';
import { RecordNotFoundError } from '../../dao/base/errors.js';
import { toCustomField } from './mapping.js';

@Injectable()
export class KyselyCustomFieldRepository implements CustomFieldDefinitionRepository {
  constructor(
    private readonly dao: CustomFieldDefinitionDao,
    private readonly products: ProductDao,
    private readonly nodes: NodeDao,
    private readonly batches: BatchDao,
  ) {}

  async findById(orgId: OrgId, id: CustomFieldId): Promise<CustomFieldDefinition | null> {
    const row = await this.dao.findUnique(orgId, id);
    return row ? toCustomField(row) : null;
  }

  async listByEntity(orgId: OrgId, entity: CustomEntity): Promise<CustomFieldDefinition[]> {
    const rows = await this.dao.findMany(orgId, {
      where: { entity },
      orderBy: { position: 'asc' },
    });
    return rows.map(toCustomField);
  }

  /** C-10 and D-10 over whichever table owns the entity. */
  countEntitiesMissing(orgId: OrgId, entity: CustomEntity, key: FieldKey): Promise<number> {
    return this.countIn(orgId, entity, key, false);
  }

  countEntitiesWith(orgId: OrgId, entity: CustomEntity, key: FieldKey): Promise<number> {
    return this.countIn(orgId, entity, key, true);
  }

  async save(def: CustomFieldDefinition, expectedVersion?: number): Promise<void> {
    const data = {
      entity: def.entity,
      key: def.key as string,
      label: def.label,
      type: def.type,
      options: def.options ? JSON.stringify(def.options) : null,
      required: def.required,
      position: def.position,
    };
    try {
      await this.dao.update(
        def.orgId,
        def.id,
        data,
        expectedVersion !== undefined ? { expectedVersion } : {},
      );
    } catch (e) {
      if (!(e instanceof RecordNotFoundError)) throw e;
      await this.dao.create({ id: def.id, orgId: def.orgId, ...data });
    }
  }

  private countIn(orgId: OrgId, entity: CustomEntity, key: FieldKey, present: boolean): Promise<number> {
    const dao =
      entity === CustomEntity.PRODUCT ? this.products : entity === CustomEntity.NODE ? this.nodes : this.batches;
    return dao.countByCustomKey(orgId, key, present);
  }
}
