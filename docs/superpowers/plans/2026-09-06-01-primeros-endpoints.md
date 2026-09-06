# Parte B — Plan 1: Primeros endpoints funcionales

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que una persona pueda registrar una organización, iniciar sesión y consultar su perfil por HTTP contra Postgres real, con el borde de la aplicación (transacción, RLS, `problem+json`, `traceId`) ya en su forma definitiva.

**Architecture:** Se construye la columna vertical completa una sola vez —`common` → `persistence` (Prisma + Kysely, unidad de trabajo, DAO mínimo) → `tenancy` (dominio puro, dos casos de uso, adaptadores) → borde HTTP (`apps/tubodega`)— para tres endpoints. Todo lo que se añade después (planes 2-10) reutiliza estas piezas sin rehacerlas. No hay idempotencia todavía porque los tres `POST`/`GET` de este plan son precisamente los exentos de [07 §5](docs/specs/07-composicion-y-contexto-de-ejecucion.md).

**Tech Stack:** NestJS 12 + Fastify · Kysely + `pg` · Prisma (dev) + `prisma-kysely` · `jose` · `@node-rs/argon2` · `uuid` v7 · `@nestjs/swagger` · vitest.

**Spec:** [01](docs/specs/01-arquitectura.md), [03](docs/specs/03-contrato-api.md), [04 §3.1, §4](docs/specs/04-persistencia.md), [07 §2-§4, §8-§9](docs/specs/07-composicion-y-contexto-de-ejecucion.md), [08](docs/specs/08-acceso-a-datos.md), [10](docs/specs/10-tenancy.md). Las decisiones D-4, D-9, D-10, D-13, D-16 de la Parte C aplican.

## Global Constraints (Plan 1)

- Prefijo `/v1`; JSON camelCase; ids UUIDv7; fechas ISO UTC; errores `application/problem+json` con `type = https://tubodega.app/errors/<type>`, `title`, `status`, `detail`, `instance`, `traceId`, `errors[]`.
- La organización viene **solo** del token (T-4). `ValidationPipe` con `whitelist: true, forbidNonWhitelisted: false, transform: true`.
- Toda petición autenticada abre transacción en el pool de tenant y ejecuta `set_config('app.current_org', <org>, true)` **antes** de cualquier caso de uso; `GET`/`HEAD` en `READ ONLY` (T-5). Las rutas `@Public()` abren en el pool de sistema.
- `run()` sin transacción activa lanza (D-13). Los casos de uso nunca abren transacciones.
- Sufijos: `*.spec.ts` sin infraestructura; `*.int-spec.ts` y `*.e2e-spec.ts` con Postgres (`pnpm test:e2e`). Ninguna prueba e2e toca la base.
- Ninguna prueba del servidor usa `new Date()`; `Clock` es un puerto. Dobles con comportamiento, no mocks.
- Alias `@app/<lib>` → `./libs/<lib>/src/index.ts`. Dominio puro: nada bajo `domain/` importa Nest, Kysely, `pg`, Prisma ni `../application` o `../infrastructure`.
- Las versiones exactas de librerías se fijan al instalar; si una API difiere de la mostrada (Kysely `startTransaction`/`savepoint`, `jose`, `prisma-kysely`), el ejecutor adapta el código y **no** cambia el diseño.

## Mapa de archivos del Plan 1

```
db/init/01-roles.sql
compose.yaml                                    (+ servicio db)
.env.example · .env.test
.dependency-cruiser.cjs
package.json · tsconfig.json · nest-cli.json · vitest.config.e2e.ts · tsconfig.typecheck.json
libs/common/src/
  brand.ts · ids.ts · result.ts · domain-error.ts · page.ts · events.ts · ports.ts · index.ts
  config/env.validation.ts
  infrastructure/system-clock.ts · infrastructure/uuidv7-generator.ts
libs/persistence/
  prisma/schema.prisma · prisma/migrations/0001_tenancy/migration.sql
  src/generated/db.ts (gitignored, generado)
  src/kysely/kysely.factory.ts · transaction.context.ts · kysely.unit-of-work.ts · errors.ts
  src/dao/base/abstract-org.dao.ts · errors.ts
  src/dao/organization.dao.ts · user.dao.ts · user-role.dao.ts · refresh-token.dao.ts · outbox-event.dao.ts
  src/repositories/organization.repository.ts · user.repository.ts · session.repository.ts
  src/outbox/outbox-event-publisher.ts
  src/persistence.module.ts · src/index.ts
  test/kysely/unit-of-work.int-spec.ts · test/schema/rls.int-spec.ts · test/repositories/user.repository.int-spec.ts
libs/tenancy/src/
  domain/ids.ts · role.ts · organization.ts · user.ts · request-context.ts · errors.ts (+ *.spec.ts)
  application/ports/*.ts · application/use-cases/create-organization.ts · authenticate.ts (+ *.spec.ts)
  infrastructure/argon2-password-hasher.ts · jose-token-issuer.ts (+ *.spec.ts)
  tenancy.module.ts · index.ts
libs/tenancy/test/builders/a-user.ts · an-organization.ts
libs/tenancy/test/doubles/*.ts
apps/tubodega/src/
  main.ts · app.setup.ts · app.module.ts
  http/context/request-store.ts · trace-id.hook.ts · ctx.decorator.ts
  http/auth/public.decorator.ts · auth.guard.ts
  http/tx/transaction.interceptor.ts · http/identity/identity.interceptor.ts
  http/problem/problem-details.ts · domain-error.filter.ts · validation.pipe.ts
  http/tenancy/organizations.controller.ts · auth.controller.ts · me.controller.ts · dto.ts
  adapters/tenancy/org-provisioner.adapter.ts
apps/tubodega/test/edge/pipeline.int-spec.ts
apps/tubodega/test/e2e/p1-registro-y-login.e2e-spec.ts
test/support/env.ts · global-setup.ts · db.ts · e2e/app.ts · e2e/http.ts · e2e/tenant.ts · e2e/problem.ts
```

---

### Task 1: Base de datos local, dependencias, variables de entorno y puertas

**Files:**
- Create: `db/init/01-roles.sql`, `.env.test`, `.dependency-cruiser.cjs`, `test/support/env.ts`, `test/support/global-setup.ts`
- Modify: `package.json`, `compose.yaml`, `.env.example`, `tsconfig.json`, `nest-cli.json`, `vitest.config.e2e.ts`, `tsconfig.typecheck.json`, `libs/common/src/config/env.validation.ts`, `.gitignore`

**Interfaces:**
- Produces: `EnvironmentVariables` con las 8 variables de este plan; roles `tubodega_migrator/app/system`; bases `tubodega`, `tubodega_test`, `tubodega_shadow`; scripts `db:generate`, `db:migrate`, `db:deploy`, `db:check`.

- [ ] **Step 1: Instalar dependencias**

```bash
pnpm add kysely pg jose @node-rs/argon2 uuid @nestjs/swagger
pnpm add -D prisma prisma-kysely @types/pg dependency-cruiser dotenv
```

- [ ] **Step 2: Roles y bases en `db/init/01-roles.sql`**

```sql
-- Se ejecuta una sola vez al crear el volumen del contenedor.
CREATE ROLE tubodega_migrator LOGIN PASSWORD 'migrator';
CREATE ROLE tubodega_app      LOGIN PASSWORD 'app'    NOBYPASSRLS;
CREATE ROLE tubodega_system   LOGIN PASSWORD 'system' BYPASSRLS;

CREATE DATABASE tubodega        OWNER tubodega_migrator;
CREATE DATABASE tubodega_test   OWNER tubodega_migrator;
CREATE DATABASE tubodega_shadow OWNER tubodega_migrator;
```

- [ ] **Step 3: Servicio `db` en `compose.yaml`**

```yaml
services:
  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
    ports:
      - "5432:5432"
    volumes:
      - ./db/init:/docker-entrypoint-initdb.d:ro
      - dbdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 5s
      timeout: 3s
      retries: 10
  tubodega:
    # (bloque existente sin cambios)
    depends_on:
      db:
        condition: service_healthy
volumes:
  dbdata: {}
```

- [ ] **Step 4: Variables en `env.validation.ts`** (añadir a la clase existente)

```ts
import { IsOptional, Matches, MinLength } from 'class-validator';

const PG_URL = /^postgres(ql)?:\/\/.+/;
const DURATION = /^\d+(ms|s|m|h|d)$/;

// dentro de EnvironmentVariables:
  @Matches(PG_URL) DATABASE_URL!: string;
  @Matches(PG_URL) DATABASE_URL_SYSTEM!: string;
  @Matches(PG_URL) DATABASE_URL_MIGRATOR!: string;
  @IsOptional() @Matches(PG_URL) SHADOW_DATABASE_URL?: string;

  @Transform(({ value }) => (value === undefined ? 10 : Number(value)))
  @IsInt() @Min(1) @Max(100)
  DATABASE_POOL_SIZE: number = 10;

  @MinLength(32) JWT_SECRET!: string;
  @Matches(DURATION) JWT_ACCESS_TTL: string = '15m';
  @Matches(DURATION) JWT_REFRESH_TTL: string = '30d';
```

