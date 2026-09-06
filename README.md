# tubodega

WMS de movimientos para el negocio que ya superó el Excel pero al que un ERP le
queda grande. El MVP es **solo API**: el contrato REST en `/v1` es el producto.
Los specs viven en [`docs/specs/`](docs/specs/00-vision-y-alcance.md); el plan
de construcción en [`docs/superpowers/plans/`](docs/superpowers/plans/).

NestJS **monorepo** sobre **pnpm**, servido con **Fastify**, compilado con
**SWC**, con **PostgreSQL 16** (Prisma para el esquema, Kysely en ejecución).

## Estado: Plan 1

| Endpoint | Qué hace |
|---|---|
| `POST /v1/organizations` | Registra una organización con su primer `OWNER` |
| `POST /v1/auth/login` | Devuelve `accessToken` (JWT, 15 min) y `refreshToken` |
| `GET /v1/me` | Usuario y organización del token |
| `GET /v1/openapi.json` | El contrato generado desde el código |

Con RLS real en Postgres, `application/problem+json` en todo error,
`X-Request-Id` en toda respuesta y token vencido distinguido de credenciales
inválidas. Usuarios, refresh/logout e `Idempotency-Key` llegan en el plan 2.

## Arranque local

```bash
docker compose up -d db          # Postgres 16 con los tres roles y tres bases (db/init)
cp .env.example .env
pnpm install
pnpm db:migrate                  # aplica migraciones y regenera los tipos de Kysely
pnpm start:dev
```

Probar con `curl`:

```bash
curl -s -i -X POST localhost:3000/v1/organizations -H 'content-type: application/json' \
  -d '{"name":"Distribuidora La Esquina","slug":"la-esquina","owner":{"email":"marta@esquina.co","name":"Marta","password":"correcthorse1"}}'

TOKEN=$(curl -s -X POST localhost:3000/v1/auth/login -H 'content-type: application/json' \
  -d '{"email":"marta@esquina.co","password":"correcthorse1"}' | jq -r .accessToken)

curl -s localhost:3000/v1/me -H "authorization: Bearer $TOKEN" | jq
curl -s -i localhost:3000/v1/me                        # 401 problem+json
curl -s localhost:3000/v1/openapi.json | jq '.paths | keys'
```

Si el correo existe en más de una organización, `login` responde
`409 ambiguous-login` y hay que enviar `slug`.

## Layout

```
apps/tubodega/           la aplicación HTTP: composición, borde, controllers, adaptadores cruzados
  src/http/              traza, guard, transacción, identidad, problem+json, validación
  src/adapters/          puertos declarados por un módulo y satisfechos por otro
  test/edge, test/e2e    pruebas del borde y del contrato
libs/common/             tipos del núcleo: Branded, Result, DomainError, Page, puertos (@app/common)
libs/persistence/        schema.prisma, migraciones, tipos generados, Kysely, DAOs, repositorios (@app/persistence)
libs/tenancy/            organización, usuarios, roles, autenticación (@app/tenancy)
test/support/            harness de integración (withRollback) y cliente e2e
db/init/01-roles.sql     roles tubodega_migrator / _app / _system y bases dev, test y shadow
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
