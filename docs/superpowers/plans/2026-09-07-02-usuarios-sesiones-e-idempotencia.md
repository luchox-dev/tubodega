# Parte B — Plan 2: El equipo, las sesiones y la idempotencia

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cerrar la WAVE 1 del plan maestro por HTTP: administrar el equipo (`/v1/users`), rotar y cerrar sesiones (`/v1/auth/refresh`, `/v1/auth/logout`), cambiar la contraseña (`/v1/me/password`), y que todo `POST` no exento sea seguro de reintentar (`Idempotency-Key`). Al terminar, la suite narrativa `w1-abrir-el-negocio.e2e-spec.ts` ejecuta los 13 casos de la tabla «E2E WAVE 1» del plan maestro contra la API pública.

**Rama:** `plan/02-usuarios-sesiones-e-idempotencia`; al terminar, merge local a `master` con `superpowers:finishing-a-development-branch`.

---

## Context

El plan 1 (`e3c6e0b`) dejó la columna vertical completa —`common` → `persistence` → `tenancy` → borde HTTP— pero con solo tres endpoints (`POST /v1/organizations`, `POST /v1/auth/login`, `GET /v1/me`) y las piezas más pequeñas posibles de cada capa: un `AbstractOrgDao` con clave `id`, igualdad simple y bloqueo optimista, y nada de paginación, idempotencia ni despachador de outbox.

El plan 1 declara explícitamente lo que hereda el plan 2 (sección «Qué queda fuera del Plan 1»): refresh/logout/users/me-password, `Idempotency-Key`, el DSL `where`, `findPage`, la familia plana del DAO, el type-spec de append-only, el despachador de outbox, el snapshot de OpenAPI y CI.

**Desviación acordada del plan maestro (D-1):** el plan maestro colocaba la migración `0002_full_schema` (las ~20 tablas de [04 §3](docs/specs/04-persistencia.md)) en el plan 2. Se mueve al plan 3 (arranque de la WAVE 2, catálogo), porque no entrega ni un endpoint y hace el lote demasiado grande. La única tabla nueva aquí es `idempotency_key`, que sí hace falta para el borde.

**Consecuencia sobre D-1:** el DAO genérico se prueba contra `app_user` (clave `id`, `versioned`) y `user_role` (clave compuesta `{ userId, role }`) en lugar de `alert_rule`, que aún no existe. Cubre exactamente lo mismo: clave simple, clave compuesta, DSL completo, keyset y los cuatro errores.

**Resultado esperado:** `pnpm lint && pnpm typecheck && pnpm db:check && pnpm test && pnpm test:e2e` verdes, con la WAVE 1 demostrada por HTTP y sin que ninguna prueba e2e toque la base.

---

## Global Constraints (heredadas)

Las del plan maestro y del plan 1; se repiten solo las que este plan ejerce por primera vez:

- `Idempotency-Key` obligatoria en todo `POST` salvo los cuatro exentos de [07 §5](docs/specs/07-composicion-y-contexto-de-ejecucion.md). Retención 7 días; `IN_FLIGHT` de más de 5 min se toma por abandonada.
- Paginación por cursor opaco: `limit` por defecto 50, máximo 200; respuesta `{ data, page: { nextCursor, hasMore } }` ([03 §6](docs/specs/03-contrato-api.md)). Cada endpoint declara qué se puede filtrar y ordenar; lo no declarado → `400 invalid-filter` (D-10).
- `If-Match` con `version` en `PATCH`; sin cabecera → `400 missing-if-match`; versión distinta → `409 stale-version` ([03 §9](docs/specs/03-contrato-api.md)).
- `404` y nunca `403` para recursos de otra organización (I-6).
- Sufijos de archivo: `*.spec.ts` sin infraestructura (`pnpm test`); `*.int-spec.ts` / `*.e2e-spec.ts` con Postgres (`pnpm test:e2e`).
- Ninguna prueba del servidor usa `new Date()`; las e2e sí, como cliente (D-16).
- Cobertura: `libs/tenancy/src/domain` ≥ 95 %, `libs/tenancy/src/application` ≥ 90 % (ya activas en `vitest.config.ts`).

---

## Mapa de archivos del Plan 2

```
.github/workflows/ci.yml                                                   nuevo
libs/persistence/
  prisma/schema.prisma                                                     + IdempotencyKey, IdemStatus
  prisma/migrations/0002_idempotency/migration.sql                         nuevo
  src/dao/base/
    interfaces.ts  where.ts  keyset.ts  errors.ts                          nuevos (errors.ts crece)
    abstract-read.dao.ts  abstract-append.dao.ts  abstract-base.dao.ts     nuevos
    org/abstract-org-read.dao.ts  org/abstract-org-append.dao.ts
    org/abstract-org.dao.ts                                                nuevos (reemplazan base/abstract-org.dao.ts)
  src/dao/idempotency-key.dao.ts                                           nuevo
  src/dao/{organization,user,user-role,refresh-token,outbox-event}.dao.ts  migrados a la jerarquía
  src/repositories/user.repository.ts                                      + listPage
  src/outbox/outbox-dispatcher.ts                                          nuevo (claim + markPublished)
  test/dao/{where.spec.ts, generic.int-spec.ts, org-generic.int-spec.ts,
            append-only.type-spec.ts, idempotency-key.int-spec.ts}         nuevos
  test/outbox/dispatcher.int-spec.ts                                       nuevo
libs/tenancy/src/
  application/use-cases/{refresh-session.ts, logout.ts, change-password.ts,
                         create-user.ts, list-users.ts, get-user.ts,
                         update-user-roles.ts, deactivate-user.ts}         nuevos (+ *.spec.ts)
  application/ports/user.repository.ts                                     + listPage
  domain/errors.ts                                                         + RefreshTokenInvalidError, UserNotFoundError
apps/tubodega/src/
  http/pipeline/{idempotency.interceptor.ts, idempotency.store.ts,
                 canonical-hash.ts, idempotency-exempt.decorator.ts}       nuevos (+ canonical-hash.spec.ts)
  http/shared/{cursor-query.ts, if-match.ts}                               nuevos (+ *.spec.ts)
  http/users/{users.controller.ts, users.dto.ts}                           nuevos
  http/auth/{auth.controller.ts, auth.dto.ts}                              + refresh, logout
  http/me/{me.controller.ts, me.dto.ts}                                    + POST /me/password
  jobs/outbox-dispatcher.job.ts                                            nuevo
  openapi.json                                                             snapshot versionado
  test/edge/{idempotency.int-spec.ts, openapi.int-spec.ts}                 nuevos
  test/e2e/w1-abrir-el-negocio.e2e-spec.ts                                 nuevo (absorbe p1-registro-y-login)
test/support/e2e/tenant.ts                                                 + Tenant.user(role, name)
README.md · docs/postman/tubodega.postman_collection.json                  actualizados
```

