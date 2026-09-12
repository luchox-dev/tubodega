import type { BatchId, ProductId, StorageKey } from '@app/catalog';
import type { NodeId, Quantity } from '@app/inventory';
import type { BatchDraft } from './drafts.js';

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
//
// Several carry fields the client never sends, marked "resolved". `validate`
// is the only asynchronous half of a handler, so it is the only one that can
// ask the world; `apply` is synchronous by design — it must not touch the
// database — and `validate` returns the payload, which is therefore where what
// it resolved has to travel. It also ends up in the `step_completion`, where
// what the engine understood is worth keeping.

export interface ScanItemPayload {
  readonly code: string;
  /** Resolved. */
  readonly productId?: ProductId;
  /** Resolved, if the code was a serial that already exists. */
  readonly batchId?: BatchId;
}
export interface CaptureBatchPayload {
  readonly lotCode?: string;
  readonly serial?: string;
  readonly expiresAt?: Date;
  /** Resolved: the batch exists. */
  readonly batchId?: BatchId;
  /** Resolved: it does not, and `CONFIRM` will create it. */
  readonly newBatch?: BatchDraft;
}
export interface CaptureQtyPayload {
  readonly quantity: string;
  /** Parsed. */
  readonly value?: Quantity;
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
/**
 * `CONFIRM` takes nothing from the client — `{}` is what arrives. What comes
 * out of `validate` carries the sides its `config.defaults` resolved.
 */
export interface ConfirmPayload {
  readonly fromNodeId?: NodeId;
  readonly toNodeId?: NodeId;
}

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
