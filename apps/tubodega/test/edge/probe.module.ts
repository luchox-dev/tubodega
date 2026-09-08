// Test-only endpoints that expose what the pipeline did, so the edge can be
// asserted against the real application. Never registered in src/.
import { Controller, Get, HttpCode, Module, Post } from '@nestjs/common';
import { sql } from 'kysely';
import { TransactionContext } from '@app/persistence';
import { Public } from '../../src/http/pipeline/public.decorator.js';

@Controller('_probe')
export class ProbeController {
  constructor(private readonly ctx: TransactionContext) {}

  /** What Postgres thinks the current organization is, inside the request transaction. */
  @Get('org')
  async org() {
    const r = await sql<{ v: string | null }>`select current_setting('app.current_org', true) as v`.execute(this.ctx.current());
    return { org: r.rows[0]!.v ?? null };
  }

  @Public()
  @Get('org-public')
  async orgPublic() {
    return this.org();
  }

  /** A GET that tries to write: must fail with 25006 (READ ONLY). */
  @Get('write-on-get')
  async writeOnGet() {
    await sql`insert into outbox_event (id, org_id, type, payload, trace_id)
              values (gen_random_uuid(), current_setting('app.current_org')::uuid, 'probe', '{}', gen_random_uuid())`.execute(
      this.ctx.current(),
    );
    return { ok: true };
  }

  @Post('boom')
  boom() {
    throw new Error('unexpected failure with internals');
  }

  /**
   * A handler the test holds open, so two requests with the same
   * Idempotency-Key are genuinely in flight at the same time (I-7).
   */
  @Post('slow')
  async slow() {
    await ProbeGate.wait();
    return { ok: true, at: 'slow' };
  }

  @Post('echo')
  echo() {
    return { ok: true, at: 'echo' };
  }

  @Post('no-content')
  @HttpCode(204)
  noContent() {
    return undefined;
  }
}

/**
 * Lets a test decide when `POST /_probe/slow` finishes, and — the part that
 * matters — tells it when the handler has actually been entered. Waiting for
 * that is what makes the concurrency test deterministic: the handler runs
 * after the reservation, so once it is entered, the key is provably taken.
 */
export class ProbeGate {
  private static release: (() => void) | undefined;
  private static gate: Promise<void> | undefined;
  private static arrive: (() => void) | undefined;
  private static arrived: Promise<void> | undefined;

  static open(): void {
    ProbeGate.gate = new Promise<void>((resolve) => (ProbeGate.release = resolve));
    ProbeGate.arrived = new Promise<void>((resolve) => (ProbeGate.arrive = resolve));
  }
  /** Called by the handler: it is inside, and holding. */
  static async wait(): Promise<void> {
    ProbeGate.arrive?.();
    await (ProbeGate.gate ?? Promise.resolve());
  }
  /** Awaited by the test: resolves once a request reached the handler. */
  static entered(): Promise<void> {
    return ProbeGate.arrived ?? Promise.resolve();
  }
  static letGo(): void {
    ProbeGate.release?.();
    ProbeGate.gate = undefined;
    ProbeGate.release = undefined;
    ProbeGate.arrived = undefined;
    ProbeGate.arrive = undefined;
  }
}

@Module({ controllers: [ProbeController] })
export class ProbeModule {}
