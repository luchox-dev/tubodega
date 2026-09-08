import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CLOCK, NodeEnv, type Clock, type EnvironmentVariables } from '@app/common';
import { KyselyUnitOfWork, OutboxEventDao } from '@app/persistence';

/** One statement claims at most this many events; the rest wait for the next tick. */
const BATCH = 100;

/**
 * The consumer side of the outbox (spec 05 §3). It runs in system context: the
 * tenant role would see no event of any organization, because none of them is
 * the current one.
 *
 * In the MVP "publishing" is writing to the log and marking the row. That is
 * deliberately little: what matters is that the **producer** is already in its
 * final place, so adding webhooks later is a new consumer and not one line of
 * change in any use case.
 *
 * Guarantee: at least once. If the process dies between publishing and
 * marking, the event is sent again — which is why consumers must be idempotent
 * and why the event carries an id.
 */
@Injectable()
export class OutboxDispatcherJob implements OnModuleInit {
  private readonly logger = new Logger('outbox');

  constructor(
    private readonly uow: KyselyUnitOfWork,
    private readonly events: OutboxEventDao,
    private readonly scheduler: SchedulerRegistry,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly config: ConfigService<EnvironmentVariables, true>,
  ) {}

  /**
   * The rule for every job from here on: under NODE_ENV=test they are wired up
   * but their interval never starts, and tests drive them with `tick()`. A job
   * firing on its own in the background is the kind of thing that makes a
   * suite fail once every fifty runs.
   */
  onModuleInit(): void {
    if (this.config.get('NODE_ENV', { infer: true }) === NodeEnv.Test) return;
    const every = this.config.get('OUTBOX_INTERVAL_MS', { infer: true });
    const handle = setInterval(() => {
      void this.tick().catch((e: unknown) => this.logger.error({ err: e }));
    }, every);
    this.scheduler.addInterval('outbox-dispatcher', handle);
  }

  /** Returns the ids published in this pass, which is what makes it testable. */
  async tick(): Promise<string[]> {
    return this.uow.runAs({ pool: 'system' }, async () => {
      const pending = await this.events.claimPending(BATCH);
      if (pending.length === 0) return [];
      for (const event of pending) {
        this.logger.log(`${event.type} org=${event.orgId} trace=${event.traceId} id=${event.id}`);
      }
      const ids = pending.map((e) => e.id);
      await this.events.markPublished(ids, this.clock.now());
      return ids;
    });
  }
}
