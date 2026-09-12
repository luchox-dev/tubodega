# tubodega

WMS de movimientos para el negocio que ya superó el Excel pero al que un ERP le
queda grande. El MVP es **solo API**: el contrato REST en `/v1` es el producto.
Los specs viven en [`docs/specs/`](docs/specs/00-vision-y-alcance.md); el plan
de construcción en [`docs/superpowers/plans/`](docs/superpowers/plans/).

NestJS **monorepo** sobre **pnpm**, servido con **Fastify**, compilado con
**SWC**, con **PostgreSQL 16** (Prisma para el esquema, Kysely en ejecución).

## Estado: Plan 3 — el catálogo completo

| Endpoint | Acción | Qué hace |
|---|---|---|
| `POST /v1/organizations` | — | Registra una organización con su primer `OWNER` |
| `POST /v1/auth/login` | — | Devuelve `accessToken` (JWT, 15 min) y `refreshToken` |
| `POST /v1/auth/refresh` | — | Rota el par; el token usado queda revocado |
| `POST /v1/auth/logout` | `READ` | Revoca el token de refresco propio |
| `GET /v1/me` | `READ` | Usuario y organización del token |
| `POST /v1/me/password` | `READ` | Cambia la propia contraseña, con la actual |
| `GET /v1/users` | `MANAGE_USERS` | Filtros `active` y `role`; orden `name`/`email`; cursor |
| `POST /v1/users` | `MANAGE_USERS` | Da de alta a alguien del equipo |
| `GET /v1/users/{id}` | `MANAGE_USERS` | Uno por id |
| `PATCH /v1/users/{id}` | `MANAGE_USERS` | Cambia roles; exige `If-Match` |
| `DELETE /v1/users/{id}` | `MANAGE_USERS` | Desactiva; no borra |
| `GET /v1/products` | `READ` | Filtros `active`, `trackingMode`, `q`; orden `name`/`sku`/`createdAt`; cursor |
| `POST /v1/products` | `MANAGE_CATALOG` | Define un producto, con sus códigos si vienen |
| `GET /v1/products/{id}` | `READ` | Uno por id, con sus fotos |
| `PATCH /v1/products/{id}` | `MANAGE_CATALOG` | Modifica; exige `If-Match` |
| `DELETE /v1/products/{id}` | `MANAGE_CATALOG` | Retira del catálogo; falla si hay existencias (C-9) |
| `POST /v1/products/import` | `MANAGE_CATALOG` | La hoja de cálculo: upsert por SKU, hasta 1000 filas |
| `GET /v1/products/{id}/codes` | `READ` | Los códigos con que se escanea |
| `POST /v1/products/{id}/codes` | `MANAGE_CATALOG` | Añade uno; único por organización (C-2) |
| `DELETE /v1/products/{id}/codes/{codeId}` | `MANAGE_CATALOG` | Lo quita |
| `GET /v1/codes/{value}/resolve` | `READ` | El escaneo: código, serie o SKU |
| `GET /v1/products/{id}/batches` | `READ` | Lotes y series |
| `POST /v1/products/{id}/batches` | `CREATE_BATCH` | Identifica una remesa; abierto a `OPERATOR` |
| `POST /v1/uploads` | `RECORD_MOVEMENT` | Zona de espera de fotos; multipart, 10 MB |
| `POST /v1/products/{id}/media` | `RECORD_MOVEMENT` / `MANAGE_CATALOG` | Reclama claves, o sube multipart directo |
| `DELETE /v1/products/{id}/media/{mediaId}` | `MANAGE_CATALOG` | Quita una foto |
| `GET /v1/custom-fields` | `READ` | Los campos propios; filtro `entity` |
| `POST /v1/custom-fields` | `MANAGE_CATALOG` | Define uno; `required` solo si nadie queda inválido (C-10) |
| `PATCH /v1/custom-fields/{id}` | `MANAGE_CATALOG` | Modifica; exige `If-Match` |
| `GET /v1/openapi.json` | — | El contrato generado desde el código |

Con RLS real en Postgres, `application/problem+json` en todo error,
`X-Request-Id` en toda respuesta, `404` y nunca `403` para recursos de otra
organización, y el despachador de outbox publicando los eventos del ledger.

**`Idempotency-Key` es obligatoria en todo `POST`** salvo los cuatro exentos
—`/v1/organizations`, `/v1/auth/login`, `/v1/auth/refresh`, `/v1/auth/logout`—,
que corren antes de que exista una organización con la que indexar la tabla
([07 §5](docs/specs/07-composicion-y-contexto-de-ejecucion.md)). Repetir una
clave con el mismo cuerpo devuelve la respuesta guardada con
`Idempotency-Replayed: true`; con otro cuerpo, `409 idempotency-key-reuse`.