Prueba en `libs/common/src/config/env.validation.spec.ts` (ampliar): `JWT_SECRET` corto aborta; `DATABASE_URL` con `mysql://` aborta; defaults `10`, `'15m'`, `'30d'`.

- [ ] **Step 5: `.env.example` y `.env.test`**

```dotenv
# .env.example (copiar a .env)
NODE_ENV=development
PORT=3000
DATABASE_URL=postgresql://tubodega_app:app@localhost:5432/tubodega
DATABASE_URL_SYSTEM=postgresql://tubodega_system:system@localhost:5432/tubodega
DATABASE_URL_MIGRATOR=postgresql://tubodega_migrator:migrator@localhost:5432/tubodega
SHADOW_DATABASE_URL=postgresql://tubodega_migrator:migrator@localhost:5432/tubodega_shadow
DATABASE_POOL_SIZE=10
JWT_SECRET=change-me-change-me-change-me-change-me
JWT_ACCESS_TTL=15m
JWT_REFRESH_TTL=30d
```

`.env.test` igual pero `NODE_ENV=test`, `PORT=3001`, bases `tubodega_test` y `JWT_SECRET=test-secret-test-secret-test-secret-0123`. Se versiona (solo valores de prueba).

- [ ] **Step 6: Scripts y alias**

`package.json`:
```jsonc
"db:generate": "prisma generate --schema libs/persistence/prisma/schema.prisma",
"db:migrate":  "prisma migrate dev --schema libs/persistence/prisma/schema.prisma",
"db:deploy":   "prisma migrate deploy --schema libs/persistence/prisma/schema.prisma",
"db:check":    "prisma migrate diff --from-migrations libs/persistence/prisma/migrations --to-schema-datamodel libs/persistence/prisma/schema.prisma --shadow-database-url \"$SHADOW_DATABASE_URL\" --exit-code",
"lint":        "oxlint apps/ libs/ test/ && depcruise apps libs --config .dependency-cruiser.cjs",
"test:e2e":    "vitest run --config ./vitest.config.e2e.ts"
```

`tsconfig.json` `paths`: añadir `"@app/persistence": ["./libs/persistence/src/index.ts"]`, `"@app/tenancy": ["./libs/tenancy/src/index.ts"]` (sin variantes `/*`). `nest-cli.json`: proyectos `persistence` y `tenancy` con el mismo patrón que `common`, y sus `tsconfig.lib.json` copiados de `libs/common/tsconfig.lib.json`. `tsconfig.typecheck.json` `include`: añadir `"test/**/*.ts"`. `.gitignore`: `libs/persistence/src/generated/`.

- [ ] **Step 7: `.dependency-cruiser.cjs`**

```js
module.exports = {
  options: { tsPreCompilationDeps: true, tsConfig: { fileName: 'tsconfig.json' } },
  forbidden: [
    { name: 'R-1 domain-is-pure', severity: 'error',
      from: { path: '^libs/[^/]+/src/domain/' },
      to: { path: ['^node_modules/(@nestjs|kysely|pg|@prisma|prisma|fastify)', '^libs/[^/]+/src/(application|infrastructure)/'] } },
    { name: 'R-2 no-cycles', severity: 'error', from: {}, to: { circular: true } },
    { name: 'R-2 order', severity: 'error',
      from: { path: '^libs/tenancy/' }, to: { path: '^libs/(catalog|inventory|process|alerts)/' } },
    { name: 'R-3 only-barrels', severity: 'error',
      from: { path: '^(apps|libs)/([^/]+)/' },
      to: { path: '^libs/(?!\\2/)[^/]+/src/(?!index\\.ts$).+' } },
    { name: 'R-4 persistence-not-imported', severity: 'error',
      from: { path: '^libs/(?!persistence/)' }, to: { path: '^libs/persistence/' } },
  ],
};
```

- [ ] **Step 8: `vitest.config.e2e.ts` y `test/support`**

```ts
// vitest.config.e2e.ts
export default defineConfig({
  plugins: [swc.vite()],
  resolve: { tsconfigPaths: true },
  test: {
    globals: true, root: './',
    include: ['**/*.int-spec.ts', '**/*.e2e-spec.ts', '**/*.prop-spec.ts'],
    globalSetup: ['./test/support/global-setup.ts'],
    setupFiles: ['./test/support/env.ts'],
    testTimeout: 30_000, hookTimeout: 60_000,
  },
});
```

```ts
// test/support/env.ts — carga .env.test en cada worker
import { config } from 'dotenv';
config({ path: '.env.test', override: true });
```

```ts
// test/support/global-setup.ts — migra la base de test y comprueba los roles
import { execSync } from 'node:child_process';
import { config } from 'dotenv';
import pg from 'pg';

export default async function setup() {
  config({ path: '.env.test', override: true });
  execSync('pnpm db:deploy', { stdio: 'inherit', env: process.env });
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL_MIGRATOR });
  await client.connect();
  const { rows } = await client.query(
    `SELECT rolname FROM pg_roles WHERE rolname IN ('tubodega_app','tubodega_system','tubodega_migrator')`,
  );
  await client.end();
  if (rows.length !== 3) throw new Error('faltan roles: ejecuta docker compose up -d db con el volumen limpio');
}
```

- [ ] **Step 9: Verificar**

```bash
docker compose up -d db
docker compose exec db psql -U postgres -c '\du' -c '\l'   # 3 roles, 3 bases
pnpm lint && pnpm typecheck && pnpm test
```
Expected: verde. `pnpm lint` debe fallar si se añade temporalmente `import 'kysely'` en un archivo bajo `libs/common/src/` con ruta `domain/` (crear `libs/common/src/domain/x.ts` para probar y borrarlo).

- [ ] **Step 10: Commit**

```bash
git add -A && git commit -m "chore(plan-1): postgres local con tres roles, env, alias y reglas de arquitectura"
```

---

### Task 2: `libs/common` — tipos del núcleo

**Files:**
- Create: `libs/common/src/{brand.ts, ids.ts, result.ts, domain-error.ts, page.ts, events.ts, ports.ts}`, `libs/common/src/{result.spec.ts, page.spec.ts}`, `libs/common/src/infrastructure/{system-clock.ts, uuidv7-generator.ts}`
- Modify: `libs/common/src/index.ts`
- Delete: `libs/common/src/common.module.ts`, `common.service.ts`, `common.service.spec.ts`

**Interfaces:**
- Produces: todo lo de D-4 (Parte C §3). Firmas abajo; las usan todas las tareas siguientes.

- [ ] **Step 1: Pruebas primero**

```ts
// libs/common/src/result.spec.ts
import { ok, err, unwrap, DomainError } from './index.js';
class Boom extends DomainError { readonly type = 'boom'; readonly status = 422; }
describe('Result', () => {
  it('ok/err/unwrap', () => {
    expect(ok(1)).toEqual({ ok: true, value: 1 });
    const e = err(new Boom('x'));
    expect(e.ok).toBe(false);
    expect(() => unwrap(e)).toThrow(Boom);
    expect(unwrap(ok('v'))).toBe('v');
  });
});
// libs/common/src/page.spec.ts
import { encodeCursor, decodeCursor } from './page.js';
describe('Cursor', () => {
  it('ida y vuelta', () => {
    const c = encodeCursor(['2026-09-06T00:00:00.000Z', 'abc', null]);
    expect(decodeCursor(c)).toEqual(['2026-09-06T00:00:00.000Z', 'abc', null]);
  });
  it('corrupto → null', () => { expect(decodeCursor('***' as any)).toBeNull(); });
});
```

- [ ] **Step 2: Run** `pnpm test libs/common` → FAIL (módulos no existen).

- [ ] **Step 3: Implementar**

