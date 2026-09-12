/** The five vocabularies of the catalogue (spec 11 §2). */

export enum TrackingMode {
  QUANTITY = 'QUANTITY',
  LOT = 'LOT',
  SERIAL = 'SERIAL',
}

export enum CodeKind {
  EAN = 'EAN',
  UPC = 'UPC',
  INTERNAL_QR = 'INTERNAL_QR',
  SUPPLIER_REF = 'SUPPLIER_REF',
  OTHER = 'OTHER',
}

export enum CustomEntity {
  PRODUCT = 'PRODUCT',
  NODE = 'NODE',
  BATCH = 'BATCH',
}

export enum CustomType {
  TEXT = 'TEXT',
  NUMBER = 'NUMBER',
  DATE = 'DATE',
  BOOLEAN = 'BOOLEAN',
  SELECT = 'SELECT',
}

export enum UnitOfMeasure {
  UNIT = 'UNIT',
  KG = 'KG',
  G = 'G',
  L = 'L',
  ML = 'ML',
  M = 'M',
  CM = 'CM',
  BOX = 'BOX',
  PACK = 'PACK',
}

export const TRACKING_MODES = Object.values(TrackingMode);
export const CODE_KINDS = Object.values(CodeKind);
export const CUSTOM_ENTITIES = Object.values(CustomEntity);
export const CUSTOM_TYPES = Object.values(CustomType);
export const UNITS_OF_MEASURE = Object.values(UnitOfMeasure);