---

### Task 0: Rama y documento del plan

- [ ] `git checkout -b plan/02-usuarios-sesiones-e-idempotencia`
- [ ] Copiar este plan a `docs/superpowers/plans/2026-09-07-02-usuarios-sesiones-e-idempotencia.md` (misma convención que el plan 1, que vive versionado).
- [ ] Commit `docs(plan-2): plan de usuarios, sesiones e idempotencia`

---

### Task 1: Migración `0002_idempotency`, variables nuevas y CI

**Files:**
- Create: `libs/persistence/prisma/migrations/0002_idempotency/migration.sql`, `.github/workflows/ci.yml`
- Modify: `libs/persistence/prisma/schema.prisma`, `libs/common/src/config/env.validation.ts`, `.env.example`, `.env.test`, `package.json`

**Interfaces (produce):** tabla `idempotency_key` de [04 §3.8](docs/specs/04-persistencia.md) con clave primaria `(org_id, key)`; variable `OUTBOX_INTERVAL_MS` (default 1000).

- [ ] **Step 1: `schema.prisma`**

```prisma
enum IdemStatus { IN_FLIGHT  COMPLETED  @@map("idem_status_enum") }

model IdempotencyKey {
  orgId        String     @map("org_id") @db.Uuid
  key          String     @db.VarChar(128)
  requestHash  String     @map("request_hash") @db.VarChar(64)
  status       IdemStatus
  responseCode Int?       @map("response_code")
  responseBody Json?      @map("response_body")
  createdAt    DateTime   @default(now()) @map("created_at") @db.Timestamptz
  expiresAt    DateTime   @map("expires_at") @db.Timestamptz

  @@id([orgId, key])
  @@index([expiresAt])
  @@map("idempotency_key")
}
```
Sin FK a `organization`: la reserva ocurre en una transacción aparte (D-9) y no debe depender del orden de confirmación de la petición.

- [ ] **Step 2: `pnpm db:migrate --name idempotency`** y añadir a mano al final del `migration.sql` generado el bloque de RLS, copiando el `DO $$ … $$` de `0001`:

```sql
ALTER TABLE "idempotency_key" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "idempotency_key" FORCE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON "idempotency_key"
  USING      (org_id = current_setting('app.current_org')::uuid)
  WITH CHECK (org_id = current_setting('app.current_org')::uuid);
```
No hacen falta `GRANT`: el `ALTER DEFAULT PRIVILEGES FOR ROLE tubodega_migrator` de `0001` ya cubre las tablas nuevas. Verificarlo en el Step 5.

- [ ] **Step 3: `OUTBOX_INTERVAL_MS`** en `env.validation.ts` (entero ≥ 100, default 1000) con su caso en `env.validation.spec.ts`; añadirla a `.env.example` y `.env.test`. Instalar `pnpm add @nestjs/schedule` (Task 9).
- [ ] **Step 4: `.github/workflows/ci.yml`** — servicio `postgres:16-alpine`, un paso `psql -h localhost -U postgres -f db/init/01-roles.sql` (los servicios de GitHub Actions no montan `docker-entrypoint-initdb.d`), y las cinco puertas: `pnpm lint`, `pnpm typecheck`, `pnpm db:check`, `pnpm test`, `pnpm test:e2e`.
- [ ] **Step 5: Verificar**

```bash
pnpm db:migrate && pnpm db:generate && pnpm db:check   # sale 0
psql "$DATABASE_URL" -c '\d idempotency_key'            # con el rol tubodega_app: existe y es legible
```
- [ ] **Step 6: Commit** `feat(persistence): tabla idempotency_key con RLS, OUTBOX_INTERVAL_MS y workflow de CI`

---

### Task 2: La jerarquía DAO plana — interfaces, DSL `where`, keyset y errores

**Files:**
- Create: `libs/persistence/src/dao/base/{interfaces.ts, where.ts, keyset.ts, abstract-read.dao.ts, abstract-append.dao.ts, abstract-base.dao.ts}`, `libs/persistence/test/dao/where.spec.ts`
- Modify: `libs/persistence/src/dao/base/errors.ts`

**Interfaces (produce):** exactamente las de [08 §4-§5](docs/specs/08-acceso-a-datos.md).

```ts
// interfaces.ts
type Cols<T> = readonly (keyof T & string)[];
type OrderBy<T> = { [K in keyof T]?: 'asc' | 'desc' };
interface FindArgs<T>     { where?: WhereInput<T>; orderBy?: OrderBy<T>; select?: Cols<T> }
interface FindManyArgs<T> extends FindArgs<T> { take?: number; skip?: number }
interface FindPageArgs<T> { where?: WhereInput<T>; orderBy?: OrderBy<T>; take: number; cursor?: Cursor }

interface IReadDao<E, T> {
  findUnique(id: E): Promise<T | null>;
  findUnique<K extends keyof T & string>(id: E, opts: { select: readonly K[] }): Promise<Pick<T, K> | null>;
  findUniqueOrThrow(id: E): Promise<T>;              // RecordNotFoundError
  findManyByIds(ids: readonly E[]): Promise<T[]>;    // IN, o IN sobre tuplas si E es compuesta
  findFirst(args?: FindArgs<T>): Promise<T | null>;
  findMany(args?: FindManyArgs<T>): Promise<T[]>;
  findPage(args: FindPageArgs<T>): Promise<Page<T>>;
  count(where?: WhereInput<T>): Promise<number>;
  exists(where?: WhereInput<T>): Promise<boolean>;
}
interface IAppendDao<E, T> extends IReadDao<E, T> {
  create(data: New<T>): Promise<T>;
  createMany(data: readonly New<T>[]): Promise<T[]>;   // un INSERT multi-fila, en lotes de 1000
}
interface IBaseDao<E, T> extends IAppendDao<E, T> {
  update(id: E, data: Patch<T>, opts?: { expectedVersion?: number }): Promise<T>;
  updateMany(where: WhereInput<T>, data: Patch<T>): Promise<number>;
  upsert(id: E, create: New<T>, update: Patch<T>): Promise<T>;   // ON CONFLICT (idColumns)
  delete(id: E): Promise<T>;
  deleteMany(where: WhereInput<T>): Promise<number>;
}
```

Las clases abstractas reciben el nombre literal de la tabla —`AbstractBaseDao<'appUser', string>`— y declaran tres propiedades: `table`, `idColumns` (default `['id']`) y `versioned` (default `false`). Como en el `AbstractOrgDao` actual, los builders de Kysely se ensanchan a `any` dentro de la base y se estrechan al devolver; las concreciones conservan tipado completo en sus propios métodos.

- [ ] **Step 1: `where.spec.ts`** (sin base: se compila con `new Kysely({ dialect: new PostgresDialect({ pool: new pg.Pool() }) })`, que nunca conecta, y se afirma sobre `.compile().sql` y `.parameters`). Un caso por fila de la tabla de [08 §5](docs/specs/08-acceso-a-datos.md):

