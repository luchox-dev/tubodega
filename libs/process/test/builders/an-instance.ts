import { v7 } from 'uuid';
import type { OrgId, ProcessInstanceId, UserId } from '@app/common';
import {
  ProcessContext, ProcessInstance, ProcessState,
  type StepId, type TemplateCode,
} from '@app/process';
import { ORG } from './a-template.js';

export const JUAN = '018f0000-0000-7000-8000-0000000000a1' as UserId;

type Over = Partial<{
  id: ProcessInstanceId;
  orgId: OrgId;
  templateCode: string;
  templateVersion: number;
  state: ProcessState;
  currentStepId: string | undefined;
  context: ProcessContext;
  actorId: UserId;
  version: number;
}>;

/** Una instancia ya guardada, en el paso que diga la prueba. */
export function anInstance(over: Over = {}): ProcessInstance {
  return ProcessInstance.rehydrate({
    id: over.id ?? (v7() as ProcessInstanceId),
    orgId: over.orgId ?? ORG,
    templateCode: (over.templateCode ?? 'PRUEBA') as TemplateCode,
    templateVersion: over.templateVersion ?? 1,
    state: over.state ?? ProcessState.OPEN,
    ...('currentStepId' in over
      ? over.currentStepId !== undefined
        ? { currentStepId: over.currentStepId as StepId }
        : {}
      : { currentStepId: 'item' as StepId }),
    context: over.context ?? ProcessContext.empty(),
    actorId: over.actorId ?? JUAN,
    version: over.version ?? 1,
  });
}
