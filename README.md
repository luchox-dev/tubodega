# tubodega

WMS de movimientos para el negocio que ya superó el Excel pero al que un ERP le
queda grande. El MVP es **solo API**: el contrato REST en `/v1` es el producto.
Los specs viven en [`docs/specs/`](docs/specs/00-vision-y-alcance.md); el plan
de construcción en [`docs/superpowers/plans/`](docs/superpowers/plans/).

NestJS **monorepo** sobre **pnpm**, servido con **Fastify**, compilado con
**SWC**, con **PostgreSQL 16** (Prisma para el esquema, Kysely en ejecución).

## Estado: Plan 4 — el catálogo y las ubicaciones

Las treinta y siete operaciones de abajo están vivas y probadas de tres formas: por
dentro (`pnpm test`), contra Postgres (`pnpm test:e2e`) y atravesando un socket de
verdad (`pnpm blackbox`). El plan 4 cerró la WAVE 2 añadiendo las siete de
ubicaciones, y con ellas el sitio donde la mercancía puede estar: el ledger de la
WAVE 3 ya tiene dos extremos contra los que asentar. El índice completo está en el
[plan maestro](docs/superpowers/plans/2026-09-06-00-plan-maestro-mvp.md).

| Endpoint | Acción | Qué hace |
|---|---|---|
| `POST /v1/organizations` | — | Registra una organización con su primer `OWNER` |
| `POST /v1/auth/login` | — | Devuelve `accessToken` (JWT, 15 min) y `refreshToken` |
| `POST /v1/auth/refresh` | — | Rota el par; el token usado queda revocado |
| `POST /v1/auth/logout` | — | Revoca el token de refresco propio; basta un token válido |
| `GET /v1/me` | — | Usuario y organización del token |
| `POST /v1/me/password` | — | Cambia la propia contraseña, con la actual |
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
| `GET /v1/nodes` | `READ` | El árbol en plano; filtros `kind`, `active` y `under` |
| `POST /v1/nodes` | `MANAGE_NODES` | Dibuja un nodo; solo los `INTERNAL` anidan (I-10) |
| `GET /v1/nodes/{id}` | `READ` | Uno por id, con su `path` y su versión |
| `PATCH /v1/nodes/{id}` | `MANAGE_NODES` | Renombra; exige `If-Match`. No admite `kind`, `code` ni `parentId` |
| `POST /v1/nodes/{id}/move` | `MANAGE_NODES` | Reasigna el padre y recalcula el `path` del subárbol (N-1, N-2) |
| `DELETE /v1/nodes/{id}` | `MANAGE_NODES` | Lo desactiva; no si tiene saldo o hijos activos |
| `GET /v1/nodes/{id}/tree` | `READ` | El subárbol anidado, inactivos incluidos |
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
desde el primer día. El ledger llega en la WAVE 3.

## Arranque local

```bash
docker compose up -d db          # Postgres 16 con los tres roles y cuatro bases (db/init)
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
trae **las treinta operaciones** del contrato: 70 peticiones en nueve carpetas, de
las cuales 25 son casos de error para ver `problem+json` de cerca; y
[`tubodega.local.postman_environment.json`](docs/postman/tubodega.local.postman_environment.json)
el entorno local. Importa ambos y ejecuta la colección **en orden**: cada petición
guarda lo que la siguiente necesita —`orgId`, `accessToken`, los ids de los
productos, la `storageKey` de una foto— y `slug`/`email` se generan únicos en cada
corrida, así que se puede repetir tantas veces como haga falta.

```bash
pnpm dlx newman run docs/postman/tubodega.postman_collection.json \
  --working-dir docs/postman --env-var baseUrl=http://localhost:3000