```ts
// brand.ts
export type Branded<T, K extends string> = T & { readonly __brand: K };
// ids.ts
import type { Branded } from './brand.js';
export type OrgId = Branded<string, 'OrgId'>;
export type UserId = Branded<string, 'UserId'>;
export type TraceId = Branded<string, 'TraceId'>;
export type ProcessInstanceId = Branded<string, 'ProcessInstanceId'>;
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID_RE.test(v);

// domain-error.ts
export interface ProblemFieldError { readonly pointer: string; readonly code: string; readonly [k: string]: unknown }
export abstract class DomainError extends Error {
  abstract readonly type: string;
  abstract readonly status: number;
  readonly errors?: readonly ProblemFieldError[];
  readonly extensions?: Record<string, unknown>;
  constructor(detail: string, opts?: { errors?: readonly ProblemFieldError[]; extensions?: Record<string, unknown> }) {
    super(detail); this.errors = opts?.errors; this.extensions = opts?.extensions;
  }
}

// result.ts
import type { DomainError } from './domain-error.js';
export type Result<T, E extends DomainError = DomainError> =
  | { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: E };
export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
export const err = <E extends DomainError>(error: E): Result<never, E> => ({ ok: false, error });
export function unwrap<T>(r: Result<T>): T { if (r.ok) return r.value; throw r.error; }

// page.ts
import type { Branded } from './brand.js';
export type Cursor = Branded<string, 'Cursor'>;
export interface Page<T> { readonly data: readonly T[]; readonly nextCursor?: Cursor; readonly hasMore: boolean }
export type CursorParts = readonly (string | number | null)[];
export const encodeCursor = (p: CursorParts): Cursor => Buffer.from(JSON.stringify(p)).toString('base64url') as Cursor;
export function decodeCursor(c: Cursor): CursorParts | null {
  try { const v = JSON.parse(Buffer.from(c, 'base64url').toString('utf8')); return Array.isArray(v) ? v : null; }
  catch { return null; }
}

// events.ts
import type { OrgId, TraceId } from './ids.js';
export interface DomainEvent { readonly id: string; readonly type: string; readonly orgId: OrgId; readonly traceId: TraceId; readonly occurredAt: Date; readonly data: Record<string, unknown> }

// ports.ts
import type { DomainEvent } from './events.js';
export interface Clock { now(): Date }
export interface IdGenerator { next(): string }
export interface UnitOfWork { run<T>(fn: () => Promise<T>, opts?: { readonly readOnly?: boolean }): Promise<T> }
export interface EventPublisher { publish(events: readonly DomainEvent[]): Promise<void> }
export const CLOCK = Symbol('Clock'); export const ID_GENERATOR = Symbol('IdGenerator');
export const UNIT_OF_WORK = Symbol('UnitOfWork'); export const EVENT_PUBLISHER = Symbol('EventPublisher');

// infrastructure/system-clock.ts
export class SystemClock implements Clock { now() { return new Date(); } }
// infrastructure/uuidv7-generator.ts
import { v7 } from 'uuid';
export class Uuidv7Generator implements IdGenerator { next() { return v7(); } }
```

`index.ts` exporta todo lo anterior más `config/env.validation.js`.

- [ ] **Step 4: Run** `pnpm test libs/common && pnpm typecheck` → PASS.
- [ ] **Step 5: Commit** `feat(common): tipos del núcleo, Result, DomainError, cursor y puertos`

---

### Task 3: Esquema de tenancy — `schema.prisma` y migración `0001_tenancy`

**Files:**
- Create: `libs/persistence/prisma/schema.prisma`, `libs/persistence/prisma/migrations/0001_tenancy/migration.sql`, `libs/persistence/prisma/migrations/migration_lock.toml` (lo genera Prisma), `libs/persistence/tsconfig.lib.json`

**Interfaces:**
- Produces: tablas `organization`, `app_user`, `user_role`, `refresh_token`, `outbox_event` ([04 §3.1, §3.8](docs/specs/04-persistencia.md)); tipos `DB` en `libs/persistence/src/generated/db.ts` con claves `organization`, `appUser`, `userRole`, `refreshToken`, `outboxEvent`.

- [ ] **Step 1: `schema.prisma`**

```prisma
generator kysely {
  provider        = "prisma-kysely"
  output          = "../src/generated"
  fileName        = "db.ts"
  camelCase       = true
  previewFeatures = ["postgresqlExtensions"]
}
datasource db {
  provider          = "postgresql"
  url               = env("DATABASE_URL_MIGRATOR")
  shadowDatabaseUrl = env("SHADOW_DATABASE_URL")
  extensions        = [citext]
}

enum Role { OWNER ADMIN OPERATOR VIEWER  @@map("role_enum") }

model Organization {
  id        String   @id @db.Uuid
  name      String
  slug      String   @unique @db.VarChar(64)
  active    Boolean  @default(true)
  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz
  updatedAt DateTime @default(now()) @map("updated_at") @db.Timestamptz
  version   Int      @default(1)
  users     AppUser[]
  @@map("organization")
}

model AppUser {
  id           String   @id @db.Uuid
  orgId        String   @map("org_id") @db.Uuid
  email        String   @db.Citext
  passwordHash String   @map("password_hash")
  name         String
  active       Boolean  @default(true)
  createdAt    DateTime @default(now()) @map("created_at") @db.Timestamptz
  updatedAt    DateTime @default(now()) @map("updated_at") @db.Timestamptz
  version      Int      @default(1)
  organization Organization   @relation(fields: [orgId], references: [id])
  roles        UserRole[]
  sessions     RefreshToken[]
  @@unique([orgId, email])
  @@unique([orgId, id])
  @@map("app_user")
}

model UserRole {
  userId String @map("user_id") @db.Uuid
  orgId  String @map("org_id") @db.Uuid
  role   Role
  user   AppUser @relation(fields: [orgId, userId], references: [orgId, id])
  @@id([userId, role])
  @@map("user_role")
}

model RefreshToken {
  id        String    @id @db.Uuid
  orgId     String    @map("org_id") @db.Uuid
  userId    String    @map("user_id") @db.Uuid
  tokenHash String    @unique @map("token_hash") @db.VarChar(64)
  expiresAt DateTime  @map("expires_at") @db.Timestamptz
  revokedAt DateTime? @map("revoked_at") @db.Timestamptz
  createdAt DateTime  @default(now()) @map("created_at") @db.Timestamptz
  user      AppUser   @relation(fields: [orgId, userId], references: [orgId, id])
  @@index([userId])            // parcial WHERE revoked_at IS NULL: se añade a mano
  @@map("refresh_token")
}

model OutboxEvent {
  id          String    @id @db.Uuid
  orgId       String    @map("org_id") @db.Uuid
  type        String    @db.VarChar(64)
  payload     Json
  traceId     String    @map("trace_id") @db.Uuid
  occurredAt  DateTime  @default(now()) @map("occurred_at") @db.Timestamptz
  publishedAt DateTime? @map("published_at") @db.Timestamptz
  @@index([publishedAt, occurredAt])   // parcial WHERE published_at IS NULL: a mano
  @@map("outbox_event")
}
```

Si Prisma no acepta `previewFeatures` en un generador ajeno, añadir `generator client { provider = "prisma-client-js"; previewFeatures = ["postgresqlExtensions"] }` y no usarlo nunca en código.

- [ ] **Step 2: Generar la migración sin aplicarla**

```bash
set -a; source .env; set +a
pnpm prisma migrate dev --create-only --name tenancy --schema libs/persistence/prisma/schema.prisma
```

- [ ] **Step 3: Completar `migration.sql` a mano** (al final del archivo generado)

```sql
-- ── Índices parciales (declarados también en schema.prisma) ─────────────────
DROP INDEX IF EXISTS "refresh_token_user_id_idx";
CREATE INDEX "refresh_token_user_id_idx" ON "refresh_token" ("user_id") WHERE "revoked_at" IS NULL;
DROP INDEX IF EXISTS "outbox_event_published_at_occurred_at_idx";
CREATE INDEX "outbox_event_published_at_occurred_at_idx" ON "outbox_event" ("published_at", "occurred_at") WHERE "published_at" IS NULL;

-- ── RLS en toda tabla con org_id (organization no lleva) [04 §4] ────────────
DO $$ DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['app_user','user_role','refresh_token','outbox_event'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY org_isolation ON %I
      USING      (org_id = current_setting('app.current_org')::uuid)
      WITH CHECK (org_id = current_setting('app.current_org')::uuid)$p$, t);
  END LOOP;
END $$;

-- ── Privilegios de los roles de aplicación ──────────────────────────────────
GRANT USAGE ON SCHEMA public TO tubodega_app, tubodega_system;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO tubodega_app, tubodega_system;
ALTER DEFAULT PRIVILEGES FOR ROLE tubodega_migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO tubodega_app, tubodega_system;
REVOKE ALL ON "_prisma_migrations" FROM tubodega_app, tubodega_system;
```

- [ ] **Step 4: Aplicar, generar tipos y verificar la puerta**