| Entrada | SQL esperado |
|---|---|
| `{ active: true }` | `"active" = $1` |
| `{ revokedAt: null }` | `"revoked_at" is null` |
| `{ resolvedAt: { not: null } }` | `"resolved_at" is not null` |
| `{ role: { in: ['OWNER','ADMIN'] } }` | `"role" in ($1, $2)` |
| `{ role: { in: [] } }` | `false` — no un error de sintaxis |
| `{ expiresAt: { lt: d } }` | `"expires_at" < $1` |
| `{ name: { contains: 'mart', mode: 'insensitive' } }` | `"name" ilike $1` con parámetro `%mart%` |
| `{ name: { contains: '50%_x' } }` | parámetro `%50\%\_x%` — `%` y `_` escapados |
| `{ OR: [{ email: 'a' }, { name: { startsWith: 'B' } }] }` | `("email" = $1 or "name" like $2)` |
| `{ NOT: { active: true } }` | `not ("active" = $1)` |
| `{ active: true, name: 'x' }` | claves de un objeto combinadas con `and` |
| callback `(eb) => eb.exists(...)` | se inserta tal cual; mezclable dentro de `AND`/`OR` |

- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implementar `where.ts`** — `compileWhere(eb, where): Expression<SqlBool>`, puro y recursivo. `escapeLike(v)` escapa `\`, `%` y `_` y la consulta añade `ESCAPE '\'`.
- [ ] **Step 4: `keyset.ts`** — `applyKeyset(q, { orderBy, idColumns, take, cursor })`:
  - orden efectivo = `[columna de orderBy (una sola), ...idColumns]`, con la misma dirección; sin `orderBy` el orden es solo `idColumns` ascendente.
  - con `cursor`: `decodeCursor` → tupla `[valorDeOrden, ...valoresDeClave]`; se emite la comparación de fila `(col, id…) > ($1, $2…)` (o `<` si `desc`). Cursor ilegible o de aridad distinta → `InvalidCursorError` (error de persistencia; el borde lo traduce a `400 invalid-filter`).
  - se pide `take + 1` filas: si vuelven `take + 1`, `hasMore = true`, se descarta la última y `nextCursor = encodeCursor(partes de la última fila devuelta)`.
- [ ] **Step 5: `errors.ts`** — añadir `CheckViolationError(constraint)` (`23514`), `ForeignKeyViolationError(constraint)` (`23503`) e `InvalidCursorError`; `translatePgError` los emite.
- [ ] **Step 6: `abstract-read.dao.ts` → `abstract-append.dao.ts` → `abstract-base.dao.ts`.** `update` conserva la semántica actual (bump de `version`/`updated_at` si `versioned`; cero filas → segunda lectura → `RecordNotFoundError` o `VersionConflictError`). `createMany` trocea en lotes de 1000. `upsert` es `ON CONFLICT (idColumns) DO UPDATE`.
- [ ] **Step 7: Run** `pnpm test libs/persistence` → PASS.
- [ ] **Step 8: Commit** `feat(persistence): jerarquía DAO plana con DSL where, keyset y errores de pg`

---

### Task 3: La familia Org por composición y la migración de los DAOs existentes

**Files:**
- Create: `libs/persistence/src/dao/base/org/{abstract-org-read.dao.ts, abstract-org-append.dao.ts, abstract-org.dao.ts}`, `libs/persistence/test/dao/{generic.int-spec.ts, org-generic.int-spec.ts, append-only.type-spec.ts}`
- Modify: `libs/persistence/src/dao/{organization,user,user-role,refresh-token,outbox-event}.dao.ts`, `libs/persistence/src/index.ts`, `libs/persistence/test/dao/org-dao.int-spec.ts`
- Delete: `libs/persistence/src/dao/base/abstract-org.dao.ts` (el mínimo del plan 1)

**Interfaces (produce):** `IOrgReadDao` / `IOrgAppendDao` / `IOrgDao`, idénticas a las planas con `orgId: OrgId` como primer parámetro. Implementación **por composición** ([08 §3](docs/specs/08-acceso-a-datos.md)): la clase Org envuelve un DAO plano privado cuya clave es `E & { orgId }` y fusiona `{ orgId }` en cada `where` y cada `create`. Nada en la familia Org puede cruzar organizaciones: quien lo necesite escribe un método concreto (`findByEmailGlobal`, `findByHashGlobal`, el despachador).

Reasignación de cada tabla existente:

| DAO | Base | `E` |
|---|---|---|
| `OrganizationDao` | `AbstractBaseDao<'organization', string>` | `string` — sin `org_id`, fuera de la familia Org |
| `UserDao` | `AbstractOrgDao<'appUser', string>` (`versioned`) | `string` |
| `RefreshTokenDao` | `AbstractOrgDao<'refreshToken', string>` | `string` |
| `UserRoleDao` | `AbstractOrgDao<'userRole', { userId: string; role: Role }>` | compuesta |
| `OutboxEventDao` | `AbstractOrgAppendDao<'outboxEvent', string>` | `string` |

`OrganizationDao` pierde sus métodos escritos a mano (`insert`, `update`) y conserva solo `findBySlug` como método concreto: el resto lo da la base. `KyselyOrganizationRepository` se ajusta a `create`/`update`.

- [ ] **Step 1: Pruebas**
  - `generic.int-spec.ts` (contra `app_user`, dentro de `withRollback`): cada método del contrato; `findUnique` con `select` devuelve solo esas columnas; `findManyByIds`; `count`/`exists`; `createMany` de 3 filas devuelve 3; `update` con `expectedVersion` errónea → `VersionConflictError`, con id inexistente → `RecordNotFoundError`; `upsert` crea y luego actualiza; `delete` devuelve la fila; `23505` → `UniqueViolationError` con `constraint = 'app_user_org_id_email_key'`; el DAO invocado fuera de `run()` → `NoActiveTransactionError`.
  - `findPage` **tres páginas con inserciones entre medias**: 12 usuarios, `take: 5`, `orderBy: { name: 'asc' }`; entre la página 1 y la 2 se insertan dos usuarios con nombres que caen en tramos ya recorridos y en tramos futuros; el recorrido completo no repite ni salta ninguno de los originales.
  - `org-generic.int-spec.ts` (contra `user_role`, clave compuesta `{ userId, role }`): `findUnique({ userId, role })`; `findManyByIds` con dos tuplas; `create`; `delete`; y **la prueba de aislamiento**: con `runAs({ pool: 'tenant', orgId: orgB })`, `findMany(orgA)` devuelve `[]` — el `orgId` explícito y RLS son dos filtros, no uno.
  - `append-only.type-spec.ts`: `expectTypeOf<OutboxEventDao>().not.toHaveProperty('update')` (ídem `upsert`, `delete`, `updateMany`, `deleteMany`). No lo ejecuta vitest (no acaba en `.spec.ts`); lo comprueba `pnpm typecheck`, que ya incluye `libs/**/*.ts`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implementar** la familia Org y migrar los cinco DAOs. `UserDao.findByEmailGlobal`, `RefreshTokenDao.findByHashGlobal` y `RefreshTokenDao.revoke` siguen siendo métodos concretos escritos con Kysely.