Las veinte tablas del esquema ya existen, con sus `CHECK`, RLS en las
diecinueve que llevan `org_id`, y `UPDATE`/`DELETE` revocados sobre `movement`
desde el primer día. Las ubicaciones llegan en el plan 4 y el ledger en la
WAVE 3.

## Arranque local

```bash
docker compose up -d db          # Postgres 16 con los tres roles y tres bases (db/init)
cp .env.example .env
pnpm install
pnpm db:migrate                  # aplica migraciones y regenera los tipos de Kysely
pnpm start:dev
```

Probar con `curl` (el recorrido completo de la WAVE 1):

```bash
B=localhost:3000/v1

curl -s -X POST $B/organizations -H 'content-type: application/json' \
  -d '{"name":"Distribuidora La Esquina","slug":"la-esquina","owner":{"email":"marta@esquina.co","name":"Marta","password":"correcthorse1!"}}' | jq

R=$(curl -s -X POST $B/auth/login -H 'content-type: application/json' \
  -d '{"email":"marta@esquina.co","password":"correcthorse1!"}')
T=$(echo $R | jq -r .accessToken); RT=$(echo $R | jq -r .refreshToken)

curl -s $B/me -H "authorization: Bearer $T" | jq

# Todo POST autenticado exige Idempotency-Key; repetirla devuelve el replay.
K=$(uuidgen)
curl -s -X POST $B/users -H "authorization: Bearer $T" -H 'content-type: application/json' \
  -H "idempotency-key: $K" \
  -d '{"email":"juan@esquina.co","name":"Juan","password":"correcthorse1!","roles":["OPERATOR"]}' | jq
curl -s -D- -o /dev/null -X POST $B/users -H "authorization: Bearer $T" -H 'content-type: application/json' \
  -H "idempotency-key: $K" \
  -d '{"email":"juan@esquina.co","name":"Juan","password":"correcthorse1!","roles":["OPERATOR"]}' \
  | grep -i idempotency-replayed          # → true

curl -s "$B/users?role=OPERATOR&sort=-name&limit=10" -H "authorization: Bearer $T" | jq
curl -s -i "$B/users?orgId=otra" -H "authorization: Bearer $T"   # 400 invalid-filter (T-4)

U=$(curl -s "$B/users?role=OPERATOR" -H "authorization: Bearer $T" | jq -r '.data[0].id')
curl -s -o /dev/null -w '%{http_code}\n' -X PATCH $B/users/$U -H "authorization: Bearer $T" \
  -H 'content-type: application/json' -H 'if-match: "1"' -d '{"roles":["ADMIN"]}'   # 200
curl -s -o /dev/null -w '%{http_code}\n' -X PATCH $B/users/$U -H "authorization: Bearer $T" \
  -H 'content-type: application/json' -H 'if-match: "1"' -d '{"roles":["VIEWER"]}'  # 409 stale-version
curl -s -o /dev/null -w '%{http_code}\n' -X PATCH $B/users/$U -H "authorization: Bearer $T" \
  -H 'content-type: application/json' -d '{"roles":["VIEWER"]}'                     # 400 missing-if-match

curl -s -X POST $B/auth/refresh -H 'content-type: application/json' -d "{\"refreshToken\":\"$RT\"}" | jq
curl -s -i -X POST $B/auth/refresh -H 'content-type: application/json' -d "{\"refreshToken\":\"$RT\"}"  # 401: es de un solo uso

curl -s -i $B/me                                       # 401 problem+json
curl -s $B/openapi.json | jq '.paths | keys'
```

Si el correo existe en más de una organización, `login` responde
`409 ambiguous-login` y hay que enviar `slug`.

### Postman

[`docs/postman/tubodega.postman_collection.json`](docs/postman/tubodega.postman_collection.json)
trae todos los endpoints disponibles más una carpeta de casos de error, y
[`tubodega.local.postman_environment.json`](docs/postman/tubodega.local.postman_environment.json)
el entorno local. Importa ambos y ejecuta la colección en orden: el registro
guarda `orgId`, el login guarda `accessToken` y `refreshToken`, y `slug`/`email`
se generan únicos en cada corrida si están vacíos. Desde la terminal:

```bash
pnpm dlx newman run docs/postman/tubodega.postman_collection.json --env-var baseUrl=http://localhost:3000
```

La colección se actualiza en cada plan que añada endpoints.

## Layout