```bash
pnpm db:migrate && pnpm db:generate && pnpm db:check; echo "exit=$?"
```
Expected: migración aplicada; `libs/persistence/src/generated/db.ts` con `interface DB { appUser: AppUser; organization: Organization; ... }` en camelCase; `db:check` `exit=0`. Comprobar: `psql -U tubodega_app -d tubodega -c 'select * from app_user'` → error `unrecognized configuration parameter "app.current_org"` (RLS con FORCE está activo).

- [ ] **Step 5: Commit** `feat(persistence): esquema de tenancy con RLS, roles y tipos Kysely generados`

---

### Task 4: Kysely — fábrica de pools, contexto de transacción y unidad de trabajo

**Files:**
- Create: `libs/persistence/src/kysely/{kysely.factory.ts, transaction.context.ts, kysely.unit-of-work.ts, errors.ts}`, `libs/persistence/src/persistence.module.ts`, `libs/persistence/src/index.ts`, `libs/persistence/test/kysely/unit-of-work.int-spec.ts`, `test/support/db.ts`

**Interfaces:**
- Consumes: `UnitOfWork`, `OrgId`, `EnvironmentVariables` de `@app/common`; `DB` generado.
- Produces:
```ts
type PoolName = 'tenant' | 'system';
class KyselyFactory { get(name: PoolName): Kysely<DB> }
class TransactionContext { has(): boolean; current(): ControlledTransaction<DB, any>; runWith<T>(tx, fn: () => Promise<T>): Promise<T> }
type TxScope = { pool: 'tenant'; orgId: OrgId } | { pool: 'system'; orgId?: OrgId };
class KyselyUnitOfWork implements UnitOfWork {
  run<T>(fn, opts?): Promise<T>;                       // SAVEPOINT; sin tx activa lanza NoActiveTransactionError
  runAs<T>(scope: TxScope, fn, opts?: { readOnly?: boolean }): Promise<T>;   // tx raíz + set_config app.current_org
}
class NoActiveTransactionError extends Error
// test/support/db.ts
function createPersistenceHarness(): Promise<{ uow: KyselyUnitOfWork; ctx: TransactionContext; factory: KyselyFactory; get<T>(token): T; close(): Promise<void> }>
function withRollback<T>(uow, scope: TxScope, fn: () => Promise<T>): Promise<T>
```

- [ ] **Step 1: Prueba de integración primero**

```ts
// libs/persistence/test/kysely/unit-of-work.int-spec.ts
import { sql } from 'kysely';
import { createPersistenceHarness, withRollback } from '../../../../test/support/db.js';
import { NoActiveTransactionError } from '@app/persistence';

const ORG = '018f3a2b-7c4d-7000-8000-a1b2c3d4e5f6' as any;
describe('KyselyUnitOfWork', () => {
  let h: Awaited<ReturnType<typeof createPersistenceHarness>>;
  beforeAll(async () => { h = await createPersistenceHarness(); });
  afterAll(() => h.close());

  it('run() sin transacción lanza', async () => {
    await expect(h.uow.run(async () => 1)).rejects.toBeInstanceOf(NoActiveTransactionError);
  });
  it('runAs tenant fija app.current_org', async () => {
    const v = await withRollback(h.uow, { pool: 'tenant', orgId: ORG }, async () => {
      const r = await sql<{ v: string }>`select current_setting('app.current_org') as v`.execute(h.ctx.current());
      return r.rows[0].v;
    });
    expect(v).toBe(ORG);
  });
  it('run() anidado es un SAVEPOINT: su fallo no aborta la transacción externa', async () => {
    await withRollback(h.uow, { pool: 'system' }, async () => {
      await expect(h.uow.run(async () => { await sql`select 1/0`.execute(h.ctx.current()); })).rejects.toThrow();
      const r = await sql<{ one: number }>`select 1 as one`.execute(h.ctx.current());
      expect(r.rows[0].one).toBe(1);
    });
  });
  it('readOnly rechaza escrituras', async () => {
    await expect(h.uow.runAs({ pool: 'system' }, async () => {
      await sql`insert into outbox_event (id, org_id, type, payload, trace_id) values (gen_random_uuid(), ${ORG}, 't', '{}', gen_random_uuid())`.execute(h.ctx.current());
    }, { readOnly: true })).rejects.toMatchObject({ code: '25006' });
  });
});
```

- [ ] **Step 2: Run** `pnpm test:e2e libs/persistence/test/kysely` → FAIL (no existe el módulo).

- [ ] **Step 3: Implementar**

```ts
// errors.ts
export class NoActiveTransactionError extends Error { constructor() { super('DAO invocado fuera de UnitOfWork.run()'); } }

// kysely.factory.ts
import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CamelCasePlugin, Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';
import type { EnvironmentVariables } from '@app/common';
import type { DB } from '../generated/db.js';
export type PoolName = 'tenant' | 'system';
@Injectable()
export class KyselyFactory implements OnModuleDestroy {
  private readonly dbs: Record<PoolName, Kysely<DB>>;
  constructor(config: ConfigService<EnvironmentVariables, true>) {
    const make = (url: string, max: number) => new Kysely<DB>({
      dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString: url, max }) }),
      plugins: [new CamelCasePlugin()],
    });
    this.dbs = {
      tenant: make(config.get('DATABASE_URL', { infer: true }), config.get('DATABASE_POOL_SIZE', { infer: true })),
      system: make(config.get('DATABASE_URL_SYSTEM', { infer: true }), 3),
    };
  }
  get(name: PoolName) { return this.dbs[name]; }
  async onModuleDestroy() { await Promise.all(Object.values(this.dbs).map((d) => d.destroy())); }
}

// transaction.context.ts
import { AsyncLocalStorage } from 'node:async_hooks';
import { Injectable } from '@nestjs/common';
import type { ControlledTransaction } from 'kysely';
import type { DB } from '../generated/db.js';
import { NoActiveTransactionError } from './errors.js';
export type Tx = ControlledTransaction<DB, any>;
@Injectable()
export class TransactionContext {
  private readonly als = new AsyncLocalStorage<{ tx: Tx }>();
  has() { return this.als.getStore() !== undefined; }
  current(): Tx { const s = this.als.getStore(); if (!s) throw new NoActiveTransactionError(); return s.tx; }
  runWith<T>(tx: Tx, fn: () => Promise<T>) { return this.als.run({ tx }, fn); }
}

// kysely.unit-of-work.ts
import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import type { OrgId, UnitOfWork } from '@app/common';
import { KyselyFactory } from './kysely.factory.js';
import { TransactionContext } from './transaction.context.js';
import { NoActiveTransactionError } from './errors.js';
export type TxScope = { readonly pool: 'tenant'; readonly orgId: OrgId } | { readonly pool: 'system'; readonly orgId?: OrgId };
@Injectable()
export class KyselyUnitOfWork implements UnitOfWork {
  private seq = 0;
  constructor(private readonly factory: KyselyFactory, private readonly ctx: TransactionContext) {}

  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (!this.ctx.has()) throw new NoActiveTransactionError();
    const tx = this.ctx.current();
    const name = `sp_${++this.seq}`;
    const sp = await tx.savepoint(name).execute();
    try { const out = await fn(); await sp.releaseSavepoint(name).execute(); return out; }
    catch (e) { await sp.rollbackToSavepoint(name).execute(); throw e; }
  }

  async runAs<T>(scope: TxScope, fn: () => Promise<T>, opts?: { readonly readOnly?: boolean }): Promise<T> {
    if (this.ctx.has()) throw new Error('runAs() dentro de una transacción activa');
    const tx = await this.factory.get(scope.pool).startTransaction()
      .setAccessMode(opts?.readOnly ? 'read only' : 'read write').execute();
    try {
      if (scope.orgId) await sql`select set_config('app.current_org', ${scope.orgId}, true)`.execute(tx);
      const out = await this.ctx.runWith(tx, fn);
      await tx.commit().execute();
      return out;
    } catch (e) { await tx.rollback().execute(); throw e; }
  }
}
```

`set_config(..., true)` es `SET LOCAL` con parámetro: muere con la transacción ([04 §4](docs/specs/04-persistencia.md)).

```ts
// persistence.module.ts (crece en tareas 5 y 8)
@Module({ providers: [KyselyFactory, TransactionContext, KyselyUnitOfWork, { provide: UNIT_OF_WORK, useExisting: KyselyUnitOfWork }],
          exports: [KyselyUnitOfWork, UNIT_OF_WORK, TransactionContext] })
export class PersistenceModule {}
```

