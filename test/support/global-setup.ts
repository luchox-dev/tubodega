// Runs once per `pnpm test:e2e`: migrates the test database and checks that
// the three Postgres roles exist (db/init/01-roles.sql).
import { execSync } from 'node:child_process';
import { config } from 'dotenv';
import pg from 'pg';

export default async function setup(): Promise<void> {
  config({ path: '.env.test', override: true });
  execSync('pnpm db:deploy', { stdio: 'inherit', env: process.env });

  const client = new pg.Client({ connectionString: process.env.DATABASE_URL_MIGRATOR });
  await client.connect();
  try {
    const { rows } = await client.query(
      `SELECT rolname FROM pg_roles
       WHERE rolname IN ('tubodega_app', 'tubodega_system', 'tubodega_migrator')`,
    );
    if (rows.length !== 3) {
      throw new Error(
        'Missing Postgres roles. Run `docker compose down -v && docker compose up -d db` so db/init runs.',
      );
    }
  } finally {
    await client.end();
  }
}