```

El `--working-dir` es por las dos peticiones multipart, que suben
[`pixel.png`](docs/postman/pixel.png) —un PNG de un píxel, que para el contrato lo
que importa es el `content-type`—. En Postman hay que volver a elegir el archivo
después de importar: las rutas locales no viajan dentro de un `.json`.

Cada petición afirma su propio código de respuesta. Sin eso la colección sale
verde aunque una petición devuelva un `404`, que es exactamente lo que le pasaba
a la del lote mientras su id se quedaba sin fijar.

La colección se actualiza en cada plan que añada endpoints, igual que
[el seed](#datos-de-ejemplo).

## Layout

```
apps/tubodega/           la aplicación HTTP: composición, borde, controllers, adaptadores cruzados
  src/http/pipeline/     los pasos de la petición: traza, guard, transacción, identidad, validación, problem+json
  src/http/<recurso>/    una carpeta por recurso de la URL: organizations/, auth/, me/ … (controller + dto)
  src/http/shared/       vistas y DTOs compartidos entre recursos
  src/http/openapi/      el documento generado y su controller
  src/adapters/          puertos declarados por un módulo y satisfechos por otro
  src/jobs/              lo que corre por su cuenta: el despachador del outbox
  openapi.json           el contrato publicado, versionado; lo regenera `pnpm openapi:write`
  test/e2e, edge, jobs   el contrato, el borde y los trabajos de fondo
