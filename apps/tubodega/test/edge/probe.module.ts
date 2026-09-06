// Test-only endpoints that expose what the pipeline did, so the edge can be
// asserted against the real application. Never registered in src/.
import { Controller, Get, Module, Post } from '@nestjs/common';
import { sql } from 'kysely';
import { TransactionContext } from '@app/persistence';
import { Public } from '../../src/http/auth/public.decorator.js';

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
}

@Module({ controllers: [ProbeController] })
export class ProbeModule {}