- [ ] **Step 4: Run** `pnpm test:e2e libs/persistence && pnpm typecheck` → PASS. Los `int-spec` del plan 1 (`user.repository`, `rls`, `unit-of-work`) siguen verdes sin tocarse.
- [ ] **Step 5: Commit** `refactor(persistence): familia Org por composición y DAOs sobre la jerarquía completa`

---

### Task 4: `IdempotencyKeyDao`, hash canónico y el almacén

**Files:**
- Create: `libs/persistence/src/dao/idempotency-key.dao.ts`, `libs/persistence/test/dao/idempotency-key.int-spec.ts`, `apps/tubodega/src/http/pipeline/{canonical-hash.ts, canonical-hash.spec.ts, idempotency.store.ts}`
- Modify: `libs/persistence/src/{index.ts, persistence.module.ts, models/index.ts}`

**Interfaces (produce):**

```ts
// libs/persistence — IdempotencyKeyDao extends AbstractOrgDao<'idempotencyKey', { key: string }>
type Reservation =
  | { outcome: 'reserved' }
  | { outcome: 'in-flight'; since: Date }
  | { outcome: 'completed'; requestHash: string; responseCode: number; responseBody: unknown };

class IdempotencyKeyDao {
  reserve(orgId, key, requestHash, now: Date, expiresAt: Date): Promise<Reservation>;
  // INSERT … ON CONFLICT DO NOTHING RETURNING *; si no devolvió fila, relee por clave.
  takeOverAbandoned(orgId, key, requestHash, now: Date, before: Date): Promise<boolean>;
  // UPDATE … SET request_hash, created_at = now WHERE status = 'IN_FLIGHT' AND created_at < before
  complete(orgId, key, responseCode: number, responseBody: unknown): Promise<void>;   // tx ambiental
  release(orgId, key): Promise<void>;                                                  // DELETE
}

// apps — canonical-hash.ts
function canonicalHash(body: unknown): string;   // SHA-256 hex del JSON con claves ordenadas y sin espacios

// apps — idempotency.store.ts (envuelve el DAO y decide en qué transacción va cada paso)
class IdempotencyStore {
  reserve(orgId, key, hash): Promise<Reservation>;   // A y el rescate de abandonadas: uow.runDetached (D-9)
  complete(orgId, key, code, body): Promise<void>;   // B: transacción ambiental de la petición
  release(orgId, key): Promise<void>;                // C: uow.runDetached
}
```

- [ ] **Step 1: Pruebas**
  - `canonical-hash.spec.ts`: el mismo objeto con las claves en otro orden da el mismo hash; anidamiento y arrays (el orden de un array **sí** cuenta); `undefined` se descarta y `null` no; dos cuerpos distintos dan hashes distintos; un `Buffer` (multipart) se hashea por bytes.
  - `idempotency-key.int-spec.ts`: `reserve` sobre clave libre → `reserved`; repetir con el mismo hash mientras está `IN_FLIGHT` → `in-flight` con su `since`; tras `complete` → `completed` con código y cuerpo; `takeOverAbandoned` con `before = now - 5 min` devuelve `false` sobre una fila recién creada y `true` sobre una con `created_at` de hace 6 min (insertada en la prueba con el pool de sistema); `release` la borra.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implementar.** `IdempotencyStore` recibe `KyselyUnitOfWork` y el DAO; `reserve` y `release` van dentro de `runDetached({ orgId })`, que abre transacción en el pool dedicado de tamaño 2 con `SET LOCAL app.current_org` y un contexto asíncrono nuevo — sin él, dos peticiones concurrentes no se verían, y con el pool de peticiones diez `POST` simultáneos se bloquearían esperando una undécima conexión (D-9).
- [ ] **Step 4: Run** `pnpm test && pnpm test:e2e libs/persistence` → PASS.
- [ ] **Step 5: Commit** `feat(http): almacén de claves de idempotencia, hash canónico y DAO con pool dedicado`

---

### Task 5: El `IdempotencyInterceptor` (paso 5 de [07 §3](docs/specs/07-composicion-y-contexto-de-ejecucion.md))

**Files:**
- Create: `apps/tubodega/src/http/pipeline/{idempotency.interceptor.ts, idempotency-exempt.decorator.ts}`, `apps/tubodega/test/edge/idempotency.int-spec.ts`
- Modify: `apps/tubodega/src/app.module.ts` (interceptor global **después** de `IdentityInterceptor`), `apps/tubodega/test/edge/probe.module.ts` (endpoints de prueba), `apps/tubodega/src/http/pipeline/problem-details.ts` (nada nuevo: los errores son `DomainError`)

**Interfaces (produce):** errores `400 missing-idempotency-key`, `409 idempotency-key-reuse`, `409 idempotency-key-in-flight`; cabecera `Idempotency-Replayed: true` en el replay; `@IdempotencyExempt()` para `POST /v1/auth/logout` (los `@Public()` lo son implícitamente, porque no hay organización con la que indexar la tabla).

Secuencia, exactamente la de [07 §5](docs/specs/07-composicion-y-contexto-de-ejecucion.md):

```
método ≠ POST, ruta @Public() o @IdempotencyExempt()  → pasar de largo
sin cabecera Idempotency-Key                          → 400 missing-idempotency-key
hash = canonicalHash(req.body)
A. store.reserve(orgId, key, hash)
   reserved                         → seguir al handler
   completed  + hash igual          → replay: status guardado, cuerpo guardado, Idempotency-Replayed: true
   completed  + hash distinto       → 409 idempotency-key-reuse
   in-flight  + since < 5 min       → 409 idempotency-key-in-flight
   in-flight  + since ≥ 5 min       → takeOverAbandoned; si gana, seguir; si no, 409 in-flight
B. handler ok  → store.complete(orgId, key, statusCode, body)   ← transacción ambiental
C. handler falla → store.release(orgId, key)                    ← transacción propia
```

