import { Inject, Injectable } from '@nestjs/common';
import {
  CLOCK, EVENT_PUBLISHER, ID_GENERATOR,
  type Clock, type EventPublisher, type IdGenerator, type ProcessInstanceId,
} from '@app/common';
import { Action, requireAction, type RequestContext } from '@app/tenancy';
import { InstanceClosedError, ProcessInstanceNotFoundError } from '../../domain/errors.js';
import type { ProcessInstance } from '../../domain/instance.js';
import { processEvent } from '../events.js';
import { PROCESS_INSTANCE_REPOSITORY, type ProcessInstanceRepository } from '../ports/process-instance.repository.js';

/**
 * Abandoning a process, on purpose and on the record. **No effects** (P-6):
 * the whole point is that a receipt left half done dirties neither the
 * inventory nor the catalog — no new batch, no stock moved, no photo attached.
 */
@Injectable()
export class CancelProcess {
  constructor(
    @Inject(PROCESS_INSTANCE_REPOSITORY) private readonly instances: ProcessInstanceRepository,
    @Inject(EVENT_PUBLISHER) private readonly events: EventPublisher,
    @Inject(ID_GENERATOR) private readonly ids: IdGenerator,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(ctx: RequestContext, id: ProcessInstanceId): Promise<ProcessInstance> {
    requireAction(ctx, Action.RECORD_MOVEMENT);

    const instance = await this.instances.findById(ctx.orgId, id);
    // Of another organization: not there, and never a 403 (I-6).
    if (!instance) throw new ProcessInstanceNotFoundError();
    if (!instance.isOpen()) throw new InstanceClosedError(instance.state);

    const cancelled = instance.cancelled();
    await this.instances.save(cancelled, instance.version);
    await this.events.publish([
      processEvent(this.ids, 'process.cancelled', ctx.orgId, ctx.traceId, this.clock.now(), {
        instanceId: instance.id,
        templateCode: instance.templateCode as string,
        abandonedAt: instance.currentStepId ?? null,
      }),
    ]);

    return cancelled;
  }
}
