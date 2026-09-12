import type { StorageKey } from '@app/catalog';
import type { NodeId } from '@app/inventory';

/** The eight step types of the MVP (spec 13 §2). Adding a ninth is a class. */
export enum StepType {
  SCAN_ITEM = 'SCAN_ITEM',
  CAPTURE_BATCH = 'CAPTURE_BATCH',
  CAPTURE_QTY = 'CAPTURE_QTY',
  CAPTURE_PHOTO = 'CAPTURE_PHOTO',
  SELECT_NODE = 'SELECT_NODE',
  SET_DUE_DATE = 'SET_DUE_DATE',
  CAPTURE_REASON = 'CAPTURE_REASON',
  CONFIRM = 'CONFIRM',
}

export const STEP_TYPES = Object.values(StepType);

export const isStepType = (v: unknown): v is StepType => STEP_TYPES.includes(v as StepType);

// ── The payloads, one per type (spec 13 §2)

export interface ScanItemPayload {
  readonly code: string;
}
export interface CaptureBatchPayload {
  readonly lotCode?: string;
  readonly serial?: string;
  readonly expiresAt?: Date;
}
export interface CaptureQtyPayload {
  readonly quantity: string;
}
export interface CapturePhotoPayload {
  readonly storageKeys: readonly StorageKey[];
}
export interface SelectNodePayload {
  readonly nodeId: NodeId;
}
export interface SetDueDatePayload {
  readonly dueAt: Date;
}
export interface CaptureReasonPayload {
  readonly reason: string;
}
/** `CONFIRM` takes nothing: everything it needs is already in the context. */
export type ConfirmPayload = Record<string, never>;

/** What a handler accepts. Each type refines this union — see spec 13 §5. */
export type StepPayload =
  | ScanItemPayload
  | CaptureBatchPayload
  | CaptureQtyPayload
  | CapturePhotoPayload
  | SelectNodePayload
  | SetDueDatePayload
  | CaptureReasonPayload
  | ConfirmPayload;

/**
 * A step's configuration inside a template, interpreted by its handler and by
 * nobody else. It is what makes `SELECT_NODE` one handler and not two, and what
 * lets six templates be built out of eight pieces (spec 13 §5).
 */
export type StepConfig = Record<string, unknown>;

/** `config.role` of `SELECT_NODE`: which side of the draft the node lands on. */
export enum NodeRole {
  FROM = 'FROM',
  TO = 'TO',
}