- [ ] **Step 1: Pruebas del borde** (`idempotency.int-spec.ts`, app real más un `ProbeController` con `POST /v1/_probe/slow` que espera a una promesa que la prueba resuelve, y `POST /v1/_probe/boom` que lanza):
  - **I-7 bajo concurrencia:** dos `POST /v1/_probe/slow` simultáneos con la misma clave → una `201`, la otra `409 idempotency-key-in-flight`; al terminar, un tercer intento con la misma clave devuelve el replay con el mismo cuerpo y `Idempotency-Replayed: true`.
  - misma clave con cuerpo distinto → `409 idempotency-key-reuse`.
  - fila `IN_FLIGHT` con `created_at` de hace 6 min (insertada por integración) → se re-reserva y la petición se procesa.
  - `POST /v1/_probe/boom` → `500`, y el reintento con la misma clave **se procesa** (la clave se liberó).
  - `POST` sin cabecera → `400 missing-idempotency-key`; `GET` no exige nada; `POST /v1/auth/login` (público) tampoco.
  - la respuesta guardada existe si y solo si el efecto existió: tras un `boom` no queda fila en `idempotency_key`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implementar.** El replay fija el código con `reply.status(saved.responseCode)` sobre la `FastifyReply` y devuelve el cuerpo guardado; solo se replican código y cuerpo, que es lo que la tabla almacena (una cabecera `Location` no se reconstruye, y el cuerpo ya lleva el `id`).
- [ ] **Step 4: Run** `pnpm test:e2e apps/tubodega/test/edge` → PASS.
- [ ] **Step 5: Commit** `feat(http): interceptor de idempotencia con reserva, replay y liberación`

---

### Task 6: Casos de uso de sesión — `RefreshSession`, `Logout`, `ChangePassword`

**Files:**
- Create: `libs/tenancy/src/application/use-cases/{refresh-session.ts, logout.ts, change-password.ts}` (+ `.spec.ts`)
- Modify: `libs/tenancy/src/domain/errors.ts`, `libs/tenancy/src/{index.ts, tenancy.module.ts}`, `libs/tenancy/test/doubles/in-memory-session.repository.ts`

**Interfaces (produce):**

```ts
class RefreshSession {   // contexto de sistema: no hay organización hasta resolver el hash
  execute(input: { refreshToken: string }): Promise<{ accessToken: string; refreshToken: string; expiresIn: number }>;
}
class Logout {           // contexto de tenant; RequestContext presente
  execute(ctx: RequestContext, input: { refreshToken: string }): Promise<void>;
}
class ChangePassword {   // el propio usuario, con su contraseña actual
  execute(ctx: RequestContext, input: { current: string; next: string }): Promise<void>;
}
class RefreshTokenInvalidError extends DomainError { type = 'refresh-token-invalid'; status = 401 }
```

Reglas: `RefreshSession` busca por `sha256(token)`; **rechaza con el mismo `refresh-token-invalid`** si el hash no existe, si la sesión está revocada, si venció **o si el usuario está inactivo** (T-6 aplica también a la rotación, no solo al acceso). Al aceptar, revoca la usada con `clock.now()` y crea una nueva; el par anterior deja de servir de inmediato. `Logout` revoca la sesión solo si existe, pertenece a la organización del contexto y es del propio usuario; en cualquier otro caso responde igual (sin revelar si el token existía). `ChangePassword` verifica la actual con `PasswordHasher.verify` y lanza `InvalidCredentialsError` si falla; al cambiarla **no** revoca las sesiones abiertas (nada en los specs lo exige y el e2e 8b no lo espera).

- [ ] **Step 1: Pruebas** (con `FixedClock`, dobles en memoria):
  - `refresh-session.spec.ts`: rota (el token anterior queda `revokedAt` = ahora y el nuevo es distinto); reutilizar el anterior → `refresh-token-invalid`; token desconocido → ídem; sesión vencida (`expiresAt` < ahora) → ídem; usuario desactivado con sesión vigente → ídem.
  - `logout.spec.ts`: revoca la sesión propia; token de otro usuario de la misma organización → no revoca y no lanza; token desconocido → no lanza.
  - `change-password.spec.ts`: contraseña actual errónea → `InvalidCredentialsError`; correcta → `save` con el hash nuevo; la entidad conserva roles, `active` y `version`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implementar.** `sha256` ya existe exportado por `authenticate.ts`; se reutiliza.
- [ ] **Step 4: Run** `pnpm test libs/tenancy` → PASS, cobertura de `application/` ≥ 90 %.
- [ ] **Step 5: Commit** `feat(tenancy): rotación de sesión, cierre de sesión y cambio de contraseña`

---

### Task 7: Casos de uso de usuarios y `UserRepository.listPage`

**Files:**
- Create: `libs/tenancy/src/application/use-cases/{create-user.ts, list-users.ts, get-user.ts, update-user-roles.ts, deactivate-user.ts}` (+ `.spec.ts`)
- Modify: `libs/tenancy/src/application/ports/user.repository.ts`, `libs/tenancy/test/doubles/in-memory-user.repository.ts`, `libs/persistence/src/repositories/user.repository.ts`, `libs/tenancy/src/{index.ts, tenancy.module.ts}`, `libs/persistence/test/repositories/user.repository.int-spec.ts`

**Interfaces (produce):**

```ts
// puerto: una sola incorporación
interface UserRepository {
  /* … lo del plan 1 … */
  listPage(orgId: OrgId, filter: { active?: boolean; role?: Role },
           page: { limit: number; cursor?: Cursor; sort: { field: 'name'|'email'|'createdAt'; dir: 'asc'|'desc' } }
  ): Promise<Page<User>>;
}

class CreateUser       { execute(ctx, { email, name, password, roles }): Promise<User> }        // MANAGE_USERS
class ListUsers        { execute(ctx, { active?, role?, limit, cursor, sort }): Promise<Page<User>> }  // MANAGE_USERS
class GetUser          { execute(ctx, { id }): Promise<User> }                                  // MANAGE_USERS
class UpdateUserRoles  { execute(ctx, { id, roles, expectedVersion }): Promise<User> }          // MANAGE_USERS, T-2
class DeactivateUser   { execute(ctx, { id }): Promise<void> }                                  // MANAGE_USERS, T-2
class UserNotFoundError extends DomainError { type = 'not-found'; status = 404 }
```

`GetUser` no está en la tabla de [10 §7](docs/specs/10-tenancy.md) pero lo exige el caso 9 de la tabla e2e de la WAVE 1 (otra empresa pide `GET /v1/users/{juan}` y recibe `404`); se añade con la misma acción que el resto.

**I-6 sin excepciones:** todo caso de uso que reciba un `id` usa `users.findById(ctx.orgId, id)` y lanza `UserNotFoundError` (404) cuando no hay fila — nunca `403`. Con RLS activo, un id de otra organización simplemente no existe.

**T-2 en el dominio:** `UpdateUserRoles` y `DeactivateUser` leen `countActiveOwners(ctx.orgId)` y se lo pasan a `User.withRoles(roles, n)` / `User.deactivate(n)`, que ya implementan la regla y devuelven `LastOwnerError`. Los casos de uso no reimplementan la comprobación.

