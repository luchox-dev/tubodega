import { v7 } from 'uuid';
import type { OrgId } from '@app/common';
import type { ProcessTemplateId } from '@app/process';

export const ORG = '018f0000-0000-7000-8000-000000000001' as OrgId;

/** A step as it travels in JSON — untyped on purpose, so a test can break it. */
export interface RawStep {
  id?: unknown;
  type?: unknown;
  required?: unknown;
  config?: unknown;
  transitions?: unknown;
}

type Over = Partial<{ orgId: OrgId; code: string; version: number; steps: unknown; active: boolean }>;

/** The shortest template that runs: scan something, confirm it. */
export const STEPS_MINIMOS: RawStep[] = [
  { id: 'item', type: 'SCAN_ITEM', required: true, transitions: [{ to: 'confirmar' }] },
  { id: 'confirmar', type: 'CONFIRM', required: true, transitions: [{ to: null }] },
];

export function templateProps(over: Over = {}) {
  return {
    id: v7() as ProcessTemplateId,
    orgId: over.orgId ?? ORG,
    code: over.code ?? 'PRUEBA',
    version: over.version ?? 1,
    steps: 'steps' in over ? over.steps : STEPS_MINIMOS,
    ...(over.active !== undefined ? { active: over.active } : {}),
  };
}

/** The same template with one step replaced, for the validator's error cases. */
export function conPaso(id: string, patch: RawStep): RawStep[] {
  return STEPS_MINIMOS.map((s) => (s.id === id ? { ...s, ...patch } : s));
}