```ts
// test/support/db.ts
import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { validate } from '@app/common';
import { KyselyFactory, KyselyUnitOfWork, PersistenceModule, TransactionContext, type TxScope } from '@app/persistence';
class RollbackSentinel extends Error {}
export async function createPersistenceHarness() {
  const mod = await Test.createTestingModule({ imports: [ConfigModule.forRoot({ isGlobal: true, validate }), PersistenceModule] }).compile();
  return { uow: mod.get(KyselyUnitOfWork), ctx: mod.get(TransactionContext), factory: mod.get(KyselyFactory),
           get: <T>(t: any): T => mod.get(t), close: () => mod.close() };
}
export async function withRollback<T>(uow: KyselyUnitOfWork, scope: TxScope, fn: () => Promise<T>): Promise<T> {
  let out!: T;
  try { await uow.runAs(scope, async () => { out = await fn(); throw new RollbackSentinel(); }); }
  catch (e) { if (!(e instanceof RollbackSentinel)) throw e; }
  return out;
}
```

- [ ] **Step 4: Run** `pnpm test:e2e libs/persistence/test/kysely` → PASS (4 pruebas).
- [ ] **Step 5: Commit** `feat(persistence): pools por rol, transacción ambiental y unidad de trabajo con savepoints`

---

### Task 5: DAO base mínimo y concreciones de tenancy

Base **mínima** de [08 §3-§4](docs/specs/08-acceso-a-datos.md): clave `id`, `where` por igualdad, bloqueo optimista. El DSL completo, `findPage`, `createMany`, la familia plana y la prueba de tipo llegan en el plan 2 sin cambiar estas firmas.

**Files:**
- Create: `libs/persistence/src/dao/base/{abstract-org.dao.ts, errors.ts}`, `libs/persistence/src/dao/{organization.dao.ts, user.dao.ts, user-role.dao.ts, refresh-token.dao.ts, outbox-event.dao.ts}`, `libs/persistence/src/models/index.ts`, `libs/persistence/test/dao/org-dao.int-spec.ts`

**Interfaces (produces):**
```ts
// models/index.ts
export type OrganizationModel = Selectable<DB['organization']>; NewOrganization = Insertable<...>; OrganizationPatch = Updateable<...>
// idem UserModel/NewUser/UserPatch, UserRoleModel/NewUserRole, RefreshTokenModel/NewRefreshToken/RefreshTokenPatch, OutboxEventModel/NewOutboxEvent
// dao/base/errors.ts
class RecordNotFoundError extends Error; class VersionConflictError extends Error;
class UniqueViolationError extends Error { constructor(readonly constraint: string) }
function translatePgError(e: unknown): never            // 23505 → UniqueViolationError(constraint); resto: rethrow
// dao/base/abstract-org.dao.ts
abstract class AbstractOrgDao<TB extends keyof DB & string> {
  protected abstract readonly table: TB; protected readonly versioned: boolean = false;
  protected get db(): Tx                                   // TransactionContext.current()
  findUnique(orgId: OrgId, id: string): Promise<Selectable<DB[TB]> | null>
  findFirst(orgId: OrgId, where: Partial<Selectable<DB[TB]>>): Promise<Selectable<DB[TB]> | null>
  findMany(orgId: OrgId, where?: Partial<Selectable<DB[TB]>>): Promise<Selectable<DB[TB]>[]>
  create(data: Insertable<DB[TB]>): Promise<Selectable<DB[TB]>>          // INSERT … RETURNING *
  update(orgId: OrgId, id: string, data: Updateable<DB[TB]>, opts?: { expectedVersion?: number }): Promise<Selectable<DB[TB]>>
}
// OrganizationDao: NO extiende la familia Org (la tabla no tiene org_id): findById, findBySlug, insert, update(expectedVersion)
// UserDao extends AbstractOrgDao<'appUser'> { versioned = true; findByEmailGlobal(email): Promise<UserModel[]> }
// UserRoleDao extends AbstractOrgDao<'userRole'> { listByUser(orgId, userId); replaceForUser(orgId, userId, roles) }
// RefreshTokenDao extends AbstractOrgDao<'refreshToken'> { findByHashGlobal(hash) }
// OutboxEventDao extends AbstractOrgDao<'outboxEvent'>   (solo create en este plan)
```

- [ ] **Step 1: Prueba de integración** `org-dao.int-spec.ts` contra `app_user` (pool de sistema, `withRollback`, una organización insertada en el propio test con `OrganizationDao.insert`): `create` + `findUnique`; `findFirst({ email })`; `update` con `expectedVersion` correcta incrementa `version` y `updated_at`; con versión vieja → `VersionConflictError`; id inexistente → `RecordNotFoundError`; segundo `create` con el mismo `email` → `UniqueViolationError` cuyo `constraint` es `app_user_org_id_email_key`; `findUnique` con otro `orgId` → `null` (el filtro del repositorio funciona aunque el rol sea `system`).

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implementar `abstract-org.dao.ts`** (núcleo; los `as any` acotan la genericidad de Kysely sobre nombres de tabla dinámicos y están permitidos por `oxlint.json`)

```ts
export abstract class AbstractOrgDao<TB extends keyof DB & string> {
  protected abstract readonly table: TB;
  protected readonly versioned: boolean = false;
  constructor(protected readonly ctx: TransactionContext) {}
  protected get db(): Tx { return this.ctx.current(); }

  async findUnique(orgId: OrgId, id: string) {
    const row = await (this.db.selectFrom(this.table) as any).selectAll()
      .where('orgId', '=', orgId).where('id', '=', id).executeTakeFirst();
    return (row ?? null) as Selectable<DB[TB]> | null;
  }
  async findFirst(orgId: OrgId, where: Partial<Selectable<DB[TB]>>) {
    let q = (this.db.selectFrom(this.table) as any).selectAll().where('orgId', '=', orgId);
    for (const [k, v] of Object.entries(where)) q = v === null ? q.where(k, 'is', null) : q.where(k, '=', v);
    return ((await q.executeTakeFirst()) ?? null) as Selectable<DB[TB]> | null;
  }
  async findMany(orgId: OrgId, where: Partial<Selectable<DB[TB]>> = {}) { /* igual, .execute() */ }
  async create(data: Insertable<DB[TB]>) {
    try { return await (this.db.insertInto(this.table) as any).values(data).returningAll().executeTakeFirstOrThrow(); }
    catch (e) { translatePgError(e); }
  }
  async update(orgId: OrgId, id: string, data: Updateable<DB[TB]>, opts: { expectedVersion?: number } = {}) {
    const patch: any = { ...data };
    if (this.versioned) { patch.version = sql`version + 1`; patch.updatedAt = sql`now()`; }
    let q = (this.db.updateTable(this.table) as any).set(patch).where('orgId', '=', orgId).where('id', '=', id);
    if (opts.expectedVersion !== undefined) q = q.where('version', '=', opts.expectedVersion);
    let row;
    try { row = await q.returningAll().executeTakeFirst(); } catch (e) { translatePgError(e); }
    if (row) return row as Selectable<DB[TB]>;
    const exists = await this.findUnique(orgId, id);
    if (!exists) throw new RecordNotFoundError(this.table, id);
    throw new VersionConflictError(this.table, id);
  }
}
export function translatePgError(e: unknown): never {
  const code = (e as any)?.code;
  if (code === '23505') throw new UniqueViolationError((e as any).constraint ?? 'unknown');
  throw e;
}
```

`UserDao.findByEmailGlobal(email)` es el único método que cruza organizaciones ([07 §2](docs/specs/07-composicion-y-contexto-de-ejecucion.md)): `selectFrom('appUser').selectAll().where('email', '=', email).where('active', '=', true).execute()`.

- [ ] **Step 4: Run** → PASS. `pnpm typecheck` verde.
- [ ] **Step 5: Commit** `feat(persistence): DAO base mínimo con bloqueo optimista y concreciones de tenancy`

---

### Task 6: Tenancy — dominio

**Files:**
- Create: `libs/tenancy/src/domain/{ids.ts, role.ts, organization.ts, user.ts, request-context.ts, errors.ts}` y specs `{ids.spec.ts, role.spec.ts, user.spec.ts}`, `libs/tenancy/src/index.ts`, `libs/tenancy/test/builders/{a-user.ts, an-organization.ts}`