`KyselyUserRepository.listPage` usa `userDao.findPage` con el DSL, sin método concreto nuevo: el filtro por rol es el escape documentado en [08 §5](docs/specs/08-acceso-a-datos.md).

```ts
where: {
  ...(filter.active !== undefined ? { active: filter.active } : {}),
  ...(filter.role ? { AND: [(eb) => eb.exists(
        eb.selectFrom('userRole').select('userId')
          .whereRef('userRole.userId', '=', 'appUser.id')
          .where('userRole.orgId', '=', orgId)
          .where('userRole.role', '=', filter.role))] } : {}),
}
```
Los roles de cada página se cargan con **una** consulta a `user_role` por los ids de la página (`listByUsers`), no una por usuario.

- [ ] **Step 1: Pruebas de aplicación** (dobles en memoria):
  - `CreateUser` sin `MANAGE_USERS` (contexto de VIEWER) → `insufficient-role`; correo repetido en la misma organización → `email-taken`; el mismo correo en otra organización → ok; el usuario nace `active` con los roles pedidos y la contraseña hasheada; emite `user.created`.
  - `UpdateUserRoles` que retira `OWNER` al único activo → `last-owner`; con dos owners → ok y emite `user.roles_changed`; `expectedVersion` distinta → el repositorio lanza `VersionConflictError` (el filtro lo traduce); id inexistente → `UserNotFoundError`.
  - `DeactivateUser` del último OWNER → `last-owner`; de un ADMIN → ok y emite `user.deactivated`.
  - `ListUsers` filtra por `role` y por `active`, respeta `limit` y devuelve `nextCursor` cuando hay más.
  - `GetUser` de un id de otra organización (el doble no lo devuelve para ese `orgId`) → `UserNotFoundError`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implementar** casos de uso y `listPage` en el doble y en el adaptador Kysely.
- [ ] **Step 4: Pruebas de integración** en `user.repository.int-spec.ts`: `listPage` con 7 usuarios pagina en 3 páginas estables ordenando por `name`; el filtro `role: OPERATOR` devuelve solo los que lo tienen; los roles vienen completos en cada `User`.
- [ ] **Step 5: Run** `pnpm test libs/tenancy && pnpm test:e2e libs/persistence` → PASS.
- [ ] **Step 6: Commit** `feat(tenancy): alta, listado, cambio de roles y baja de usuarios con T-2 e I-6`

---

### Task 8: HTTP — `/v1/users`, `/v1/auth/refresh`, `/v1/auth/logout`, `/v1/me/password` y el snapshot de OpenAPI

**Files:**
- Create: `apps/tubodega/src/http/shared/{cursor-query.ts, if-match.ts}` (+ `.spec.ts`), `apps/tubodega/src/http/users/{users.controller.ts, users.dto.ts}`, `apps/tubodega/openapi.json`, `apps/tubodega/test/edge/openapi.int-spec.ts`
- Modify: `apps/tubodega/src/http/auth/{auth.controller.ts, auth.dto.ts}`, `apps/tubodega/src/http/me/{me.controller.ts, me.dto.ts}`, `apps/tubodega/src/app.module.ts`, `package.json` (`openapi:write`)

**Interfaces (produce):**

```ts
// cursor-query.ts
class InvalidFilterError extends DomainError { type = 'invalid-filter'; status = 400 }   // D-10
interface PageQuery { limit: number; cursor?: Cursor; sort: { field: string; dir: 'asc'|'desc' } }
function parsePage(query: Record<string, unknown>,
                   opts: { sortable: readonly string[]; defaultSort: string; filters: readonly string[] }): PageQuery;
// if-match.ts
class MissingIfMatchError extends DomainError { type = 'missing-if-match'; status = 400 }
function parseIfMatch(header: string | undefined): number;   // acepta `3` y `"3"`; ausente o no numérico → MissingIfMatchError
```

`parsePage` rechaza con `invalid-filter` toda clave de query que no sea `limit`, `cursor`, `sort` o uno de los `filters` declarados —**un `orgId` en la query es exactamente eso** (T-4, D-10)—, todo campo de `sort` fuera de `sortable`, y un `limit` fuera de `1..200`. `sort=-name` es descendente.

Endpoints nuevos:

| Método | Ruta | Acción | Notas |
|---|---|---|---|
| `POST` | `/v1/auth/refresh` | — | `@Public()`, exento de `Idempotency-Key`. `200 { accessToken, refreshToken, expiresIn }` |
| `POST` | `/v1/auth/logout` | `READ` | `@IdempotencyExempt()`. `204` |
| `GET` | `/v1/users` | `MANAGE_USERS` | filtros `active`, `role`; orden `name`, `email`, `createdAt` (default `name`) |
| `POST` | `/v1/users` | `MANAGE_USERS` | `201` + `Location`; exige `Idempotency-Key` |
| `GET` | `/v1/users/{id}` | `MANAGE_USERS` | `404` cross-org |
| `PATCH` | `/v1/users/{id}` | `MANAGE_USERS` | `If-Match` obligatorio; cuerpo `{ roles }` |
| `DELETE` | `/v1/users/{id}` | `MANAGE_USERS` | desactiva; `204` |
| `POST` | `/v1/me/password` | `READ` | `{ current, next }` → `204`; exige `Idempotency-Key` |

El DTO de `PATCH /v1/users/{id}` **no admite `kind` ni `email` ni `active`**: cambiar el correo o reactivar no está en [10 §4](docs/specs/10-tenancy.md), y `whitelist: true` elimina en silencio lo que sobre.

- [ ] **Step 1: `cursor-query.spec.ts` e `if-match.spec.ts`** (sin infraestructura): defaults `limit = 50` y el `defaultSort`; `limit=201` y `limit=0` → `invalid-filter`; `sort=-name` → `{ field: 'name', dir: 'desc' }`; `sort=foo` → `invalid-filter`; `?orgId=…` → `invalid-filter`; `?role=OPERATOR` con `role` declarado → pasa. `If-Match: "3"` y `If-Match: 3` → `3`; ausente → `missing-if-match`.
- [ ] **Step 2: Run** → FAIL. Implementar ambos helpers.
- [ ] **Step 3: Controladores y DTOs** con `class-validator` y `@ApiProperty({ example })` en cada campo; cada endpoint declara `@ApiResponse` para todos sus errores (`400`, `401`, `403`, `404`, `409`, `422` según aplique) con `ProblemDetailsView`. `usersView`/`pageView` en `http/shared/views.ts` para la forma `{ data, page: { nextCursor, hasMore } }`.
- [ ] **Step 4: `app.module.ts`** — registrar `UsersController`, los casos de uso nuevos en `TenancyModule` y el `IdempotencyInterceptor` como tercer `APP_INTERCEPTOR` (orden: transacción → identidad → idempotencia).
- [ ] **Step 5: `openapi.int-spec.ts`** — genera el documento con `startTestApp()` y afirma: (a) coincide con `apps/tubodega/openapi.json`; (b) todo endpoint declara al menos una respuesta de error; (c) `paths` incluye las diez rutas de [10 §7](docs/specs/10-tenancy.md) más `GET /v1/users/{id}`. Con `UPDATE_OPENAPI=1` reescribe el snapshot en vez de compararlo; `pnpm openapi:write` es exactamente esa invocación.
- [ ] **Step 6: Prueba manual con curl** (la que pidió el plan: endpoints reales)