libs/common/             tipos del núcleo: Branded, Result, DomainError, Page, puertos (@app/common)
libs/persistence/        schema.prisma, migraciones, tipos generados, Kysely, DAOs, repositorios (@app/persistence)
libs/tenancy/            organización, usuarios, roles, autenticación (@app/tenancy)
libs/catalog/            productos, códigos, lotes, campos propios, fotos (@app/catalog)
libs/inventory/          el grafo de nodos: dónde puede haber mercancía (@app/inventory)
test/support/            harness de integración (withRollback) y cliente e2e
scripts/blackbox.sh      caja negra: corre las suites de scripts/blackbox/ y cruza la cobertura
docs/specs/              los specs; docs/superpowers/plans/ los planes; docs/postman/ la colección
db/init/01-roles.sql     roles tubodega_migrator / _app / _system y bases dev, test, shadow y docker
compose.yaml             Postgres 16 para desarrollo, y la imagen de la aplicación
.github/workflows/ci.yml los dos jobs: las cinco puertas y la caja negra
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
| `pnpm test:e2e` | integración + e2e contra Postgres; migra `tubodega_test` sola |
| `pnpm test:cov` | cobertura |
| `pnpm blackbox` | caja negra con `curl` contra un servidor levantado |
| `pnpm seed` | siembra el mundo de ejemplo por HTTP ([datos de ejemplo](#datos-de-ejemplo)) |
| `pnpm openapi:write` | regenera `apps/tubodega/openapi.json` desde el código |

## Base de datos

Tres roles con tres cadenas de conexión ([07 §2](docs/specs/07-composicion-y-contexto-de-ejecucion.md)):

| Variable | Rol | Uso |
|---|---|---|
| `DATABASE_URL` | `tubodega_app` | toda petición autenticada; RLS activo con `FORCE` |
| `DATABASE_URL_SYSTEM` | `tubodega_system` | registro, login y jobs (`BYPASSRLS`, el repositorio filtra igual) |
| `DATABASE_URL_MIGRATOR` | `tubodega_migrator` | dueño de las tablas; solo `prisma migrate` |
| `SHADOW_DATABASE_URL` | `tubodega_migrator` | desarrollo y CI: `migrate dev` y `db:check` |

Y cuatro bases, que [`db/init/01-roles.sql`](db/init/01-roles.sql) crea la
primera vez que se inicializa el volumen: `tubodega` para el desarrollo,
`tubodega_test` para `pnpm test:e2e`, `tubodega_shadow` para `migrate dev` y
`tubodega_docker` para la pila de compose. La última está separada a propósito:
el contenedor guarda las fotos en su volumen y `pnpm start:dev` en `./.media`,
así que compartir base dejaría filas apuntando a ficheros que están al otro lado.

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

### Caja negra

[`scripts/blackbox.sh`](scripts/blackbox.sh) recorre **el contrato entero** por
HTTP contra un servidor de verdad — 317 comprobaciones en cuatro suites, 318
si exportas `JWT_SECRET`:

| Suite | Qué recorre |
|---|---|
| [`10-tenencia.sh`](scripts/blackbox/10-tenencia.sh) | Marta abre el negocio: registro, sesiones, refresco y cierre, el equipo y sus roles, revocar un acceso, y que una empresa no vea a la de al lado |
| [`20-catalogo.sh`](scripts/blackbox/20-catalogo.sh) | Diego migra la hoja de cálculo y Juan escanea en el pasillo: campos propios, importación, fotos, códigos, series y lotes |
| [`25-ubicaciones.sh`](scripts/blackbox/25-ubicaciones.sh) | Diego dibuja el árbol de la bodega, lo reorganiza y retira un bin: la frontera que ya estaba, el subárbol que se mueve entero, los ciclos y las reglas del árbol |
| [`30-transversal.sh`](scripts/blackbox/30-transversal.sh) | Lo que el borde da a todos por igual: idempotencia (incluida una carrera real de dos peticiones), trazas, `problem+json`, el documento publicado y la inmutabilidad del ledger |

```bash
pnpm start:dev                       # en otra terminal
pnpm blackbox                        # las tres suites y el informe de cobertura
BASE=http://otra-maquina:3000 pnpm blackbox
BASE=http://localhost:3001 DB=tubodega_docker pnpm blackbox   # contra la pila de compose
./scripts/blackbox.sh --only tenencia
```

Al terminar cruza lo que pidió de verdad contra los paths de
`GET /v1/openapi.json` y exige de cada operación **un camino feliz y uno de
error**, que es la regla de [06 §6](docs/specs/06-pruebas-y-calidad.md). Si
alguna queda sin cubrir, la nombra y sale distinto de cero: «completo» deja de
ser una palabra y pasa a ser algo que se comprueba solo.

```
  operaciones del contrato: 37
  ejercitadas:              37
  con camino feliz:         37
  con camino de error:      37  (1 sin error posible)
```

**No sustituye a `pnpm test:e2e`, lo complementa.** La suite corre en proceso con
`fastify.inject()`, que fabrica la petición en memoria; esto atraviesa un socket,
y ahí aparecen fallos que la otra no puede ver. El `413` de una foto de 11 MB es
el ejemplo que costó descubrir: `@fastify/multipart` corta el archivo mientras lo
transmite y avisa lanzando un `FastifyError`, y durante el plan 3 el filtro lo
convertía en un `500`.

Escribe en la base de desarrollo y no limpia lo que crea, como las e2e: cada
corrida usa un slug nuevo. Con `JWT_SECRET` exportado corre además la
comprobación del `401 token-expired`, la única que necesita saber algo del
interior del servidor.

En CI corre sola, en un job hermano de las cinco puertas
([`ci.yml`](.github/workflows/ci.yml)): compila, levanta `start:prod`, espera al
contrato y ejecuta las tres suites. Va al lado y no dentro porque arrancar la
aplicación es lento y no tiene por qué alargar la ruta crítica.

## Datos de ejemplo

Una base recién migrada está vacía, y para probar cualquier cosa interesante hay
que construir antes la organización, la gente y el catálogo. Eso lo hace
[`scripts/seed.sh`](scripts/seed.sh) de un tirón:

```bash
pnpm start:dev                       # en otra terminal
pnpm seed                            # y dice con qué credenciales entrar
SEED_SLUG=otra-esquina pnpm seed     # un segundo mundo, independiente
docker compose --profile seed up     # o dentro de la red de compose
```

Siembra el reparto narrativo que el
[plan maestro](docs/superpowers/plans/2026-09-06-00-plan-maestro-mvp.md) §5 ya
define: **Distribuidora La Esquina**, con Marta (`OWNER`), Diego (`ADMIN`), Juan
(`OPERATOR`) y Sofía (`VIEWER`), dos campos propios, los cuatro productos
canónicos —`TOR-M8`, `ARROZ-25`, `LECHE-1L` y `TAL-BOSCH`—, el código de barras
del tornillo, el lote de leche con su vencimiento y la serie del taladro. Con eso
`GET /v1/codes/{value}/resolve` ya tiene algo que resolver.

Escribe **por HTTP**, no contra la base. Así respeta cada invariante sin
reimplementar nada —argon2, los UUIDv7, las columnas `version`, el outbox, RLS— y
no puede dejar un estado que la aplicación nunca permitiría; es el principio de
[06 §6](docs/specs/06-pruebas-y-calidad.md) aplicado a la siembra: si algo no se
puede montar por la API, es que a la API le falta algo. Por eso el servicio de
compose espera a que la aplicación esté sana, y no solo a las migraciones.

Si el mundo ya existe no toca nada y sale con `0`: re-sembrar a medias chocaría
contra la unicidad de códigos (C-2), series (C-5) y lotes (C-6). Para otro mundo,
otro `SEED_SLUG`.

**El seed se actualiza en cada plan que añada endpoints**, igual que la colección
de Postman. Uno que se queda atrás es peor que no tenerlo: aparenta un mundo
completo mientras le falta justo lo que acabas de construir. Hoy siembra todo lo
que el contrato sabe crear; lo que aún no existe:

| Todavía no siembra | Llega en |
|---|---|
| Movimientos y existencias | plan 6 |
| Plantillas e instancias de proceso | plan 8 |
| Reglas de alerta | plan 9 |

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

Eso es todo, también sobre un volumen limpio. Tres servicios, más un cuarto
opcional detrás de un perfil:

| Servicio | Qué es | Cuándo termina |
|---|---|---|
| `db` | Postgres 16; [`db/init/01-roles.sql`](db/init/01-roles.sql) crea los tres roles y las cuatro bases la primera vez que se inicializa el volumen | vive |
| `migrate` | init container de un disparo: `prisma migrate deploy` con `DATABASE_URL_MIGRATOR` | sale con 0 y muere |
| `tubodega` | la aplicación, sobre `tubodega_docker` | vive |
| `seed` | solo con `--profile seed`: siembra el mundo de ejemplo ([datos de ejemplo](#datos-de-ejemplo)) | sale con 0 y muere |

`tubodega` espera a `migrate` con `condition: service_completed_successfully`,
así que la base está migrada antes de que la aplicación abra sus pools, y una
migración que falla impide el arranque en vez de dejar viva una aplicación
contra un esquema viejo. Esa dependencia es la única red de seguridad que hay:
los pools de `pg` se abren perezosamente y ningún `OnModuleInit` toca la base,
de modo que una aplicación apuntada a un esquema inexistente arrancaría tan
contenta y devolvería `500` en cada petición. `migrate deploy` es idempotente y
toma un advisory lock ([04 §5](docs/specs/04-persistencia.md)): el segundo `up`
no encuentra nada pendiente y sale en seguida.

El entorno sale de [`.env.docker`](.env.docker), versionado a propósito —no hay
un solo secreto real dentro— y referenciado con `env_file:`. Es `.env.example`
con tres diferencias: el host de Postgres es `db`, que es como se llama dentro
de la red de compose; la base es `tubodega_docker`; y `MEDIA_ROOT` es
`/app/media`, que es donde se monta el volumen `media`.

Los puertos publicados se pueden mover, que es lo que permite levantar la pila
sin apagar el servidor de desarrollo:

```bash
APP_PORT=3001 docker compose up -d
BASE=http://localhost:3001 DB=tubodega_docker pnpm blackbox   # las tres suites
```

### Dos detalles que cuesta descubrir solo

El `Dockerfile` crea `/app/media` y se lo cede a `node` **antes** de `USER
node`. No es higiene: un volumen nombrado vacío hereda dueño y permisos del
directorio que tapa, y si ese directorio no existiera en la imagen Docker lo
crearía `root:root` y la primera foto moriría con `EACCES`. La herencia ocurre
**al crear el volumen y solo entonces**, así que arreglar la imagen no arregla
un volumen que ya nació mal: probar de verdad «volumen limpio» es `docker
compose down -v`, que borra también la base.

El healthcheck de `db` usa `pg_isready -h 127.0.0.1` y no `pg_isready` a secas.
Mientras inicializa un volumen vacío, el entrypoint oficial de Postgres levanta
un servidor temporal **solo por socket unix** para correr los scripts de
`/docker-entrypoint-initdb.d`. Sin `-h`, la sonda habla por ese mismo socket y
contesta que sí con `01-roles.sql` a medias: compose da el servicio por sano,
`migrate` arranca y su conexión TCP a `db:5432` es rechazada. Solo el servidor
definitivo escucha en TCP, y arranca cuando el init ha terminado — de ahí que
`-h` convierta la sonda en la prueba de que los roles y las bases existen. En
CI no se ve porque un *service container* de GitHub Actions no puede montar
`docker-entrypoint-initdb.d`, y el workflow corre ese SQL a mano.

La imagen de producción sigue sin Prisma. El CLI es una `devDependency`, y el
servicio `migrate` se construye con `target: migrate`, una etapa que solo trae
`node_modules` de desarrollo, `prisma.config.ts` y `libs/persistence/prisma`: no
compila la aplicación, así que arranca en segundos y un fallo de rspack no te
deja sin poder migrar. El entrypoint de despliegue de verdad llega en el plan 10.