**Interfaces (produces):**
```ts
type Email = Branded<string,'Email'>; type Slug = Branded<string,'Slug'>;
const Email: { of(raw: string): Result<Email> };  // trim + minúsculas; regex simple con @ y punto
const Slug:  { of(raw: string): Result<Slug> };   // /^[a-z0-9](?:[a-z0-9-]{1,62}[a-z0-9])$/
enum Role { OWNER='OWNER', ADMIN='ADMIN', OPERATOR='OPERATOR', VIEWER='VIEWER' }
enum Action { MANAGE_ORG, MANAGE_USERS, MANAGE_CATALOG, CREATE_BATCH, MANAGE_NODES, RECORD_MOVEMENT, REVERSE_MOVEMENT, READ }  // valores string
const PERMISSIONS: Readonly<Record<Role, ReadonlySet<Action>>>   // matriz de [10 §2]
class Organization { id: OrgId; name; slug: Slug; active; version; static create(input: { id; name; slug: string }): Result<Organization> }
class User { id: UserId; orgId; email: Email; name; passwordHash; roles: ReadonlySet<Role>; active; version;
  can(action: Action): boolean;
  static create(input: { id; orgId; email: string; name; passwordHash; roles: Role[] }): Result<User> }
interface RequestContext { orgId: OrgId; userId: UserId; roles: ReadonlySet<Role>; traceId: TraceId }
interface TokenClaims { sub: UserId; org: OrgId; roles: readonly Role[]; exp: number }
// errors.ts (todas extienden DomainError):
InvalidEmailError(422 'invalid-email') · InvalidSlugError(422 'invalid-slug') · SlugTakenError(409 'slug-taken') · EmailTakenError(409 'email-taken')
InvalidCredentialsError(401 'invalid-credentials') · TokenExpiredError(401 'token-expired') · AmbiguousLoginError(409 'ambiguous-login')
InsufficientRoleError(403 'insufficient-role') · LastOwnerError(422 'last-owner')
```

- [ ] **Step 1: Pruebas** — `role.spec.ts` genera los 32 casos desde la tabla de [10 §2](docs/specs/10-tenancy.md) (`it.each`); `ids.spec.ts`: `Email.of(' Marta@X.com ')` → `marta@x.com`, `Email.of('nope')` → `InvalidEmailError`; `Slug.of('la-esquina')` ok, `'La Esquina'`, `'ab'`, `'a'.repeat(65)` → `InvalidSlugError`; `user.spec.ts`: `User.create` normaliza el correo y `can(READ)` es cierto para todo rol; sin roles → `can(READ)` falso.
- [ ] **Step 2: Run** `pnpm test libs/tenancy` → FAIL.
- [ ] **Step 3: Implementar** (la matriz como constante; `can` = `[...roles].some(r => PERMISSIONS[r].has(action))`). Builders: `aUser({ roles: [Role.OWNER] })`, `anOrganization()`.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(tenancy): dominio — roles, permisos, correo, slug, usuario y organización`

---

### Task 7: Tenancy — `CreateOrganization` y `Authenticate` con dobles

**Files:**
- Create: `libs/tenancy/src/application/ports/{organization.repository.ts, user.repository.ts, session.repository.ts, password-hasher.ts, token-issuer.ts, org-provisioner.ts}`, `libs/tenancy/src/application/use-cases/{create-organization.ts, authenticate.ts}` (+ `.spec.ts`), `libs/tenancy/test/doubles/{in-memory-organization.repository.ts, in-memory-user.repository.ts, in-memory-session.repository.ts, fake-password-hasher.ts, fake-token-issuer.ts, fixed-clock.ts, sequential-id-generator.ts, in-memory-event-publisher.ts, noop-unit-of-work.ts, recording-org-provisioner.ts}`

**Interfaces:**
- Consumes: `UnitOfWork`, `Clock`, `IdGenerator`, `EventPublisher` (`@app/common`); dominio de la tarea 6.
- Produces (firmas de [10 §4-§5](docs/specs/10-tenancy.md) con estas precisiones):
```ts
interface OrganizationRepository { findById(id: OrgId); findBySlug(slug: Slug); save(org: Organization): Promise<void> }
interface UserRepository { findById(orgId, id); findByEmail(orgId, email); findByEmailGlobal(email): Promise<User[]>; countActiveOwners(orgId); save(user): Promise<void> }
interface Session { id: string; userId: UserId; orgId: OrgId; tokenHash: string; expiresAt: Date; revokedAt?: Date }
interface SessionRepository { create(s: Omit<Session,'revokedAt'>): Promise<void>; findByHash(hash): Promise<Session|null>; revoke(id, at: Date): Promise<void> }
interface PasswordHasher { hash(plain): Promise<string>; verify(plain, hash): Promise<boolean> }
interface TokenIssuer { issueAccess(user: User): Promise<string>; verify(token): Promise<{ ok: true; claims: TokenClaims } | { ok: false; reason: 'expired' | 'invalid' }> }   // asíncrono: jose firma y verifica con Promise
interface RandomToken { next(): string }   // 32 bytes aleatorios en base64url; doble determinista en pruebas
const RANDOM_TOKEN: symbol
interface OrgProvisioner { provision(orgId: OrgId): Promise<void> }
const ORGANIZATION_REPOSITORY, USER_REPOSITORY, SESSION_REPOSITORY, PASSWORD_HASHER, TOKEN_ISSUER, ORG_PROVISIONER: symbols

class CreateOrganization { execute(input: { name; slug; owner: { email; name; password } }, traceId: TraceId): Promise<{ organization: Organization; owner: User }> }
class Authenticate { execute(input: { email; password; slug?: string }): Promise<{ accessToken: string; refreshToken: string; user: User }> }
```
`CreateOrganization` recibe `traceId` (no hay `RequestContext`: aún no existe organización). Refresh token: 32 bytes aleatorios en base64url (`IdGenerator` no sirve: debe ser impredecible; se inyecta `RandomToken` como puerto mínimo `{ next(): string }` con doble determinista). Su hash SHA-256 hex va a `SessionRepository.create` con `expiresAt = clock.now() + JWT_REFRESH_TTL`.

- [ ] **Step 1: Pruebas** (`create-organization.spec.ts`, `authenticate.spec.ts`) con `FixedClock('2026-09-06T10:00:00Z')`:
  - crea organización y owner con `roles = {OWNER}` y contraseña hasheada; `RecordingOrgProvisioner.calls` = `[orgId]` y ocurre **antes** del evento `organization.created` (el publisher en memoria registra orden); slug repetido → `SlugTakenError`; slug inválido → `InvalidSlugError`; correo inválido → `InvalidEmailError`.
  - login correcto devuelve `accessToken` del `FakeTokenIssuer` (`"access:<userId>"`), `refreshToken` y sesión guardada con `expiresAt` = ahora + 30 d; contraseña errónea, correo inexistente y usuario inactivo → `InvalidCredentialsError` (los tres); mismo correo en dos organizaciones con la contraseña válida en ambas → `AmbiguousLoginError`; con `slug` → resuelve; con `slug` de una organización donde el correo no existe → `InvalidCredentialsError`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implementar.** `Authenticate`: `candidates = await users.findByEmailGlobal(email)`; filtra `active`; si hay `slug`, filtra por `organizations.findBySlug`; verifica la contraseña de **todos** los candidatos (tiempo constante frente a enumeración); 0 válidos → `InvalidCredentialsError`; >1 → `AmbiguousLoginError`; 1 → emite tokens. `CreateOrganization`: valida `Slug`/`Email`, `findBySlug` → `SlugTakenError`, `Organization.create`, `User.create` con `passwordHash`, `save` ambos, `provisioner.provision(orgId)`, `publish([organization.created])`.
- [ ] **Step 4: Run** → PASS. Cobertura de `libs/tenancy/src/application` ≥ 90 % (`pnpm test:cov`).
- [ ] **Step 5: Commit** `feat(tenancy): casos de uso de registro y autenticación con puertos y dobles`

---

### Task 8: Adaptadores — repositorios Kysely, Argon2, JWT y publicador de outbox

**Files:**
- Create: `libs/persistence/src/repositories/{organization.repository.ts, user.repository.ts, session.repository.ts}`, `libs/persistence/src/outbox/outbox-event-publisher.ts`, `libs/tenancy/src/infrastructure/{argon2-password-hasher.ts, jose-token-issuer.ts, random-token.ts}` (+ specs), `libs/tenancy/src/tenancy.module.ts`, `libs/persistence/test/repositories/user.repository.int-spec.ts`, `libs/persistence/test/schema/rls.int-spec.ts`
- Modify: `libs/persistence/src/persistence.module.ts`, `libs/persistence/src/index.ts`

**Interfaces:**
- Produces: `KyselyOrganizationRepository`, `KyselyUserRepository` (mapea fila + roles → `User`, `User` → fila; `save` = `update` con `expectedVersion` y `RecordNotFoundError` → `create`, como en [08 §7](docs/specs/08-acceso-a-datos.md); `UniqueViolationError('app_user_org_id_email_key')` → `EmailTakenError`), `KyselySessionRepository`, `KyselyOutboxEventPublisher` (`create` una fila por evento con `traceId`, `payload = data`), `Argon2PasswordHasher`, `JoseTokenIssuer` (HS256, `sub`, `org`, `roles`, `exp` por `JWT_ACCESS_TTL`; `verify` devuelve `expired` ante `errors.JWTExpired`), `CryptoRandomToken`. `TenancyModule` provee casos de uso y adaptadores técnicos; **no** provee repositorios (los enlaza `app.module.ts` desde `PersistenceModule`).

- [ ] **Step 1: Pruebas**
  - `jose-token-issuer.spec.ts` con `FixedClock`: emite y verifica; `exp` = ahora + 15 min; token con `exp` pasado → `{ ok: false, reason: 'expired' }`; firma con otro secreto → `'invalid'`; basura → `'invalid'`.
  - `argon2-password-hasher.spec.ts`: `verify(plain, hash)` true; otra contraseña false.
  - `user.repository.int-spec.ts` (`withRollback`): `save` nuevo + `findById` devuelve roles; `save` con `version` vieja → `VersionConflictError`; **`findByEmailGlobal` con el pool de sistema encuentra el mismo correo en dos organizaciones; con el pool de tenant y sin `app.current_org` la consulta falla** ([10 §10](docs/specs/10-tenancy.md)).
  - `rls.int-spec.ts`: para `app_user`, `user_role`, `refresh_token`, `outbox_event`: filas de orgA y orgB insertadas con el pool de sistema (en la misma transacción revertida no sirve: usar dos `runAs` reales y borrar en `afterEach` con el pool de sistema); con `runAs({pool:'tenant', orgId: orgB})` un `selectAll()` **sin filtro** devuelve solo filas de B, y un `insert` con `org_id = A` falla con `42501`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implementar.** `JoseTokenIssuer`:
```ts
issueAccess(user) { return new SignJWT({ org: user.orgId, roles: [...user.roles] }).setProtectedHeader({ alg: 'HS256' })
  .setSubject(user.id).setIssuedAt(Math.floor(this.clock.now().getTime() / 1000)).setExpirationTime(this.ttl).sign(this.key); }
