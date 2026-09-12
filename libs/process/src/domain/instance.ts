import type { OrgId, ProcessInstanceId, UserId } from '@app/common';
import { ProcessContext } from './context.js';
import type { StepId, TemplateCode } from './ids.js';

export enum ProcessState {
  OPEN = 'OPEN',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
}

export interface StartInstanceProps {
  readonly id: ProcessInstanceId;
  readonly orgId: OrgId;
  readonly templateCode: TemplateCode;
  readonly templateVersion: number;
  readonly firstStepId: StepId;
  readonly actorId: UserId;
}

export interface RehydrateInstanceProps {
  readonly id: ProcessInstanceId;
  readonly orgId: OrgId;
  readonly templateCode: TemplateCode;
  readonly templateVersion: number;
  readonly state: ProcessState;
  readonly currentStepId?: StepId;
  readonly context: ProcessContext;
  readonly actorId: UserId;
  readonly version: number;
}

/**
 * A process in flight. It records the **version** of the template it started
 * with, not just its code: a receipt from March is audited with March's rules,
 * however many times the template has changed since. Without that, editing a
 * template would retroactively rewrite the meaning of everything already run.
 *
 * `version` is internal optimistic locking and not contract: no endpoint asks
 * for `If-Match`, and none should — whoever advances a process is a client
 * following what the server tells it step by step, and the `409 wrong-step` of
 * P-2 already says it arrived late in words it can read (spec 13 §9).
 */
export class ProcessInstance {
  private constructor(
    readonly id: ProcessInstanceId,
    readonly orgId: OrgId,
    readonly templateCode: TemplateCode,
    readonly templateVersion: number,
    readonly state: ProcessState,
    readonly currentStepId: StepId | undefined,
    readonly context: ProcessContext,
    readonly actorId: UserId,
    readonly version: number,
  ) {}

  /**
   * Takes the id rather than minting one: the domain does not reach for an
   * `IdGenerator`, and `StartProcess` accepts an id from the client anyway
   * (spec 13 §7), which is what `process-instance-id-taken` exists for.
   */
  static start(p: StartInstanceProps): ProcessInstance {
    return new ProcessInstance(
      p.id, p.orgId, p.templateCode, p.templateVersion,
      ProcessState.OPEN, p.firstStepId, ProcessContext.empty(), p.actorId, 1,
    );
  }

  static rehydrate(p: RehydrateInstanceProps): ProcessInstance {
    return new ProcessInstance(
      p.id, p.orgId, p.templateCode, p.templateVersion,
      p.state, p.currentStepId, p.context, p.actorId, p.version,
    );
  }

  isOpen(): boolean {
    return this.state === ProcessState.OPEN;
  }

  /** P-2 and P-4 at once: the current step, and only while it is still open. */
  canComplete(stepId: StepId): boolean {
    return this.isOpen() && this.currentStepId === stepId;
  }

  /** Moved on, still open. */
  at(stepId: StepId, context: ProcessContext): ProcessInstance {
    return new ProcessInstance(
      this.id, this.orgId, this.templateCode, this.templateVersion,
      ProcessState.OPEN, stepId, context, this.actorId, this.version,
    );
  }

  completed(context: ProcessContext): ProcessInstance {
    return new ProcessInstance(
      this.id, this.orgId, this.templateCode, this.templateVersion,
      ProcessState.COMPLETED, undefined, context, this.actorId, this.version,
    );
  }

  /**
   * Keeps `currentStepId`: where somebody abandoned a process is part of what
   * happened, and P-6 already guarantees it left no trace in the inventory.
   */
  cancelled(): ProcessInstance {
    return new ProcessInstance(
      this.id, this.orgId, this.templateCode, this.templateVersion,
      ProcessState.CANCELLED, this.currentStepId, this.context, this.actorId, this.version,
    );
  }
}
