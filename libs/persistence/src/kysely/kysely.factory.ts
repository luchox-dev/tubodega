import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CamelCasePlugin, Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';
import type { EnvironmentVariables } from '@app/common';
import type { DB } from '../generated/db.js';

/**
 * One connection pool per execution context (spec 07 §2):
 * - tenant: role tubodega_app, RLS enforced, size DATABASE_POOL_SIZE
 * - system: role tubodega_system (BYPASSRLS), size 3
 * - detached: role tubodega_app, size 2; short transactions that must not wait
 *   on the request pool (idempotency reservation, decision D-9)
 */
export type PoolName = 'tenant' | 'system' | 'detached';

@Injectable()
export class KyselyFactory implements OnModuleDestroy {
  private readonly dbs: Readonly<Record<PoolName, Kysely<DB>>>;

  constructor(config: ConfigService<EnvironmentVariables, true>) {
    const make = (url: string, max: number): Kysely<DB> =>
      new Kysely<DB>({
        dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString: url, max }) }),
        plugins: [new CamelCasePlugin()],
      });
    const tenantUrl = config.get('DATABASE_URL', { infer: true });
    this.dbs = {
      tenant: make(tenantUrl, config.get('DATABASE_POOL_SIZE', { infer: true })),
      system: make(config.get('DATABASE_URL_SYSTEM', { infer: true }), 3),
      detached: make(tenantUrl, 2),
    };
  }

  get(name: PoolName): Kysely<DB> {
    return this.dbs[name];
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all(Object.values(this.dbs).map((db) => db.destroy()));
  }
}