```
`verify`: `jwtVerify(token, key, { algorithms: ['HS256'], currentDate: clock.now() })`; `catch (e) { return { ok: false, reason: e instanceof errors.JWTExpired ? 'expired' : 'invalid' } }`.
- [ ] **Step 4: Run** `pnpm test libs/tenancy && pnpm test:e2e libs/persistence` → PASS.
- [ ] **Step 5: Commit** `feat: repositorios Kysely de tenancy, Argon2, JWT con jose y publicador de outbox`

---

### Task 9: El borde — traza, guard, transacción, identidad, errores y validación

**Files:**
- Create: `apps/tubodega/src/http/context/{request-store.ts, trace-id.hook.ts, ctx.decorator.ts}`, `apps/tubodega/src/http/auth/{public.decorator.ts, auth.guard.ts}`, `apps/tubodega/src/http/tx/transaction.interceptor.ts`, `apps/tubodega/src/http/identity/identity.interceptor.ts`, `apps/tubodega/src/http/problem/{problem-details.ts, domain-error.filter.ts, validation.pipe.ts}`, `apps/tubodega/src/app.setup.ts`, `apps/tubodega/test/edge/pipeline.int-spec.ts`, `test/support/e2e/{app.ts, http.ts, problem.ts}`
- Modify: `apps/tubodega/src/main.ts`, `apps/tubodega/src/app.module.ts`
- Delete: `apps/tubodega/src/app.controller.ts`, `app.controller.spec.ts`, `app.service.ts`, `apps/tubodega/test/app.e2e-spec.ts`

**Interfaces (produces):**
```ts
// request-store.ts — AsyncLocalStorage por petición
interface RequestStore { traceId: TraceId; claims?: TokenClaims; ctx?: RequestContext; isPublic: boolean }
class RequestStore { enter(s): void; get(): RequestStore /* lanza si no hay */ }
// trace-id.hook.ts — onRequest de Fastify: X-Request-Id válido o v7; reply.header('X-Request-Id', …); store.enter(...)
// @Public() — SetMetadata('public', true)
// AuthGuard — lee Bearer; TokenIssuer.verify; expired → TokenExpiredError; invalid/ausente → InvalidCredentialsError; guarda claims
// TransactionInterceptor — runAs(isPublic ? {pool:'system'} : {pool:'tenant', orgId: claims.org}, () => lastValueFrom(next.handle()), { readOnly: method ∈ {GET,HEAD} })
// IdentityInterceptor — si !isPublic: users.findById(claims.org, claims.sub); null o !active → InvalidCredentialsError; store.ctx = { orgId, userId, roles: user.roles, traceId }
// @Ctx() — param decorator: store.get().ctx
// problem-details.ts — toProblem(err: DomainError, instance, traceId): ProblemDetails; ERROR_BASE = 'https://tubodega.app/errors/'
// DomainErrorFilter (@Catch()) — DomainError → problem; VersionConflictError → 409 stale-version; HttpException → problem con type 'http-<status>'; resto → 500 'internal' + log
// ValidationFailedError extends DomainError (400 'validation-failed', errors[{pointer:'/campo', code}])
// buildValidationPipe(): ValidationPipe({ whitelist: true, forbidNonWhitelisted: false, transform: true, exceptionFactory: … })
// app.setup.ts — configureApp(app: NestFastifyApplication): registra prefijo 'v1', hook de traza, pipe, filtro, OpenAPI (tarea 10). Lo usan main.ts y las pruebas.
```
Orden en `app.module.ts`: `APP_GUARD: AuthGuard`, `APP_INTERCEPTOR: TransactionInterceptor`, `APP_INTERCEPTOR: IdentityInterceptor` (en ese orden de declaración), `APP_FILTER: DomainErrorFilter`.

- [ ] **Step 1: Pruebas del borde** (`pipeline.int-spec.ts`, app real con `Test.createTestingModule({ imports: [AppModule] })` más un `ProbeController` registrado solo en la prueba, con `GET /v1/_probe/org` que lee `current_setting('app.current_org', true)` vía `TransactionContext` y `POST /v1/_probe/insert` que hace un `INSERT` en `outbox_event`):
  - con token válido (emitido con `JoseTokenIssuer` del módulo para un usuario creado con `CreateOrganization` del módulo, en `beforeAll`), `_probe/org` devuelve el `org` del token (T-5);
  - `GET` que escribe → `500 internal` en respuesta y `25006` en el log (READ ONLY);
  - sin `Authorization` → `401 invalid-credentials` con `problem+json` completo y `traceId`; token expirado → `401 token-expired`;
  - `X-Request-Id: req-123` → respuesta con UUID nuevo; `X-Request-Id: <uuid>` → el mismo;
  - usuario desactivado (`UPDATE app_user SET active=false` con el pool de sistema en la prueba) con token vigente → `401 invalid-credentials` (T-6);
  - **orden equivocado**: un módulo de prueba que registra `IdentityInterceptor` antes que `TransactionInterceptor` responde `500` (el DAO lanza `NoActiveTransactionError`): el orden en `app.module.ts` no es cosmético.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implementar.** Fragmentos clave:

```ts
// trace-id.hook.ts
export function registerTraceIdHook(fastify: FastifyInstance, store: RequestStore, ids: IdGenerator) {
  fastify.addHook('onRequest', (req, reply, done) => {
    const given = req.headers['x-request-id'];
    const traceId = (typeof given === 'string' && isUuid(given) ? given : ids.next()) as TraceId;
    reply.header('X-Request-Id', traceId);
    store.enter({ traceId, isPublic: false });   // AsyncLocalStorage.enterWith
    done();
  });
}
// transaction.interceptor.ts
intercept(context: ExecutionContext, next: CallHandler) {
  const s = this.store.get();
  const req = context.switchToHttp().getRequest<FastifyRequest>();
  const readOnly = req.method === 'GET' || req.method === 'HEAD';
  const scope: TxScope = s.isPublic ? { pool: 'system' } : { pool: 'tenant', orgId: s.claims!.org };
  return from(this.uow.runAs(scope, () => lastValueFrom(next.handle()), { readOnly }));
}
// domain-error.filter.ts (Fastify)
catch(exception: unknown, host: ArgumentsHost) {
  const reply = host.switchToHttp().getResponse<FastifyReply>();
  const req = host.switchToHttp().getRequest<FastifyRequest>();
  const traceId = this.store.tryGet()?.traceId ?? (reply.getHeader('X-Request-Id') as string);
  const problem = this.toProblem(exception, req.url, traceId);
  if (problem.status >= 500) this.logger.error({ traceId, err: exception });
  reply.status(problem.status).header('Content-Type', 'application/problem+json').send(problem);
}
```
`ProbeController` y su módulo viven en `apps/tubodega/test/edge/probe.module.ts`, nunca en `src/`.

- [ ] **Step 4: Run** `pnpm test:e2e apps/tubodega/test/edge` → PASS.
- [ ] **Step 5: Commit** `feat(http): traza, guard JWT, transacción con RLS, identidad, problem+json y validación`

---

### Task 10: Endpoints — `POST /v1/organizations`, `POST /v1/auth/login`, `GET /v1/me`, OpenAPI

**Files:**
- Create: `apps/tubodega/src/http/tenancy/{organizations.controller.ts, auth.controller.ts, me.controller.ts, dto.ts}`, `apps/tubodega/src/adapters/tenancy/org-provisioner.adapter.ts`, `apps/tubodega/src/http/openapi/openapi.ts`
- Modify: `apps/tubodega/src/app.module.ts`, `apps/tubodega/src/app.setup.ts`, `apps/tubodega/src/main.ts`

**Interfaces:**
- `CreateOrganizationDto { name: string (1-120); slug: string; owner: { email: string; name: string (1-120); password: string (≥ 10) } }` con `class-validator` y `@ApiProperty({ example })` en cada campo.
- `LoginDto { email; password; slug?: string }`.
- Respuestas: `201 { organization: { id, name, slug, createdAt }, owner: { id, email, name, roles } }` + `Location: /v1/organizations/{id}`; `200 { accessToken, refreshToken, expiresIn: 900, user: {…} }`; `GET /v1/me` → `200 { user: { id, email, name, roles }, organization: { id, name, slug } }`.
- `CompositeOrgProvisioner implements OrgProvisioner` con `constructor(private readonly seeders: readonly OrgSeeder[])` donde `interface OrgSeeder { seed(orgId: OrgId): Promise<void> }`; en este plan `seeders = []` (D-2). Está registrado y probado (`provision()` resuelve) para que los planes 3, 8 y 9 solo añadan elementos.
- OpenAPI: `SwaggerModule.createDocument` con `DocumentBuilder().setTitle('tubodega').setVersion('1').addBearerAuth()`; servido en `GET /v1/openapi.json` (`SwaggerModule.setup('v1/docs', app, doc, { jsonDocumentUrl: 'v1/openapi.json' })`). Cada endpoint declara `@ApiResponse` para `400`, `401`, `409` según aplique, con el esquema `ProblemDetails`.

- [ ] **Step 1: Escribir la prueba e2e (tarea 11) primero**; esta tarea la hace pasar.
- [ ] **Step 2: Controllers.** `OrganizationsController` (`@Public()`): `execute(dto, store.get().traceId)`, `reply.header('Location', …)`, `201`. `AuthController` (`@Public()`). `MeController`: `@Get('me')` con `@Ctx() ctx` → `users.findById(ctx.orgId, ctx.userId)` y `organizations.findById(ctx.orgId)`.
- [ ] **Step 3: `app.module.ts`** — enlaza `ORGANIZATION_REPOSITORY → KyselyOrganizationRepository`, `USER_REPOSITORY → KyselyUserRepository`, `SESSION_REPOSITORY → KyselySessionRepository`, `EVENT_PUBLISHER → KyselyOutboxEventPublisher`, `PASSWORD_HASHER`, `TOKEN_ISSUER`, `RANDOM_TOKEN`, `ORG_PROVISIONER → CompositeOrgProvisioner([])`, `CLOCK → SystemClock`, `ID_GENERATOR → Uuidv7Generator`.
- [ ] **Step 4: `main.ts`** — `NestFactory.create(AppModule, new FastifyAdapter())`, `await configureApp(app)`, `listen(port, '0.0.0.0')`.
- [ ] **Step 5: Prueba manual**

```bash
pnpm start:dev &
curl -s -i -X POST localhost:3000/v1/organizations -H 'content-type: application/json' \
  -d '{"name":"Distribuidora La Esquina","slug":"la-esquina","owner":{"email":"marta@esquina.co","name":"Marta","password":"correcthorse1"}}'