```bash
docker compose up -d db && pnpm start:dev &
B=localhost:3000/v1
curl -s -X POST $B/organizations -H 'content-type: application/json' \
  -d '{"name":"Distribuidora La Esquina","slug":"la-esquina-x1","owner":{"email":"marta@esquina.co","name":"Marta","password":"correcthorse1!"}}' | jq
R=$(curl -s -X POST $B/auth/login -H 'content-type: application/json' \
  -d '{"email":"marta@esquina.co","password":"correcthorse1!"}')
T=$(echo $R | jq -r .accessToken); RT=$(echo $R | jq -r .refreshToken)

curl -s -X POST $B/users -H "authorization: Bearer $T" -H 'content-type: application/json' \
  -H "idempotency-key: $(uuidgen)" \
  -d '{"email":"juan@esquina.co","name":"Juan","password":"correcthorse1!","roles":["OPERATOR"]}' | jq
curl -s "$B/users?role=OPERATOR&limit=10&sort=-name" -H "authorization: Bearer $T" | jq
curl -s -i "$B/users?orgId=otra"  -H "authorization: Bearer $T"        # 400 invalid-filter
U=$(curl -s "$B/users" -H "authorization: Bearer $T" | jq -r '.data[]|select(.email=="juan@esquina.co").id')
curl -s -i -X PATCH $B/users/$U -H "authorization: Bearer $T" -H 'content-type: application/json' \
  -H 'if-match: "1"' -d '{"roles":["ADMIN"]}'                          # 200, luego repetir → 409 stale-version
curl -s -i -X PATCH $B/users/$U -H "authorization: Bearer $T" -H 'content-type: application/json' \
  -d '{"roles":["VIEWER"]}'                                            # 400 missing-if-match
curl -s -X POST $B/auth/refresh -H 'content-type: application/json' -d "{\"refreshToken\":\"$RT\"}" | jq
curl -s -i -X POST $B/auth/refresh -H 'content-type: application/json' -d "{\"refreshToken\":\"$RT\"}"  # 401
K=$(uuidgen)
for i in 1 2; do curl -s -o /dev/null -w '%{http_code} ' -X POST $B/users -H "authorization: Bearer $T" \
  -H 'content-type: application/json' -H "idempotency-key: $K" \
  -d '{"email":"sofia@esquina.co","name":"Sofía","password":"correcthorse1!","roles":["VIEWER"]}'; done   # 201 201 (replay)
curl -s $B/openapi.json | jq '.paths | keys'
```
- [ ] **Step 7: Run** `pnpm test && pnpm test:e2e apps/tubodega/test/edge` → PASS.
- [ ] **Step 8: Commit** `feat(http): endpoints de usuarios, refresh, logout y cambio de contraseña con paginación y snapshot OpenAPI`

---

### Task 9: El despachador de outbox

**Files:**
- Create: `apps/tubodega/src/jobs/outbox-dispatcher.job.ts`, `libs/persistence/src/outbox/outbox-dispatcher.ts`, `libs/persistence/test/outbox/dispatcher.int-spec.ts`
- Modify: `libs/persistence/src/dao/outbox-event.dao.ts`, `libs/persistence/src/{index.ts, persistence.module.ts}`, `apps/tubodega/src/app.module.ts`

**Interfaces (produce):**

```ts
// libs/persistence — método concreto: cruza organizaciones, así que se escribe a mano [08 §3]
class OutboxEventDao {
  claimPending(limit: number): Promise<OutboxEventModel[]>;   // WHERE published_at IS NULL ORDER BY occurred_at
                                                              // LIMIT n FOR UPDATE SKIP LOCKED
  markPublished(ids: readonly string[], at: Date): Promise<void>;
}
// apps — el job
class OutboxDispatcherJob {
  tick(): Promise<number>;   // uow.runAs({ pool: 'system' }, …): reclama ≤100, los escribe en el log, marca published_at
}
```

**Regla para todos los jobs desde aquí:** con `NODE_ENV=test` se registran pero **no arrancan su intervalo**; las pruebas invocan `tick()`. El intervalo real es `OUTBOX_INTERVAL_MS` vía `@nestjs/schedule`.

- [ ] **Step 1: `dispatcher.int-spec.ts`**: se registran eventos reales con `CreateOrganization` (que ya emite `organization.created`); `tick()` devuelve el número publicado y deja `published_at` no nulo; un segundo `tick()` no relee lo ya marcado; **dos `tick()` concurrentes no publican dos veces el mismo evento** (`FOR UPDATE SKIP LOCKED`); con `NODE_ENV=test` el intervalo no arranca (el conteo de publicaciones no cambia sin llamar a `tick()`).
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implementar.** El job corre en contexto de sistema: con el rol de tenant no vería ningún evento de ninguna organización ([05 §3](docs/specs/05-eventos-e-integraciones.md)). En el MVP «publicar» es escribir en el log con `type`, `orgId` y `traceId`; lo que importa es que el productor ya está en su sitio definitivo.
- [ ] **Step 4: Run** `pnpm test:e2e libs/persistence/test/outbox` → PASS.
- [ ] **Step 5: Commit** `feat(events): despachador de outbox en contexto de sistema con SKIP LOCKED`

---

### Task 10: La suite e2e de la WAVE 1, documentación y cierre

**Files:**
- Create: `apps/tubodega/test/e2e/w1-abrir-el-negocio.e2e-spec.ts`
- Delete: `apps/tubodega/test/e2e/p1-registro-y-login.e2e-spec.ts` (sus 11 casos quedan absorbidos)
- Modify: `test/support/e2e/tenant.ts`, `README.md`, `docs/postman/tubodega.postman_collection.json`, `docs/superpowers/plans/2026-09-06-00-plan-maestro-mvp.md` (nota de la desviación de D-1)

**Interfaces (produce):** `Tenant.user(role: 'ADMIN'|'OPERATOR'|'VIEWER', name?: string): Promise<Session>` — crea vía `POST /v1/users` con el token del owner y hace login. `registerOrg` sigue usando `idem: false`, de modo que cada suite demuestra de paso que los cuatro endpoints exentos funcionan sin cabecera.

- [ ] **Step 1: La suite**, narrativa y solo por API pública. Marta (OWNER) registra «Distribuidora La Esquina», da de alta a Diego (ADMIN), Juan (OPERATOR) y Sofía (VIEWER):