```
apps/tubodega/           la aplicación HTTP: composición, borde, controllers, adaptadores cruzados
  src/http/pipeline/     los pasos de la petición: traza, guard, transacción, identidad, validación, problem+json
  src/http/<recurso>/    una carpeta por recurso de la URL: organizations/, auth/, me/ … (controller + dto)
  src/http/shared/       vistas y DTOs compartidos entre recursos
  src/http/openapi/      el documento generado y su controller
  src/adapters/          puertos declarados por un módulo y satisfechos por otro
  test/edge, test/e2e    pruebas del borde y del contrato
libs/common/             tipos del núcleo: Branded, Result, DomainError, Page, puertos (@app/common)
libs/persistence/        schema.prisma, migraciones, tipos generados, Kysely, DAOs, repositorios (@app/persistence)
libs/tenancy/            organización, usuarios, roles, autenticación (@app/tenancy)
libs/catalog/            productos, códigos, lotes, campos propios, fotos (@app/catalog)
test/support/            harness de integración (withRollback) y cliente e2e
db/init/01-roles.sql     roles tubodega_migrator / _app / _system y bases dev, test y shadow
.media/                  donde DiskMediaStorage escribe las fotos (MEDIA_ROOT)
```

Reglas de arquitectura ([01 §5](docs/specs/01-arquitectura.md)) comprobadas por
`dependency-cruiser` en `pnpm lint`: el dominio es puro, las dependencias van
hacia abajo, solo se importan barriles, nadie importa `persistence`.

## Comandos

| Comando | Hace |
|---|---|
| `pnpm start:dev` | arranca con watch |
| `pnpm build` / `pnpm start:prod` | bundle a `dist/apps/tubodega/main.js` y ejecución |
| `pnpm lint` | oxlint + reglas de arquitectura |
| `pnpm typecheck` | `tsc --noEmit` sobre apps, libs, test y configs |
| `pnpm db:migrate` | `prisma migrate dev` (desarrollo; usa la shadow database) |
| `pnpm db:deploy` | `prisma migrate deploy` (despliegue) |
| `pnpm db:generate` | regenera `libs/persistence/src/generated/db.ts` |
| `pnpm db:check` | el historial de migraciones reproduce `schema.prisma` |
| `pnpm test` | dominio + aplicación, sin infraestructura |
| `pnpm test:e2e` | integración + e2e (+ invariantes) contra Postgres; migra `tubodega_test` sola |
| `pnpm test:cov` | cobertura |

## Base de datos

Tres roles con tres cadenas de conexión ([07 §2](docs/specs/07-composicion-y-contexto-de-ejecucion.md)):

| Variable | Rol | Uso |
|---|---|---|
| `DATABASE_URL` | `tubodega_app` | toda petición autenticada; RLS activo con `FORCE` |
| `DATABASE_URL_SYSTEM` | `tubodega_system` | registro, login y jobs (`BYPASSRLS`, el repositorio filtra igual) |
| `DATABASE_URL_MIGRATOR` | `tubodega_migrator` | dueño de las tablas; solo `prisma migrate` |
| `SHADOW_DATABASE_URL` | `tubodega_migrator` | desarrollo y CI: `migrate dev` y `db:check` |

Prisma 7 lee las URLs de `prisma.config.ts`, no del schema. Lo que el
lenguaje de Prisma no expresa —`CHECK`, RLS, índices parciales, `GRANT`— va a
mano al final de cada `migration.sql` ([04 §5.1](docs/specs/04-persistencia.md)).

Flujo de un cambio de esquema:

```
1. editar libs/persistence/prisma/schema.prisma
2. pnpm prisma migrate dev --create-only --name <cambio>
3. completar migration.sql a mano
4. pnpm db:migrate && pnpm db:generate
5. pnpm db:check   → exit 0
```

## Pruebas

El sufijo decide el nivel ([06 §2](docs/specs/06-pruebas-y-calidad.md)):
`*.spec.ts` no toca nada; `*.int-spec.ts`, `*.e2e-spec.ts` y `*.prop-spec.ts`
necesitan Postgres. Las de integración corren dentro de una transacción que se
revierte; las e2e registran su propia organización y hablan solo el contrato.
Todo se ejecuta con `.env.test` contra `tubodega_test`.

## Cómo está cableado SWC

Rspack (`builder: "rspack"` en `nest-cli.json`) compila con `builtin:swc-loader`
y las pruebas usan `unplugin-swc`, así que build y tests comparten la semántica
de decoradores. SWC no comprueba tipos: `pnpm typecheck` es la única puerta que
los detecta. El alias `@app/<lib>` apunta al archivo `index.ts` (bajo
`moduleResolution: nodenext` un directorio no resuelve por índice).

## Docker

```bash
docker compose up --build
curl http://127.0.0.1:3000/v1/openapi.json
```

El healthcheck usa `127.0.0.1` y la app escucha en `0.0.0.0` para ser
alcanzable desde fuera del contenedor. El entrypoint con `migrate deploy`
llega en el plan 10.
