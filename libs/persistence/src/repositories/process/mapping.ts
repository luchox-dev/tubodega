// Row ↔ entity in both directions. The DAO knows nothing about ProcessTemplate
// (spec 08 §7).
import { unwrap, type OrgId, type ProcessInstanceId, type UserId } from '@app/common';
import { Quantity } from '@app/inventory';
import {
  ProcessContext, ProcessInstance, ProcessState, ProcessTemplate, TemplateCode,
  type MovementDraft, type ProcessTemplateId, type StepCompletion, type StepCompletionId,
  type StepId, type StepPayload,
} from '@app/process';
import type {
  ProcessInstanceModel, ProcessTemplateModel, StepCompletionModel,
} from '../../models/index.js';

/**
 * Through `create` and not a `rehydrate` twin, because `ProcessTemplate` has
 * none: `steps` is JSONB whose shape is going to change (spec 13 §9), the
 * validator is pure and cheap, and reading is the last chance to notice that
 * what got seeded cannot be run. A row that fails it is a bug of this
 * repository, never something an organization can cause, so it throws.
 */
export const toProcessTemplate = (row: ProcessTemplateModel): ProcessTemplate =>
  unwrap(
    ProcessTemplate.create({
      id: row.id as ProcessTemplateId,
      orgId: row.orgId as OrgId,
      code: row.code,
      version: row.version,
      steps: row.steps,
      active: row.active,
    }),
  );

export const processTemplateValues = (t: ProcessTemplate) => ({
  code: t.code as string,
  version: t.version,
  // jsonb goes in as a string, like every other jsonb column of the house.
  steps: JSON.stringify(t.steps),
  active: t.active,
});

// ─────────────────────────────────────────────────────────────────────────────
// The context, and the one thing about it that is not obvious (decision D-64).
//
// `ProcessContext` does not survive a naive `JSON.stringify`: `values` is a
// `Map`, `draft.quantity` is a `Quantity`, and there are `Date`s buried inside
// the payloads (`expiresAt`, `dueAt`) and inside `newBatch`. Losing any of the
// three is silent on the way in and shows up on the way **out**, half an
// instance later, as a handler comparing a string to a Date.
//
// So the two non-JSON types travel tagged — `{ $date }` and `{ $qty }` — and
// the codec is recursive and type-driven rather than a list of known field
// names. A registry of names would be right today and quietly wrong the first
// time a handler gains a field, which is a bug nothing in this file would
// catch. The round trip is asserted in `instance.repository.int-spec.ts`.
// ─────────────────────────────────────────────────────────────────────────────

const encode = (value: unknown): unknown => {
  if (value instanceof Date) return { $date: value.toISOString() };
  if (value instanceof Quantity) return { $qty: value.toString() };
  if (Array.isArray(value)) return value.map(encode);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, encode(v)]));
  }
  return value;
};

const decode = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(decode);
  if (value === null || typeof value !== 'object') return value;

  const o = value as Record<string, unknown>;
  const keys = Object.keys(o);
  // A single tagged key and nothing else: anything richer is a real object that
  // happens to carry a field of that name, and gets walked like any other.
  if (keys.length === 1 && typeof o.$date === 'string') return new Date(o.$date);
  if (keys.length === 1 && typeof o.$qty === 'string') return Quantity.rehydrate(o.$qty);
  return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, decode(v)]));
};

const contextJson = (context: ProcessContext) =>
  JSON.stringify({
    values: Object.fromEntries([...context.values].map(([k, v]) => [k, encode(v)])),
    draft: encode(context.draft),
    storageKeys: [...context.storageKeys],
  });

const toContext = (raw: unknown): ProcessContext => {
  const o = (raw ?? {}) as { values?: Record<string, unknown>; draft?: unknown; storageKeys?: unknown };
  return ProcessContext.rehydrate({
    values: new Map(
      Object.entries(o.values ?? {}).map(([k, v]) => [k as StepId, decode(v) as StepPayload | null]),
    ),
    draft: (decode(o.draft ?? {}) ?? {}) as MovementDraft,
    storageKeys: (o.storageKeys ?? []) as readonly never[],
  });
};

/**
 * Straight to `rehydrate` and not through a validator: unlike a template, an
 * instance is this repository's own writing, and the version in the row is the
 * one the entity has to carry — the optimistic lock measures exactly that.
 */
export const toProcessInstance = (row: ProcessInstanceModel): ProcessInstance =>
  ProcessInstance.rehydrate({
    id: row.id as ProcessInstanceId,
    orgId: row.orgId as OrgId,
    templateCode: unwrap(TemplateCode.of(row.templateCode)),
    templateVersion: row.templateVersion,
    state: row.state as ProcessState,
    ...(row.currentStepId !== null ? { currentStepId: row.currentStepId as StepId } : {}),
    context: toContext(row.context),
    actorId: row.actorId as UserId,
    version: row.version,
  });

export const processInstanceValues = (i: ProcessInstance) => ({
  templateCode: i.templateCode as string,
  templateVersion: i.templateVersion,
  state: i.state,
  currentStepId: i.currentStepId ?? null,
  context: contextJson(i.context),
  actorId: i.actorId as string,
});

export const toStepCompletion = (row: StepCompletionModel): StepCompletion => ({
  id: row.id as StepCompletionId,
  orgId: row.orgId as OrgId,
  instanceId: row.instanceId as ProcessInstanceId,
  stepId: row.stepId as StepId,
  actorId: row.actorId as UserId,
  payload: decode(row.payload) as StepPayload | null,
  completedAt: row.completedAt,
});

export const stepCompletionValues = (c: StepCompletion) => ({
  id: c.id as string,
  orgId: c.orgId as string,
  instanceId: c.instanceId as string,
  stepId: c.stepId as string,
  actorId: c.actorId as string,
  // An omitted step stores the JSON literal `null`, not a SQL NULL: the column
  // is `jsonb NOT NULL`, and the difference between "this step was skipped" and
  // "this step does not exist" is precisely the row (spec 13 §9).
  payload: JSON.stringify(encode(c.payload) ?? null),
  completedAt: c.completedAt,
});
