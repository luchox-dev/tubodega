import { v7 } from 'uuid';
import { unwrap, type OrgId } from '@app/common';
import { CustomEntity, CustomFieldDefinition, CustomType, type CustomFieldId } from '@app/catalog';

export const ORG = '018f0000-0000-7000-8000-000000000001' as OrgId;

export function aCustomField(over: Partial<Parameters<typeof CustomFieldDefinition.create>[0]> = {}) {
  return unwrap(
    CustomFieldDefinition.create({
      id: v7() as CustomFieldId,
      orgId: ORG,
      entity: CustomEntity.PRODUCT,
      key: 'proveedor',
      label: 'Proveedor',
      type: CustomType.TEXT,
      ...over,
    }),
  );
}
