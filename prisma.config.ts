// Prisma 7 keeps connection URLs out of schema.prisma. The CLI (dev and
// deploy only; nothing of Prisma runs inside the app) connects as the
// migrator role; the shadow database is optional and only used by
// `migrate dev` and `pnpm db:check` (docs/specs/04 §5).
import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'libs/persistence/prisma/schema.prisma',
  migrations: {
    path: 'libs/persistence/prisma/migrations',
  },
  datasource: {
    url: process.env.DATABASE_URL_MIGRATOR ?? '',
    shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL,
  },
});