# → 201, Location, X-Request-Id
TOKEN=$(curl -s -X POST localhost:3000/v1/auth/login -H 'content-type: application/json' \
  -d '{"email":"marta@esquina.co","password":"correcthorse1"}' | jq -r .accessToken)
curl -s localhost:3000/v1/me -H "authorization: Bearer $TOKEN" | jq
curl -s -i localhost:3000/v1/me                       # 401 problem+json
curl -s localhost:3000/v1/openapi.json | jq '.paths | keys'
```
- [ ] **Step 6: Commit** `feat(http): registro de organización, login, /me y OpenAPI`

---

### Task 11: Prueba e2e del Plan 1 y cierre

**Files:**
- Create: `apps/tubodega/test/e2e/p1-registro-y-login.e2e-spec.ts`, `test/support/e2e/tenant.ts`
- Modify: `README.md` (comandos: `docker compose up -d db`, `.env`, `pnpm db:migrate`, `pnpm start:dev`, los tres `curl`)

**Interfaces (produces):** `startTestApp()`, `TestHttp` (`get/post` sobre `app.inject`, `idem` ignorado en este plan pero ya en la firma), `registerOrg(http, { slug? })` con slug aleatorio → `{ slug, owner: Session }`, `login(http, email, password, slug?)`, `expiredToken(session)` (firma con `JWT_SECRET` de `.env.test` y `exp` pasado usando `jose`, sin tocar la base), `expectProblem(res, { status, type, pointer? })`.

- [ ] **Step 1: La suite** (solo API pública):

| # | Caso | Afirmaciones |
|---|---|---|
| 1 | Marta registra «Distribuidora La Esquina» | `201`; `Location` = `/v1/organizations/<id>`; `owner.roles = ['OWNER']`; `X-Request-Id` es UUID |
| 2 | Mismo slug otra vez | `409 slug-taken`, `problem+json` con `type`, `title`, `status`, `detail`, `instance = '/v1/organizations'`, `traceId` = `X-Request-Id` |
| 3 | Cuerpo inválido (`slug: 'La Esquina'`, sin `owner.password`) | `400 validation-failed`; `errors[]` contiene `pointer: '/owner/password'` y `'/slug'` |
| 4 | Un `orgId` colado en el cuerpo | `201`; la respuesta no lo refleja y el registro es otra organización (T-4: se ignora) |
| 5 | Login correcto | `200`; `accessToken`, `refreshToken`, `user.email = 'marta@esquina.co'` (minúsculas aunque se envíe `Marta@Esquina.co`) |
| 6 | Login con contraseña errónea / correo inexistente | `401 invalid-credentials` ambos, misma forma |
| 7 | `/me` con token | `200`; `user.roles = ['OWNER']`; `organization.slug` |
| 8 | `/me` sin token; con `Bearer basura`; con `expiredToken()` | `401 invalid-credentials`; `401 invalid-credentials`; `401 token-expired` |
| 9 | Traza | `GET /v1/me` con `X-Request-Id: req-123` → respuesta con UUID distinto; con un UUID v4 dado → el mismo |
| 10 | El mismo correo en dos empresas | segunda `registerOrg` con el correo de Marta → `201`; login sin `slug` → `409 ambiguous-login`; con `slug` → `200` y `/me` devuelve esa organización |
| 11 | Contrato publicado | `GET /v1/openapi.json` → `200`; `paths` incluye `/v1/organizations`, `/v1/auth/login`, `/v1/me`; el esquema `ProblemDetails` existe |

- [ ] **Step 2: Run** `pnpm test:e2e apps/tubodega/test/e2e` → PASS en < 10 s.
- [ ] **Step 3: Puertas completas**

```bash
pnpm lint && pnpm typecheck && pnpm db:check && pnpm test && pnpm test:e2e
```
Expected: todo verde; `pnpm test` < 5 s; `pnpm test:e2e` < 30 s.

- [ ] **Step 4: Commit y rama**

```bash
git add -A && git commit -m "test(e2e): registro, login y /me — cierre del plan 1"
```
Rama `plan/01-primeros-endpoints`; integrar con `superpowers:finishing-a-development-branch`.

## Qué queda fuera del Plan 1 (y dónde entra)

| Pieza | Plan |
|---|---|
| `POST /v1/auth/refresh`, `logout`, `/v1/users`, `/v1/me/password`, `404` cross-org, T-6 por API | 2 |
| `Idempotency-Key` (interceptor, tabla, pool dedicado) | 2 |
| Resto del esquema (migración `0002`), pruebas de cada `CHECK`, `NULLS NOT DISTINCT`, `REVOKE` | 2 |
| DSL `where`, `findPage`, `createMany`, familia plana, type-spec de append-only, DAO contra `alert_rule` | 2 |
| Despachador de outbox, CI (`ci.yml`), snapshot OpenAPI, sembradores del `OrgProvisioner` | 2 (dispatcher, CI, snapshot) · 4/8/9 (sembradores) |

---

