// Row ↔ entity in both directions. The DAOs know nothing about Product,
// Batch or CustomFieldDefinition (spec 08 §7).
import type { OrgId } from '@app/common';
import {
  Batch, CodeKind, CustomEntity, CustomFieldDefinition, CustomFieldValues, CustomType,
  Product, ProductCode, TrackingMode, UnitOfMeasure,
  type BatchId, type CustomFieldId, type FieldKey, type ProductCodeId, type ProductId, type Sku,
} from '@app/catalog';
import type {
  BatchModel, CustomFieldDefinitionModel, ProductCodeModel, ProductModel,
} from '../../models/index.js';

const asRecord = (v: unknown): Record<string, unknown> =>
  v !== null && typeof v === 'object' ? (v as Record<string, unknown>) : {};

export const toProduct = (row: ProductModel): Product =>
  Product.rehydrate({
    id: row.id as ProductId,
    orgId: row.orgId as OrgId,
    sku: row.sku as Sku,
    name: row.name,
    ...(row.description !== null ? { description: row.description } : {}),
    trackingMode: row.trackingMode as TrackingMode,
    uom: row.uom as UnitOfMeasure,
    active: row.active,
    customFields: CustomFieldValues.rehydrate(asRecord(row.customFields)),
    version: row.version,
  });

export const productValues = (p: Product) => ({
  sku: p.sku as string,
  name: p.name,
  description: p.description ?? null,
  trackingMode: p.trackingMode,
  uom: p.uom as string,
  active: p.active,
  customFields: JSON.stringify(p.customFields.toJSON()),
});

export const toProductCode = (row: ProductCodeModel): ProductCode =>
  ProductCode.rehydrate({
    id: row.id as ProductCodeId,
    orgId: row.orgId as OrgId,
    productId: row.productId as ProductId,
    value: row.value,
    kind: row.kind as CodeKind,
  });

export const toBatch = (row: BatchModel): Batch =>
  Batch.rehydrate({
    id: row.id as BatchId,
    orgId: row.orgId as OrgId,
    productId: row.productId as ProductId,
    ...(row.lotCode !== null ? { lotCode: row.lotCode } : {}),
    ...(row.serial !== null ? { serial: row.serial } : {}),
    ...(row.expiresAt !== null ? { expiresAt: new Date(row.expiresAt as string | Date) } : {}),
    customFields: CustomFieldValues.rehydrate(asRecord(row.customFields)),
  });

export const toCustomField = (row: CustomFieldDefinitionModel): CustomFieldDefinition =>
  CustomFieldDefinition.rehydrate({
    id: row.id as CustomFieldId,
    orgId: row.orgId as OrgId,
    entity: row.entity as CustomEntity,
    key: row.key as FieldKey,
    label: row.label,
    type: row.type as CustomType,
    ...(Array.isArray(row.options) ? { options: row.options as string[] } : {}),
    required: row.required,
    position: row.position,
    version: row.version,
  });