| # | Caso | Afirmaciones |
|---|---|---|
| 1 | Marta registra el negocio | `201`, `Location`, cuerpo con organización y owner (`roles = ['OWNER']`); slug repetido → `409 slug-taken`; cuerpo inválido → `400 validation-failed` con `pointer: '/owner/password'` |
| 2 | Marta inicia sesión y ve su perfil | `200` con el par de tokens; `/me` devuelve `[OWNER]` y la organización; contraseña errónea → `401 invalid-credentials`; `expiredToken()` → `401 token-expired`; firma inventada → `401 invalid-credentials` |
| 3 | Marta da de alta al equipo | `201` ×3; `GET /v1/users?role=OPERATOR` filtra; `?foo=1` → `400 invalid-filter`; correo repetido → `409 email-taken` |
| 4 | Sofía (VIEWER) intenta administrar | `POST /v1/users` con su token → `403 insufficient-role` |
| 5 | Diego cambia roles con control de versión | `PATCH /v1/users/{juan}` con `If-Match` correcto → `200`; repetir con la vieja → `409 stale-version`; sin `If-Match` → `400 missing-if-match` |
| 6 | Nadie deja la empresa sin dueño | `DELETE /v1/users/{marta}` → `422 last-owner` |
| 7 | Se revoca el acceso de alguien | `DELETE /v1/users/{sofia}` → `204`; `GET /v1/me` con el token de Sofía → `401 invalid-credentials` inmediato (T-6) |
| 8 | Sesión larga | `refresh` ×2 con el mismo token → el segundo `401 refresh-token-invalid`; `logout` → `204` (sin `Idempotency-Key`); refresh posterior → `401` |
| 8b | Juan cambia su contraseña | `POST /v1/me/password` con la actual errónea → `401`; correcta → `204`; login con la nueva → `200`, con la vieja → `401` |
| 9 | Otra empresa no ve nada | segunda `registerOrg` con el correo de Juan → `201` (T-1 es por organización); su token pide `GET`/`PATCH` de `{juan}` → `404` en ambos, nunca `403` (I-6) |
| 9b | Login con correo en dos empresas | sin `slug` → `409 ambiguous-login`; con `slug` → `200` y `/me` devuelve la organización correcta |
| 10 | Nadie elige su organización | `POST /v1/users` con `orgId` en el cuerpo → `201` y el campo se ignora; `GET /v1/users?orgId=…` → `400 invalid-filter`; nada aparece en la otra organización (T-4, D-10) |
| 11 | Reintentos seguros | misma clave dos veces → replay `201` + `Idempotency-Replayed: true` y **un solo** usuario en `GET /v1/users`; misma clave y otro cuerpo → `409 idempotency-key-reuse`; sin clave → `400 missing-idempotency-key` |
| 12 | Trazabilidad | `X-Request-Id: req-123` → UUID nuevo en la respuesta; con un UUID → el mismo; en un error, `traceId` del problem coincide con la cabecera |
| 13 | El contrato está publicado | `GET /v1/openapi.json` → `200` y `paths` incluye `/v1/users` |

- [ ] **Step 2: Run** `pnpm test:e2e apps/tubodega/test/e2e` → PASS en menos de 20 s.
- [ ] **Step 3: README** — sección de endpoints con los `curl` de la Task 8 (registro → login → alta de usuarios → listado → refresh → logout), y la nota de que todo `POST` salvo los cuatro exentos exige `Idempotency-Key`.
- [ ] **Step 4: Postman** — colección v2.2: carpetas `auth` (login, refresh, logout), `users` (list con `role`/`active`/`sort`/`limit`, create con `Idempotency-Key` autogenerada en el pre-request, get, patch con `If-Match` tomado de la respuesta anterior, delete), `me` (perfil, password) y la carpeta de errores (`invalid-filter`, `missing-if-match`, `stale-version`, `idempotency-key-reuse`, `last-owner`, `insufficient-role`).
- [ ] **Step 5: Nota en el plan maestro** — en D-1, dejar dicho que `0002_full_schema` se movió al plan 3 y que el DAO genérico se probó contra `app_user` y `user_role`.
- [ ] **Step 6: Puertas completas**

```bash
docker compose up -d db
pnpm lint && pnpm typecheck && pnpm db:check && pnpm test && pnpm test:cov && pnpm test:e2e
```
Esperado: todo verde; `pnpm test` < 10 s; `pnpm test:e2e` < 45 s; cobertura de `libs/tenancy/src/domain` ≥ 95 % y de `application` ≥ 90 %.

- [ ] **Step 7: Commit y merge**

```bash
git commit -m "test(e2e): la WAVE 1 completa por HTTP — cierre del plan 2"
```
Integrar `plan/02-usuarios-sesiones-e-idempotencia` en `master` con merge local (`superpowers:finishing-a-development-branch`).

---

## Verificación de extremo a extremo

1. **Base limpia:** `docker compose down -v && docker compose up -d db && pnpm db:deploy` aplica `0001` y `0002` sin error, y `pnpm db:check` sale `0`.
2. **Por HTTP, sin tocar la base:** los `curl` de la Task 8 Step 6 recorren registro → login → alta → listado paginado → cambio de roles con `If-Match` → baja → refresh → logout → cambio de contraseña, y muestran `400 invalid-filter`, `400 missing-if-match`, `409 stale-version`, `409 idempotency-key-reuse` y el replay `Idempotency-Replayed: true`.
3. **Automático:** `pnpm lint && pnpm typecheck && pnpm db:check && pnpm test && pnpm test:e2e` verdes, con `w1-abrir-el-negocio.e2e-spec.ts` cubriendo los 13 casos de la tabla de la WAVE 1.
4. **Concurrencia real:** `idempotency.int-spec.ts` (dos `POST` simultáneos con la misma clave) y `dispatcher.int-spec.ts` (dos `tick()` simultáneos) pasan de forma repetida (`--repeat 3`).
5. **Aislamiento:** el caso 9 de la suite demuestra I-6 por API pública, y `org-generic.int-spec.ts` lo demuestra por debajo, con RLS y el `orgId` explícito como dos filtros independientes.

## Qué queda fuera del Plan 2 (y dónde entra)

| Pieza | Plan |
|---|---|
| Migración `0002_full_schema` (resto de tablas), `CHECK`s, `NULLS NOT DISTINCT`, `REVOKE ON movement`, las 6 suites de `test/schema/` | 3 |
| `libs/catalog` (dominio, casos de uso, persistencia, media) y los nodos de `libs/inventory` | 3-4 |
| Sembradores del `OrgProvisioner` (nodos de frontera, plantillas, reglas de alerta) | 4 · 8 · 9 |
| Rate limiting y las purgas (idempotencia, outbox, alertas, media) | 10 |
