import { err, ok, type Branded, type Result } from '@app/common';
import { InvalidCodeValueError, InvalidFieldKeyError, InvalidSkuError, InvalidUomError } from './errors.js';
import { UnitOfMeasure } from './enums.js';

export type ProductId = Branded<string, 'ProductId'>;
export type BatchId = Branded<string, 'BatchId'>;
export type ProductCodeId = Branded<string, 'ProductCodeId'>;
export type CustomFieldId = Branded<string, 'CustomFieldId'>;
export type MediaId = Branded<string, 'MediaId'>;
/** Where MediaStorage put the bytes. Opaque to everything above infrastructure. */
export type StorageKey = Branded<string, 'StorageKey'>;

/** 1-64 characters, no whitespace. Upper-cased: a SKU read off a label and one
 *  typed into a spreadsheet are the same SKU (spec 11 §2). */
export type Sku = Branded<string, 'Sku'>;
/** snake_case, 1-64. */
export type FieldKey = Branded<string, 'FieldKey'>;

const SKU_RE = /^\S{1,64}$/;
const FIELD_KEY_RE = /^[a-z][a-z0-9_]{0,63}$/;

export const Sku = {
  of(raw: string): Result<Sku, InvalidSkuError> {
    const value = raw.trim().toUpperCase();
    return SKU_RE.test(value) ? ok(value as Sku) : err(new InvalidSkuError(raw));
  },
};

export const FieldKey = {
  of(raw: string): Result<FieldKey, InvalidFieldKeyError> {
    const value = raw.trim();
    return FIELD_KEY_RE.test(value) ? ok(value as FieldKey) : err(new InvalidFieldKeyError(raw));
  },
};

/** A scanned code arrives with whatever whitespace the reader added. */
export const CodeValue = {
  of(raw: string): Result<string, InvalidCodeValueError> {
    const value = raw.trim();
    return value.length >= 1 && value.length <= 128 ? ok(value) : err(new InvalidCodeValueError(raw));
  },
};

export const Uom = {
  of(raw: string): Result<UnitOfMeasure, InvalidUomError> {
    const value = raw.trim().toUpperCase();
    return (Object.values(UnitOfMeasure) as string[]).includes(value)
      ? ok(value as UnitOfMeasure)
      : err(new InvalidUomError(raw));
  },
};
