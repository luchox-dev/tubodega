# Parte C — Plan maestro de ejecución (referencia para los planes 2-10)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Este es un plan maestro (roadmap).** Cada fase `F<wave>.<n>` se convierte, en el momento de ejecutarla, en un plan detallado propio con `superpowers:writing-plans` (pasos de 2-5 min con código, test primero, commit). Aquí se fija *qué* entrega cada fase, *qué archivos* toca, *qué interfaces* produce/consume, *qué pruebas* la cierran y *cuándo está hecha*. No se duplica el contenido de los specs: se referencia por sección.

**Goal:** Construir el MVP de tubodega —un WMS de movimientos solo-API— hasta que los 10 criterios de éxito de [00 §7](docs/specs/00-vision-y-alcance.md) pasen como pruebas e2e sobre una organización recién creada.

**Architecture:** Monolito modular NestJS + Fastify con dominio puro por librería (`domain/ · application/ · infrastructure/`), persistencia en `libs/persistence` (Prisma para esquema/migraciones, Kysely en ejecución), aislamiento por `org_id` + RLS + FK compuestas, ledger append-only con saldos materializados en la misma transacción y outbox transaccional. Ver [01](docs/specs/01-arquitectura.md), [07](docs/specs/07-composicion-y-contexto-de-ejecucion.md), [08](docs/specs/08-acceso-a-datos.md).

**Tech Stack:** Node 26 · TypeScript 6 · NestJS 12 (Fastify) · SWC/Rspack · pnpm 12 · PostgreSQL 16 · Prisma (dev-only) + `prisma-kysely` · Kysely + `pg` · `jose` (JWT HS256) · `@node-rs/argon2` · `uuid` (v7) · `@fastify/multipart` · `@nestjs/swagger` · `@nestjs/schedule` · vitest + supertest/`inject` · `fast-check` · `dependency-cruiser` · oxlint.

**Spec:** `docs/specs/00` … `14`, `90`. Este plan argumenta desde ellos; el ejecutor de cada fase lee la sección referenciada antes de tocar código.

## Global Constraints

Copiadas de los specs; toda fase las hereda:

- `/v1` como prefijo; JSON en camelCase; enums en `SCREAMING_SNAKE_CASE`; decimales como **cadena** (`"12.500"`); fechas ISO 8601 UTC; ids UUIDv7 canónicos ([03 §1, §7](docs/specs/03-contrato-api.md)).
- Errores `application/problem+json` (RFC 9457) con `type`, `title`, `status`, `detail`, `instance`, `traceId`, `errors[]` ([03 §5](docs/specs/03-contrato-api.md)). `404` y nunca `403` para recursos de otra organización.
- `Idempotency-Key` obligatoria en todo `POST` salvo `POST /v1/organizations`, `/v1/auth/login`, `/v1/auth/refresh`, `/v1/auth/logout` ([07 §5](docs/specs/07-composicion-y-contexto-de-ejecucion.md)). Retención 7 días; `IN_FLIGHT` > 5 min se considera abandonada.
- `If-Match` con `version` en `PATCH`/`PUT` de recursos mutables; `409 stale-version` si difiere ([03 §9](docs/specs/03-contrato-api.md)).
- Paginación por cursor opaco: `limit` por defecto 50, máximo 200; respuesta `{ data, page: { nextCursor, hasMore } }` ([03 §6](docs/specs/03-contrato-api.md)).
- La organización viene **solo** del token. Ningún endpoint acepta `orgId` (T-4).
- Toda petición abre transacción (`READ ONLY` en `GET`/`HEAD`) y ejecuta `SET LOCAL app.current_org` **antes** de cualquier caso de uso (T-5, [07 §3](docs/specs/07-composicion-y-contexto-de-ejecucion.md)).
- Tres roles de Postgres con tres cadenas de conexión: `tubodega_app` (RLS), `tubodega_system` (`BYPASSRLS`), `tubodega_migrator` (dueño). `REVOKE UPDATE, DELETE ON movement` para los dos primeros ([04 §4](docs/specs/04-persistencia.md)).
- Reglas de arquitectura R-1..R-4 verificadas por `dependency-cruiser` en `pnpm lint` ([06 §8](docs/specs/06-pruebas-y-calidad.md)).
- Sufijo de archivo decide el nivel de prueba: `*.spec.ts` (sin infra, `pnpm test`), `*.int-spec.ts` / `*.e2e-spec.ts` / `*.prop-spec.ts` (`pnpm test:e2e`) ([06 §2](docs/specs/06-pruebas-y-calidad.md)).
- Ninguna prueba usa `new Date()`; `Clock` es un puerto. Dobles con comportamiento (en memoria), nunca mocks con aserciones de llamada ([06 §4](docs/specs/06-pruebas-y-calidad.md)).
- Ninguna prueba e2e toca la base de datos: prepara y comprueba solo por la API pública ([06 §6](docs/specs/06-pruebas-y-calidad.md)).
- Cobertura: `libs/inventory/src/domain` y `libs/process/src/domain` al **100 %** líneas y ramas; resto de `domain/` 95 %; `application/` 90 %; global 85 % ([06 §9](docs/specs/06-pruebas-y-calidad.md)).
- Alias `@app/<lib>` apunta al archivo `index.ts`, nunca al directorio ([01 §3](docs/specs/01-arquitectura.md)).
- Migraciones solo hacia adelante, nunca editadas tras aplicarse; `pnpm db:check` en CI ([04 §5](docs/specs/04-persistencia.md)).

---

## 1. Contexto

El repositorio tiene solo el scaffold (`a6d669e`): Nest monorepo con `apps/tubodega` (un `GET /` que devuelve `Hello World!`), `libs/common` (validación de `NODE_ENV` y `PORT`), vitest con SWC, oxlint, `pnpm typecheck`, Dockerfile y `compose.yaml` sin base de datos. Los 15 specs en `docs/specs/` describen el MVP completo y están cerrados: vocabulario, invariantes numeradas, esquema SQL, contratos de puertos, endpoints, errores y qué prueba cada nivel.

El problema que resuelve este plan es de **orden y de tamaño de lote**: qué se construye primero para que cada incremento sea probable de verdad (sin stubs de producción) y para que, al cerrar cada grupo de fases, existan pruebas e2e que ejerciten un caso de uso real del operario o del administrador —no un endpoint aislado—.

**Resultado esperado:** al terminar la WAVE 6, `pnpm lint && pnpm typecheck && pnpm db:check && pnpm test && pnpm test:e2e` pasan en CI, y la suite `mvp-acceptance.e2e-spec.ts` ejecuta los 10 criterios de éxito en orden sobre una organización creada en la propia prueba.

## 2. Cómo leer el plan

```
WAVE  = grupo de fases que, al cerrarse, habilita casos de uso reales completos por HTTP
        y los demuestra con una suite e2e narrativa (un negocio ficticio, personas, mercancía).
FASE  = unidad pequeña con su propio ciclo test → código → verificación → commit.
        Una fase se puede rechazar sin rechazar a la vecina.
```

Cada fase declara:

- **Entrega** — qué existe al terminar.
- **Archivos** — creados/modificados (patrón + ejemplos representativos, no la lista exhaustiva).
- **Interfaces** — lo que consume de fases previas y lo que produce para las siguientes, con la sección del spec que fija la firma.
- **Pruebas** — nivel y casos clave, nombrados por invariante (`I-4`, `C-7`, `P-3`…).
- **Hecho cuando** — comandos y salida esperada.

Orden de dependencia entre waves: `W1 → W2 → W3 → W4 → W5 → W6`. Dentro de una wave las fases van en orden salvo que se indique `∥` (paralelizables).

## 3. Decisiones de ejecución

Decisiones que los specs dejan abiertas o que afectan al orden. Cada una es revisable en la aprobación del plan.

| # | Decisión | Por qué |
|---|---|---|
| D-1 | **Esquema incremental, una migración por plan que lo necesite:** `0001_tenancy` (plan 1: `organization`, `app_user`, `user_role`, `refresh_token`, `outbox_event`) y `0002_full_schema` (plan 2: todo el resto de [04 §3](docs/specs/04-persistencia.md) con CHECKs, RLS, índices parciales, `NULLS NOT DISTINCT`, `REVOKE`). Desde el plan 2 el esquema está completo; las migraciones posteriores solo aparecen si un spec cambia. | El plan 1 debe entregar endpoints probables cuanto antes; y a partir del plan 2 el DAO genérico se prueba contra `app_user` y `alert_rule` ([08 §8](docs/specs/08-acceso-a-datos.md)), lo que exige el esquema entero. `pnpm db:check` vigila desde la primera migración. **Revisado al ejecutar el plan 2:** `0002` acabó siendo solo `idempotency_key`, y el `full_schema` se movió al plan 3 (arranque de la WAVE 2), porque el plan 2 no entregaba ningún endpoint si cargaba con las 20 tablas. El DAO genérico se probó, con el mismo alcance, contra `app_user` (clave `id`, `versioned`) y `user_role` (clave compuesta `{ userId, role }`) en lugar de `alert_rule`, que todavía no existe. **Revisado al ejecutar el plan 3:** la migración se llamó `full_schema` y aplicó limpia sobre base vacía; abre fijando `app.current_org`, porque las FK nuevas hacia `app_user` se validan con una consulta contra una tabla que ya tiene `FORCE ROW LEVEL SECURITY` y el migrador no es excepción a una política forzada. El `text_pattern_ops` de `node.path` vive solo en el SQL: `prisma migrate diff` no introspecciona opclases, así que declarado en el schema haría fallar `pnpm db:check` para siempre. |
| D-2 | **`OrgProvisioner` se compone de sembradores por módulo** que se van añadiendo: W2 nodos de frontera, W4 plantillas, W5 reglas de alerta. En W1 la lista está vacía. | Evita stubs: cada wave registra su sembrador real en el adaptador `apps/tubodega/src/adapters/tenancy/org-provisioner.adapter.ts` ([10 §5](docs/specs/10-tenancy.md), [07 §7](docs/specs/07-composicion-y-contexto-de-ejecucion.md)). |
| D-3 | **`MovementCounter` y `StockChecker` (C-8, C-9) y `hasAnyStock` (N-3) se implementan en W2** sobre las tablas `movement` y `stock_balance` (ya existen por D-1) como métodos de solo lectura de `KyselyMovementRepository` (`countByProduct`) y `KyselyStockBalanceRepository` (`hasAnyStock`, `query`); el resto de esos repositorios llega en W3. `StockChecker.hasStock` devuelve además las posiciones con `path` para que `product-has-stock` liste los nodos ([11 §9](docs/specs/11-catalog.md)). | El catálogo y los nodos necesitan esas consultas para sus invariantes, y son consultas triviales sobre tablas existentes. |
| D-4 | **Tipos compartidos en `libs/common`:** `OrgId`, `UserId`, `TraceId`, `ProcessInstanceId`, `Cursor`, `Page`, `Result`, `DomainError`, `DomainEvent`, `Clock`, `IdGenerator`, `UnitOfWork`, `EventPublisher`. | [01 §4](docs/specs/01-arquitectura.md) los define ahí; `DomainEvent.orgId` obliga a que `OrgId` viva en `common` aunque [10 §2](docs/specs/10-tenancy.md) lo liste. `EventPublisher` lo usan todos los módulos, así que también es de `common`. |
| D-5 | **Outbox (publisher + despachador) en W1.** | `tenancy` ya emite `organization.created` y `user.*`; tener el productor y el consumidor desde el inicio evita retro-cablear ([05 §2-3](docs/specs/05-eventos-e-integraciones.md)). |
| D-6 | **El borde completo (guard, interceptores, idempotencia, filtro, OpenAPI) en W1**; rate limiting y **todas** las purgas (idempotencia, outbox, alertas, media) en W6. | I-6 e I-7 viven en el borde ([07 §1](docs/specs/07-composicion-y-contexto-de-ejecucion.md)) y todos los módulos los necesitan. El rate limit no habilita ningún caso de uso; las purgas no cambian comportamiento observable. |
| D-7 | **Aislamiento e2e por organización:** cada archivo e2e registra su propia organización vía `POST /v1/organizations` con `slug` **aleatorio** (`la-esquina-<8 hex>`), porque la base de test nunca se limpia. No se trunca nada. Las pruebas de integración usan transacción revertida. | La frontera de tenant es el aislamiento natural del producto; además demuestra I-6 en cada suite. |
| D-8 | **Librerías:** `kysely`+`pg`, `prisma`+`prisma-kysely` (`camelCase = true`), `jose`, `@node-rs/argon2` (binario prebuilt, sin `allowBuilds`), `uuid` (`v7()`), `@fastify/multipart`, `@nestjs/swagger`, `@nestjs/schedule`, `fast-check`, `dependency-cruiser`. | ESM nativo, sin scripts de build salvo `@swc/core` que ya está permitido, y cada una cubre exactamente un puerto o una puerta de CI. |
| D-9 | **La reserva (A) y la liberación (C) de idempotencia ([07 §5](docs/specs/07-composicion-y-contexto-de-ejecucion.md)) usan una transacción separada** vía `KyselyUnitOfWork.runDetached()` (método de infraestructura, no del puerto `UnitOfWork`) sobre un **tercer pool pequeño y dedicado** (`tubodega_app`, tamaño 2, con `SET LOCAL app.current_org`). La confirmación (B) va en la transacción ambiental. | El interceptor 5 corre *dentro* del `run()` del interceptor 3; sin conexión aparte, dos peticiones concurrentes no se verían. Y si la conexión aparte saliera del **mismo** pool de tenant, diez `POST` simultáneos con el pool de 10 agotado se bloquearían esperando una undécima conexión: el pool dedicado nunca espera al de peticiones, así que no hay ciclo. |
| D-10 | **Errores no definidos en los specs, añadidos:** `409 movement-id-taken` (id de cliente repetido con `Idempotency-Key` distinta, choque contra PK, [02 §6](docs/specs/02-modelo-de-dominio.md)); `400 invalid-filter` para filtros/orden no declarados ([03 §8](docs/specs/03-contrato-api.md)); `400 evaluate-at-not-allowed` para `at` fuera de `NODE_ENV=test` ([14 §5](docs/specs/14-alerts.md)); `422 reason-required` cuando un extremo del movimiento es uno de los nodos sembrados `adjustment-in`, `adjustment-out` o `shrinkage` y falta `reason` ([02 §10](docs/specs/02-modelo-de-dominio.md) lo exige; [12 §9](docs/specs/12-inventory.md) no le da `type`); `404 code-not-found` en `GET /v1/codes/{value}/resolve` cuando `ResolveCode` devuelve `null` ([11 §4](docs/specs/11-catalog.md)); `400 validation-failed` para DTOs (`ValidationPipe` con `whitelist: true, forbidNonWhitelisted: false`: los campos desconocidos —`orgId` incluido— se **eliminan** en silencio, como exige [10 §10](docs/specs/10-tenancy.md); un `orgId` en la query es un filtro no declarado y recibe `invalid-filter`); `400 missing-if-match` en `PATCH`/`PUT` de recursos versionados sin cabecera; `422 custom-field-type-locked` al cambiar el `type` de una definición con valores ([11 §4](docs/specs/11-catalog.md)); `422 serial-already-placed` cuando un movimiento dejaría una unidad `SERIAL` en dos nodos custodiables (I-9, [02 §9](docs/specs/02-modelo-de-dominio.md)). | Los specs describen el comportamiento pero no el `type`; se fijan aquí para que las pruebas los afirmen. |
| D-13 | **`UnitOfWork.run()` invocado sin transacción activa lanza `NoActiveTransactionError`**; el borde y los jobs abren con `KyselyUnitOfWork.runAs(scope, fn)`, método de infraestructura. | [07 §4](docs/specs/07-composicion-y-contexto-de-ejecucion.md) dice que `run()` «abre una transacción si no hay ninguna», pero el puerto de `common` no sabe qué pool ni qué organización usar; quien abre siempre lo sabe (petición: token; job: iteración). Desviación deliberada del texto, no del espíritu: los casos de uso siguen sin abrir nada. |
| D-14 | **Reclamar claves de la zona de espera exige `RECORD_MOVEMENT`; adjuntar multipart directo exige `MANAGE_CATALOG`.** `AttachMedia.execute(ctx, { productId, storageKeys })` comprueba `RECORD_MOVEMENT`; `AttachMedia.execute(ctx, { productId, file })` comprueba `MANAGE_CATALOG`. | [11 §7](docs/specs/11-catalog.md) pone `MANAGE_CATALOG` en `POST /v1/products/{id}/media`, pero [13 §5](docs/specs/13-process.md) hace que el `CONFIRM` de un `OPERATOR` adjunte las fotos que él mismo subió con `RECORD_MOVEMENT`. Sin esta regla, W4 #4 devolvería `403`. La ruta HTTP sigue exigiendo `MANAGE_CATALOG` para la forma multipart y `RECORD_MOVEMENT` para `{ storageKeys[] }`. |
| D-15 | **Los umbrales de cobertura se activan en la fase que crea cada directorio** (`libs/tenancy/src/domain` en F1.6, `libs/inventory/src/domain` al 100 % desde F2.5, `libs/process/src/domain` al 100 % desde F4.1, etc.); el global de 85 % en F6.4. | `pnpm test:cov` debe ser una puerta real al cerrar cada wave, no solo al final. |
| D-16 | **Las pruebas e2e usan el reloj real del cliente** (`new Date()` en la suite) para construir `occurredAt`, `dueAt` y `expiresAt`, y toman `T` de `recordedAt` en una respuesta del servidor cuando necesitan anclarse a él (I-14). La prohibición de `new Date()` de [06 §4](docs/specs/06-pruebas-y-calidad.md) aplica al código del servidor y a los niveles dominio/aplicación. | El e2e es un cliente; el servidor solo ve el puerto `Clock`. Las fechas que las alertas «adelantan» viajan en `at` ([14 §5](docs/specs/14-alerts.md)). |
| D-17 | **Los `POST` multipart (`/v1/uploads`, `/v1/products/{id}/media`) no se eximen de `Idempotency-Key`**, pero su `request_hash` se calcula sobre un cuerpo JSON vacío. | `canonicalHash` acepta `Buffer`, pero con `@fastify/multipart` el `req.body` JSON queda vacío y todas las subidas hashean igual: reusar una clave **replica** en vez de dar `409 idempotency-key-reuse`. Es el comportamiento seguro, y bufferizar 10 MB para hashear es peor. |
| D-18 | **`MovementCounter` y `StockChecker` se implementan en el plan 3**, sin esperar a `libs/inventory`. | Leen `movement` y `stock_balance`, y el `path` que `product-has-stock` necesita sale de un `innerJoin` contra `node`, que existe desde `full_schema`. Los adaptadores viven en `apps/tubodega/src/adapters/catalog/`, así que R-4 sigue intacta y `app.module.ts` nunca registra un stub. |
| D-19 | **La WAVE 2 se cierra en dos suites:** `w2a-cargar-el-catalogo` (plan 3, casos 1-11 y 16) y `w2-cargar-catalogo-y-ubicaciones` (plan 4, que absorbe la narrativa y añade 12-15). | La división en planes exige que cada uno cierre con algo probable por HTTP; un plan 3 sin HTTP de catálogo no lo cumplía. |
| D-20 | **Toda clave foránea se escribe compuesta `(org_id, x_id) REFERENCES x (org_id, id)`**, aunque [04 §3](docs/specs/04-persistencia.md) las dibuje simples: manda §2. | Postgres **no aplica RLS al comprobar una FK**. Con una clave simple, una organización podría apuntar un movimiento al `product_id` de otra y la política no lo vería nunca. Obliga a `@@unique([orgId, id])` en toda tabla de negocio, la auto-referencia `node.parent_id` y las dos de `movement` incluidas. |
| D-21 | **La suite de la WAVE 2 se reunifica en `w2-cargar-catalogo-y-ubicaciones.e2e-spec.ts` y renumera**: los cuatro de nodos entran como 12-15 y los que ocupaban esos números corren a 16-21. | D-19 decía «absorbe la narrativa entera», y la numeración del fichero se había desalineado de la tabla «E2E WAVE 2». Renumerar la realinea de una vez; el diff es grande pero mecánico. |
| D-22 | **`BOD-B` lleva `Z2`, no otro `Z1`**, en el reparto narrativo. | El `code` es único **por organización**, no por padre: el escáner no sabe bajo qué bodega está. `Z2` es además el destino al que el caso 13 mueve `E3`, así que la narrativa cuadra sola. |
| D-23 | **La caja negra de nodos va en `scripts/blackbox/25-ubicaciones.sh`**, suite propia. | El runner descubre por el glob `[0-9]*.sh`; una suite propia permite `--only ubicaciones` y no infla `20-catalogo.sh`, que ya tiene 428 líneas. |
| D-24 | **`UpdateNodeDto` declara `kind`, `code` y `parentId` como `?: never` con `@IsEmpty()`** y sin `@ApiProperty`. | `whitelist: true` solo elimina las propiedades **sin metadatos de validación**: una con decorador sobrevive al filtrado y se valida. Sin esto, mandar `kind` daría un `200` que no cambió nada. Sin `@ApiProperty` porque no son entrada aceptada y no deben salir en el contrato — y no hay plugin de Swagger que las cuele. |
| D-25 | **El `code` de un nodo es inmutable**, como el `kind`. | Es el segmento del `path`: cambiarlo convertiría cada `PATCH` en una reescritura de subárbol de coste no acotado que además puede dar `409 node-code-taken` sin anunciarlo. Es también la clave por la que el sembrador es idempotente. Misma forma que `UpdateProductDto`, que no lleva `sku`. |
| D-26 | **`SeedBoundaryNodes.execute(orgId)` no recibe `RequestContext`, no llama a `requireAction` y no publica eventos.** | Cuando corre no hay organización ni token ([07 §2](docs/specs/07-composicion-y-contexto-de-ejecucion.md)); un ctx con roles falsos sería una autorización que no puede fallar, o sea ninguna. La firma es la salvaguarda: un caso de uso que empieza por `OrgId` no se ata a un controlador por descuido. Y `organization.created` ya cuenta el hecho: nadie «creó» esos ocho. |
| D-27 | **`MoveNode` guarda primero el nodo movido y después reescribe el subárbol, y no abre `uow.run()`.** | `save` es la comprobación barata que puede fallar (`stale-version`, la FK del padre nuevo): no tiene sentido reescribir N filas antes de saber que pasa. Un savepoint solo sirve para sobrevivir a un error y seguir leyendo, y aquí un fallo debe deshacer el movimiento entero — la atomicidad de N-1+N-2 es la de la transacción del borde. |
| D-28 | **El `under` de `GET /v1/nodes` apuntando a un nodo inexistente es `400 invalid-filter`.** | El 404 de esta casa es para el recurso nombrado en la **ruta**; darlo por un parámetro de query diría que la colección se esfumó. Y una página vacía es indistinguible de «ese subárbol está vacío», así que un uuid mal tecleado pintaría «no hay nodos» para siempre. |
| D-29 | **`GET /v1/nodes/{id}/tree` incluye los inactivos, no limita la profundidad y limita el tamaño a 1000** (`422 tree-too-large`). | Omitir un estante retirado entre una zona activa y un bin activo dejaría huérfanos a sus hijos. Y es el único endpoint del módulo sin cursor: el árbol raíz de una organización de 500 nodos se serializaría entero en cada carga de panel. |
| D-30 | **`DELETE /v1/nodes/{id}` sobre un nodo con hijos activos es `422 node-has-children`.** | Ni cascada —un `DELETE` de un recurso no debe escribir N filas que el cliente no nombró— ni silencio, que dejaría un subárbol operable colgando de una zona que dice no operar, justo la incoherencia que N-3 previene. |
| D-31 | **`NodeRepository.save` devuelve la versión guardada**, y los casos de uso la propagan a la vista. | Lo encontró la colección de Postman: el `PATCH` devolvía la versión que traía la entidad en memoria, no la que quedó en la fila, así que un cliente que editaba dos veces con la versión recién recibida se llevaba un `409` fantasma. **Cerrada el 2026-09-12** (rama `fix/version-devuelta`): el molde se replicó en producto, campo propio y usuario. En tenancy el lock salió de la entidad y pasó a ser argumento de `save`, como en los otros tres agregados, y `UserView` expone por fin `version` —sin ella el `If-Match` obligatorio del `PATCH` de usuario no se podía obtener por API—. Queda como deuda latente, sin síntoma observable: `OrganizationRepository.save` descarta la fila igual, y los `POST` de creación devuelven la `version` codificada en el dominio, correcta por coincidencia con el `@default(1)` de la base y no por construcción. |
| D-32 | **`Quantity.of(raw)` rechaza el negativo; la aritmética interna no.** `minus` puede devolver una cantidad negativa, y `BalanceDelta.delta` lo es en el origen. | Las specs se contradicen: [12 §2](docs/specs/12-inventory.md) pide `of('-1') → error` y [12 §5](docs/specs/12-inventory.md) pide `delta: Quantity // con signo`. La lectura que las reconcilia es que `of()` es el parseo de una cantidad que escribió una persona, y ahí el negativo no tiene sentido, mientras que el signo es un resultado del álgebra de la partida doble. Que `isPositive()` exista en el contrato es la prueba de que el negativo es representable. |
| D-33 | **El `CHECK` de I-4 se llama `stock_balance_i4_non_negative`.** | F3.4 lo llamaba `stock_balance_quantity_check`, que no existe en la migración `full_schema`. Es el literal que compara el `catch` de `applyDelta`, así que equivocarlo convierte `insufficient-stock` en un 500. Corregido arriba. |
| D-34 | **`StockBalanceRepository` crece por adición**: `hasAnyStock` y `positionsIn` (plan 4, `quantity: string`) quedan intactos; el ledger añade `find`, `query`, `sumUnder`, `custodialTotal` y `applyDelta`, que devuelven `StockPosition` con `Quantity`. | Reescribir los dos primeros obligaría a tocar `DeactivateNode`, el C-9 de catálogo, `StockCheckerAdapter` y sus pruebas, ninguno de los cuales cambia de comportamiento. La misma regla que siguió el plan 4 con `positionsOfProduct`. |
| D-35 | **`InsufficientStockSignal` vive en el fichero del puerto y no extiende `DomainError`**; `RecordMovement` es el único sitio que lo convierte en `InsufficientStockError` (422). | Si extendiera `DomainError`, el filtro lo reconocería por duck typing y una señal escapada saldría al cliente como un problem+json sin `available` ni `requested`. Al no serlo, escaparse es un 500 ruidoso. El repositorio recuerda qué delta estaba aplicando: el error de Postgres nombra el constraint, no la fila. |
| D-36 | **`reason-required` (D-10) lo decide el dominio**, por el `code` de los nodos frontera `adjustment-in`, `adjustment-out` y `shrinkage`. | `Movement.create` recibe los dos nodos resueltos, así que tiene el `code` a mano. Una lista de uuids en el borde tendría que resolverlos otra vez y se desincronizaría del sembrador. |
| D-37 | **`GET /v1/movements` ordena solo por `occurredAt`, y por defecto descendente.** | Es el único campo con índice —`(org_id, occurred_at DESC)` y sus tres hermanos por nodo y producto—. Ofrecer `name` o `createdAt` como en los otros listados invitaría a un seq scan sobre la tabla que más crece del sistema. Descendente porque quien abre el histórico quiere lo último. |
| D-38 | **No hay puertos `ProductLookup` ni `BatchLookup`**: `RecordMovement` inyecta `PRODUCT_REPOSITORY` y `BATCH_REPOSITORY` de `@app/catalog` directamente. | R-2 permite `inventory → catalog`, y `CreateNode` ya inyecta `CUSTOM_FIELD_REPOSITORY` de catálogo tal cual. F3.3 pidió dos puertos puente y dos adaptadores antes de que existiera ese precedente; hoy serían cuatro ficheros y dos líneas de cableado para reexportar dos métodos que ya tienen la firma exacta que hace falta (`findById(orgId, id)`). |
| D-39 | **`RecordMovementBatch` no llama a `RecordMovement` N veces**: acumula los deltas de los N movimientos y hace un solo `applyDelta`. | N llamadas serían N savepoints y N upserts por posición, y dos movimientos sobre el mismo bin se bloquearían entre sí dentro de la misma transacción. Un solo `applyDelta` ordenado por clave natural es además lo único que hace cierta la promesa de «todo o nada» con el orden total que evita el interbloqueo. |
| D-40 | **`POST /v1/movements/{id}/reverse` responde 201** con el movimiento compensador y `Location`. | Sí crea un recurso nuevo: la compensación es un asiento más del ledger, con su propio id y su propia fila en el histórico. Es lo contrario de `/nodes/{id}/move`, que devuelve 200 porque no crea nada —el nodo ya estaba—. |
| D-11 | **`GET /v1/nodes/{id}/tree`** devuelve `{ node, children: [...] }` anidado. **`POST /v1/products/import`** recibe `{ rows: ProductRow[] }` con máximo 1000 filas por petición (`422 import-too-large`). El tope lo comprueba el caso de uso y **no** un `@ArrayMaxSize` en el DTO: con el validador en el borde la respuesta era `400 validation-failed`, y mil una filas se entienden perfectamente — lo que las rechaza es una regla de negocio ([03 §5](docs/specs/03-contrato-api.md)). | Forma no fijada por [12 §7](docs/specs/12-inventory.md) ni [11 §4](docs/specs/11-catalog.md). |
| D-12 | **Rate limit en memoria** (ventana deslizante por organización, una instancia). | [03 §11](docs/specs/03-contrato-api.md) solo exige la infraestructura con un límite generoso; un almacén compartido es una extensión. |

## 4. Mapa de archivos (estado final)

```
apps/tubodega/
  src/
    main.ts                              bootstrap: Fastify, ValidationPipe, OpenAPI, hooks
    app.module.ts                        raíz: enlaza puertos ↔ adaptadores
    http/
      pipeline/                          los pasos de 07 §3, transversales a todo recurso:
        trace-id.hook.ts                 X-Request-Id → traceId (UUID válido o v7)
        request-state.ts                 estado por petición en el request de Fastify
        params.decorators.ts             @Ctx (RequestContext definitivo), @Trace
        public.decorator.ts, auth.guard.ts
        transaction.interceptor.ts       runAs + set_config app.current_org + READ ONLY en GET
        identity.interceptor.ts          carga usuario y roles dentro de la tx (T-6)
        idempotency.interceptor.ts, idempotency.store.ts, canonical-hash.ts   (plan 2)
        validation.pipe.ts, problem-details.ts, domain-error.filter.ts       RFC 9457
        rate-limit.interceptor.ts                                            (plan 10)
      shared/                            shared.dto.ts (UserView, ProblemDetailsView…), views.ts,
                                         cursor-query.ts (limit/cursor/sort; invalid-filter)
      openapi/openapi.controller.ts      documento generado + snapshot
      <recurso>/                         una carpeta por recurso raíz de la URL, <recurso>.controller.ts
                                         y <recurso>.dto.ts; subrecursos con el padre. Plan 1: organizations/,
                                         auth/, me/. Después: users/, products/ (product-codes, batches,
                                         product-media, import), codes/, custom-fields/, uploads/, nodes/,
                                         movements/, stock/, process-templates/, process-instances/,
                                         alerts/, alert-rules/
    adapters/
      tenancy/org-provisioner.adapter.ts
      catalog/movement-counter.adapter.ts, stock-checker.adapter.ts
      process/resolve-code.adapter.ts, find-node.adapter.ts, find-product.adapter.ts,
              batch-creator.adapter.ts, movement-recorder.adapter.ts, media-attacher.adapter.ts
      alerts/expiring-batch-query.adapter.ts, overdue-custody-query.adapter.ts,
             alert-enricher.adapter.ts, org-iterator.adapter.ts
    jobs/outbox-dispatcher.job.ts (W1), alerts-evaluator.job.ts (W5), purge.job.ts (W6)
  test/
    edge/*.int-spec.ts                   interceptores contra la app real
    e2e/*.e2e-spec.ts                    una suite narrativa por wave + mvp-acceptance
  openapi.json                           snapshot versionado
libs/
  common/src/{ids.ts, result.ts, domain-error.ts, page.ts, events.ts, ports.ts, config/env.validation.ts, index.ts}
  tenancy/src/{domain,application,infrastructure}/…  test/{builders,doubles}/
  catalog/src/…      inventory/src/…      process/src/…      alerts/src/…
  persistence/
    prisma/schema.prisma, prisma/migrations/0001_initial/migration.sql
    src/generated/db.ts (gitignored)
    src/models/*.ts
    src/kysely/{kysely.factory.ts, transaction.context.ts, kysely.unit-of-work.ts}
    src/dao/base/{interfaces.ts, abstract-read.dao.ts, abstract-append.dao.ts, abstract-base.dao.ts,
                  org/*.ts, where.ts, keyset.ts, errors.ts}
    src/dao/*.dao.ts                     una concreción por tabla
    src/repositories/*.repository.ts
    src/outbox/outbox-event-publisher.ts
    src/persistence.module.ts, src/index.ts
    test/**/*.int-spec.ts
test/
  support/{env.ts, global-setup.ts, db.ts (withRollback), e2e/{app.ts, http.ts, tenant.ts, problem.ts}}
  invariants/*.prop-spec.ts
db/init/01-roles.sql                     roles y bases (dev, test, shadow); montado en compose
.dependency-cruiser.cjs
.github/workflows/ci.yml
```

## 5. Infraestructura de pruebas compartida

Se construye en W1 y la usan todas las waves. Firmas fijadas aquí porque ninguna fase posterior debe reinventarlas.

```ts
// test/support/db.ts — integración: cada prueba dentro de una transacción que se revierte
export async function withRollback<T>(
  fn: () => Promise<T>,
  opts?: { readonly pool?: 'tenant' | 'system'; readonly orgId?: OrgId },
): Promise<T>;   // abre vía KyselyUnitOfWork, ejecuta fn, lanza RollbackSentinel, lo traga

// test/support/e2e/app.ts
export async function startTestApp(): Promise<{ app: NestFastifyApplication; http: TestHttp; stop(): Promise<void> }>;

// test/support/e2e/http.ts — envuelve fastify.inject(); nunca toca la base
export interface TestHttp {
  get(url: string, o?: Req): Promise<Res>;
  post(url: string, body: unknown, o?: Req): Promise<Res>;     // Idempotency-Key v7 automática salvo idem: false
  patch(url: string, body: unknown, o?: Req & { ifMatch: number }): Promise<Res>;
  put(url: string, body: unknown, o?: Req & { ifMatch?: number }): Promise<Res>;
  del(url: string, o?: Req): Promise<Res>;
}
export interface Req { token?: string; idem?: string | false; headers?: Record<string, string>; multipart?: { field: string; filename: string; contentType: string; bytes: Buffer } }
// `registerOrg`, `login`, `refresh` y `logout` del helper llaman con `idem: false`: así cada suite demuestra
// de paso que los cuatro exentos de [07 §5] funcionan sin cabecera.
export interface Res { status: number; body: any; headers: Record<string, string> }

// test/support/e2e/tenant.ts — un negocio ficticio por suite
export async function registerOrg(http: TestHttp, o?: { slug?: string }): Promise<Tenant>;
export interface Tenant {
  readonly slug: string;
  readonly owner: Session;                       // OWNER
  user(role: 'ADMIN' | 'OPERATOR' | 'VIEWER', name?: string): Promise<Session>;  // crea vía POST /v1/users y hace login
}
export interface Session { readonly token: string; readonly refreshToken: string; readonly userId: string; readonly email: string }
export function expiredToken(s: Session): string;   // firma con el JWT_SECRET de .env.test y exp en el pasado; no toca la base

// test/support/e2e/problem.ts
export function expectProblem(res: Res, expected: { status: number; type: string; pointer?: string }): void;
```

Reparto narrativo usado por todas las suites e2e (para que se lean como un caso real):

| Elemento | Valor |
|---|---|
| Organización | `distribuidora-la-esquina` — vende consumibles y presta herramienta |
| Personas | Marta (OWNER), Diego (ADMIN), Juan (OPERATOR, también tenedor `CUSTODY:juan`), Sofía (VIEWER) |
| Productos | `TOR-M8` tornillo M8 (`QUANTITY`, `UNIT`) · `ARROZ-25` saco de arroz (`QUANTITY`, `KG`) · `LECHE-1L` (`LOT`, vence) · `TAL-BOSCH` taladro (`SERIAL`) |
| Ubicaciones | `BOD-A` › `MUELLE`; `BOD-A` › `Z1` › `E3` › `B2`, `B3`; `BOD-B` › `Z2` (D-22: el `code` es único por organización, no por padre, así que `BOD-B` no puede llevar otro `Z1`) |
| Nodos de frontera | sembrados: `supplier-default`, `adjustment-in`, `opening-balance`, `sale`, `consumption`, `shrinkage`, `adjustment-out`, `supplier-return` |

---

## WAVE 1 — «Abrir el negocio» (cimientos, borde y tenancy)

**Habilita:** registrar una organización, autenticarse, administrar usuarios y roles, y todas las garantías transversales (RLS, idempotencia, `problem+json`, `traceId`, OpenAPI, outbox). Es la wave más larga porque todo lo demás se apoya en ella.

### F1.0 — Herramientas, base de datos local y puertas de CI

**Entrega:** dependencias de D-8; Postgres 16 en `compose.yaml` con los tres roles y tres bases (`tubodega`, `tubodega_test`, `tubodega_shadow`); variables de entorno de [07 §9](docs/specs/07-composicion-y-contexto-de-ejecucion.md) validadas; `vitest.config.e2e.ts` con los tres sufijos; `tsconfig.typecheck.json` incluye `test/`; `dependency-cruiser` con R-1..R-4; workflow de CI con las cinco puertas.

**Archivos:**
- Modify: `package.json` (deps + scripts `db:migrate`, `db:check`, `db:generate`, `openapi:write`, `lint` = oxlint + depcruise), `compose.yaml` (servicio `db` + volumen `db/init`), `.env.example`, `vitest.config.e2e.ts`, `tsconfig.typecheck.json`, `nest-cli.json` (proyectos `persistence`, `tenancy`, `catalog`, `inventory`, `process`, `alerts`), `tsconfig.json` (alias a cada `index.ts`), `libs/common/src/config/env.validation.ts`
- Create: `db/init/01-roles.sql`, `.dependency-cruiser.cjs`, `.github/workflows/ci.yml`, `.env.test`, `test/support/env.ts`, `test/support/global-setup.ts`

**Interfaces:**
- Produce: `EnvironmentVariables` con `DATABASE_URL`, `DATABASE_URL_SYSTEM`, `DATABASE_URL_MIGRATOR`, `SHADOW_DATABASE_URL` (opcional; solo desarrollo y CI), `DATABASE_POOL_SIZE=10` (el pool de sistema es siempre 3 y el de idempotencia siempre 2, D-9), `JWT_SECRET (≥32)`, `JWT_ACCESS_TTL='15m'`, `JWT_REFRESH_TTL='30d'`, `MEDIA_ROOT`, `OUTBOX_INTERVAL_MS=1000`, `ALERTS_INTERVAL_MS=300000`, `RATE_LIMIT_PER_MINUTE=600` (tipos y defaults de [07 §9](docs/specs/07-composicion-y-contexto-de-ejecucion.md)).
- Produce: `db/init/01-roles.sql` — `tubodega_migrator` (LOGIN, dueño de las tres bases), `tubodega_app` (LOGIN, NOBYPASSRLS), `tubodega_system` (LOGIN, BYPASSRLS).

**Pasos:**
- [ ] Añadir dependencias; `pnpm install` limpio.
- [ ] `compose.yaml`: servicio `db` (`postgres:16`, healthcheck, `./db/init:/docker-entrypoint-initdb.d`).
- [ ] `env.validation.ts`: una prueba por variable (valor por defecto, valor inválido aborta).
- [ ] `.dependency-cruiser.cjs`: reglas `domain-is-pure`, `no-cycles`, `only-barrels`, `persistence-not-imported`; probar con un import prohibido temporal y ver que `pnpm lint` falla; retirarlo.
- [ ] `vitest.config.e2e.ts`: `include: ['**/*.int-spec.ts','**/*.e2e-spec.ts','**/*.prop-spec.ts']`, `globalSetup` que carga `.env.test` (solo valores de prueba; se versiona), aplica `prisma migrate deploy` sobre `tubodega_test` y comprueba que los tres roles existen. Los archivos corren en paralelo: las suites e2e crean organizaciones con `slug` aleatorio y las de integración usan `withRollback`, así que no comparten estado.
- [ ] `ci.yml`: servicio Postgres + `pnpm lint`, `typecheck`, `db:check`, `test`, `test:e2e`.

**Pruebas:** dominio (`env.validation.spec.ts`). El resto es verificación manual de comandos.

**Hecho cuando:** `docker compose up -d db && psql … -c '\du'` muestra los tres roles; `pnpm lint && pnpm typecheck && pnpm test` pasan; CI corre en un push de rama.

### F1.1 — `libs/common`: tipos del núcleo

**Entrega:** los tipos de [01 §4](docs/specs/01-arquitectura.md) más D-4. Se elimina `CommonService`/`CommonModule` placeholder.

**Archivos:**
- Create: `libs/common/src/{brand.ts, ids.ts, result.ts, domain-error.ts, page.ts, events.ts, ports.ts}`, specs junto a cada uno
- Modify: `libs/common/src/index.ts`
- Delete: `libs/common/src/common.service.ts`, `common.service.spec.ts`, `common.module.ts`

**Interfaces (produce):**
```ts
type Branded<T, K extends string> = T & { readonly __brand: K };
type OrgId = Branded<string,'OrgId'>; type UserId = Branded<string,'UserId'>;
type TraceId = Branded<string,'TraceId'>; type ProcessInstanceId = Branded<string,'ProcessInstanceId'>;
type Cursor = Branded<string,'Cursor'>;
type Result<T, E extends DomainError = DomainError> = { ok: true; value: T } | { ok: false; error: E };
const ok, err, unwrap;                                   // helpers
abstract class DomainError extends Error { abstract readonly type: string; abstract readonly status: number; readonly errors?: ProblemFieldError[]; readonly extensions?: Record<string, unknown> }
interface Page<T> { data: readonly T[]; nextCursor?: Cursor; hasMore: boolean }
const encodeCursor(parts: readonly (string|number|null)[]): Cursor; decodeCursor(c: Cursor): readonly (string|number|null)[] | null;
interface DomainEvent { id; type; orgId: OrgId; traceId: TraceId; occurredAt: Date; data: Record<string, unknown> }
interface Clock { now(): Date }  interface IdGenerator { next(): string }
interface UnitOfWork { run<T>(fn: () => Promise<T>, opts?: { readOnly?: boolean }): Promise<T> }
interface EventPublisher { publish(events: readonly DomainEvent[]): Promise<void> }
const CLOCK, ID_GENERATOR, UNIT_OF_WORK, EVENT_PUBLISHER: symbols de inyección
```

**Pruebas:** dominio — `Result` helpers; `encodeCursor`/`decodeCursor` ida y vuelta y cursor corrupto → `null`; `DomainError` concreta expone `type`/`status`.

**Hecho cuando:** `pnpm test` verde; `pnpm typecheck` verde; `libs/common` no importa NestJS salvo en `config/`.

### F1.2 — Esquema completo: `schema.prisma` + migración `0001_initial`

**Entrega:** todas las tablas y enums de [04 §3](docs/specs/04-persistencia.md); el SQL manual de [04 §5.1](docs/specs/04-persistencia.md); tipos Kysely generados; `pnpm db:check` verde.

**Archivos:**
- Create: `libs/persistence/prisma/schema.prisma` (generator `prisma-kysely` → `../src/generated/db.ts`, `camelCase = true`; `previewFeatures = ["postgresqlExtensions"]`, `extensions = [citext]`; `@@map`/`@map` en todo; FK compuestas `(orgId, xId) → (orgId, id)`; `@@unique([orgId, id])` en toda tabla de negocio), `libs/persistence/prisma/migrations/0001_initial/migration.sql`, `libs/persistence/tsconfig.lib.json`, `.gitignore` (+`libs/persistence/src/generated/`)
- Modify: `package.json` scripts (`db:generate`: `prisma generate`; `db:migrate`: `prisma migrate dev`; `db:deploy`: `prisma migrate deploy`; `db:check`: `prisma migrate diff --from-migrations … --to-schema-datamodel … --shadow-database-url … --exit-code`)

**Bloques manuales del `migration.sql`** (cada uno con su invariante; el ejecutor los copia de [04](docs/specs/04-persistencia.md)):
1. `CHECK`s de `movement` (I-1, I-2, I-8, I-11, I-14, I-17 ×2), `stock_balance` (I-4), `node` (I-10), `batch` (C-3), `alert_rule.threshold_days >= 0`.
2. Únicos e índices parciales: `movement (org_id, reverses_id) WHERE reverses_id IS NOT NULL` (I-13); `batch` lot/serial parciales; `alert` A-1 parcial; `refresh_token`, `media_upload`, `stock_balance` parciales; `movement` due/settles parciales; `outbox_event` pendiente.
3. `stock_balance` clave natural `UNIQUE … NULLS NOT DISTINCT`.
4. `ENABLE` + `FORCE ROW LEVEL SECURITY` y `CREATE POLICY org_isolation` en **toda** tabla con `org_id` (no en `organization`).
5. `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES … TO tubodega_app, tubodega_system` + `ALTER DEFAULT PRIVILEGES`; luego `REVOKE UPDATE, DELETE ON movement FROM tubodega_app, tubodega_system`.

**Pruebas:** ninguna de código en esta fase; la F1.5 prueba que cada bloque llegó a la base.

**Hecho cuando:** `pnpm db:migrate` sobre base vacía aplica; `pnpm db:generate` produce `db.ts` con las 20 tablas en camelCase; `pnpm db:check` sale 0; editar una columna en el schema sin migrar hace que `db:check` salga ≠ 0 (probar y revertir).

### F1.3 — Kysely: fábrica de pools, contexto de transacción y `UnitOfWork`

**Entrega:** `KyselyFactory` (tres `Kysely<DB>`: tenant (10), sistema (3) y detached (2, D-9), `CamelCasePlugin`), `TransactionContext` (`AsyncLocalStorage<ControlledTransaction>`), `KyselyUnitOfWork` implementando el puerto y las extensiones de infraestructura de D-9 y D-13.

**Archivos:**
- Create: `libs/persistence/src/kysely/{kysely.factory.ts, transaction.context.ts, kysely.unit-of-work.ts, errors.ts}`, `libs/persistence/src/persistence.module.ts`, `libs/persistence/src/index.ts`, `libs/persistence/test/kysely/unit-of-work.int-spec.ts`, `test/support/db.ts`

**Interfaces (produce):**
```ts
class TransactionContext { current(): ControlledTransaction<DB> /* lanza NoActiveTransactionError */; runWith<T>(tx, fn): Promise<T> }
class KyselyUnitOfWork implements UnitOfWork {
  run<T>(fn, opts?: { readOnly?: boolean }): Promise<T>;                       // sin tx: error de composición; con tx: SAVEPOINT
  runAs<T>(scope: { pool: 'tenant'; orgId: OrgId } | { pool: 'system'; orgId?: OrgId }, fn, opts?: { readOnly?: boolean }): Promise<T>;
                                   // abre tx raíz; con orgId ⇒ SET LOCAL app.current_org (tenant siempre; sistema por organización, [07 §6])
  runDetached<T>(scope: { orgId: OrgId }, fn): Promise<T>;                     // tx corta en el pool dedicado de D-9, ALS nuevo
}
class NoActiveTransactionError extends Error
```
Decisión D-13: `run()` **sin** transacción activa lanza `NoActiveTransactionError`. El borde y los jobs usan `runAs`.

**Pruebas (integración):** `run()` sin tx lanza; `runAs` tenant fija `current_setting('app.current_org')`; `run()` anidado crea savepoint y su fallo no aborta la tx externa (un `INSERT` posterior funciona); `readOnly` rechaza un `INSERT` con `25006`; `runDetached` no ve filas no confirmadas de la tx ambiental; `withRollback` deja la base como estaba.

**Hecho cuando:** `pnpm test:e2e libs/persistence/test/kysely` verde.

### F1.4 — DAO genérico y familia Org

**Entrega:** jerarquía de [08 §3-§6](docs/specs/08-acceso-a-datos.md): interfaces `IReadDao/IAppendDao/IBaseDao` y `IOrg*`, clases abstractas planas y Org (por composición), DSL `where` con escape, `findPage` keyset con cursor opaco, bloqueo optimista, mapeo de errores de `pg` (`23505` → `UniqueViolationError(constraint)`, `23514` → `CheckViolationError(constraint)`, `23503` → `ForeignKeyViolationError`), `RecordNotFoundError`, `VersionConflictError`. Dos concreciones para probar: `UserDao` (con `findByEmailGlobal`) y `AlertRuleDao` (clave `{ kind }`). Prueba de tipo para `AbstractOrgAppendDao`.

**Archivos:**
- Create: `libs/persistence/src/dao/base/{interfaces.ts, where.ts, keyset.ts, errors.ts, abstract-read.dao.ts, abstract-append.dao.ts, abstract-base.dao.ts, org/abstract-org-read.dao.ts, org/abstract-org-append.dao.ts, org/abstract-org.dao.ts}`, `libs/persistence/src/dao/{user.dao.ts, alert-rule.dao.ts}`, `libs/persistence/src/models/{user.model.ts, alert-rule.model.ts}`, `libs/persistence/test/dao/{generic.int-spec.ts, org-generic.int-spec.ts, where.spec.ts, append-only.type-spec.ts}`

**Interfaces:** exactamente las de [08 §4-§5](docs/specs/08-acceso-a-datos.md). `where.ts` exporta `compileWhere(eb, where)` puro (probable sin base, con `sql.compile`).

**Pruebas:**
- Dominio: `where.spec.ts` — cada operador del DSL con el SQL que produce (tabla de [08 §5](docs/specs/08-acceso-a-datos.md)); `in: []` produce `FALSE`; `contains` escapa `%` y `_`.
- Integración (contra `app_user` y `alert_rule`): cada método del contrato; `findPage` tres páginas con inserciones entre medias sin saltos ni repeticiones; `update` con `expectedVersion` errónea → `VersionConflictError`, con id inexistente → `RecordNotFoundError`; `23505` → `UniqueViolationError` con el nombre del constraint; DAO fuera de `run()` → `NoActiveTransactionError`.
- Tipo: `expectTypeOf<AbstractOrgAppendDao<'movement', string>>().not.toHaveProperty('update')` (idem `upsert`, `delete`).

**Hecho cuando:** suites verdes; `pnpm typecheck` verde incluyendo el type-spec.

### F1.5 — Pruebas de que el SQL manual llegó a la base

**Entrega:** una suite por bloque de F1.2, con inserciones crudas vía Kysely (pool de sistema) dentro de `withRollback`.

**Archivos:**
- Create: `libs/persistence/test/schema/{checks.int-spec.ts, rls.int-spec.ts, revoke.int-spec.ts, composite-fk.int-spec.ts, nulls-not-distinct.int-spec.ts, partial-unique.int-spec.ts}`, `libs/persistence/test/support/raw-rows.ts` (constructores de filas mínimas: `rawOrg()`, `rawUser()`, `rawProduct()`, `rawNode()`, `rawMovement()`)

**Pruebas (integración):**
- `checks`: una prueba por `CHECK` (I-1, I-2, I-4, I-8, I-10, I-11, I-14, I-17a, I-17b, C-3, `threshold_days`), cada una viola y espera `23514` con el nombre del constraint.
- `rls`: por cada tabla con `org_id` (19), con `SET LOCAL app.current_org = orgB` un `SELECT *` sin filtro devuelve 0 filas de orgA, y un `INSERT` con `org_id = orgA` falla `42501`. Con el pool de sistema, ve ambas. Sin `app.current_org` fijado, el pool de tenant falla.
- `revoke`: `UPDATE movement` y `DELETE FROM movement` fallan con `42501` con `tubodega_app` y con `tubodega_system`.
- `composite-fk`: `INSERT movement` con `product_id` de orgB y `org_id` de orgA falla `23503` aunque RLS lo permitiera (pool de sistema).
- `nulls-not-distinct`: dos `INSERT … ON CONFLICT (org_id,node_id,product_id,batch_id) DO UPDATE` con `batch_id NULL` dejan una fila.
- `partial-unique`: I-13 (dos compensaciones del mismo movimiento → `23505`), A-1 (dos alertas abiertas iguales → `23505`; una resuelta y una abierta conviven).

**Hecho cuando:** 6 suites verdes. Esta fase es la evidencia de [04 §5.1](docs/specs/04-persistencia.md) último párrafo.

### F1.6 — Tenancy: dominio

**Entrega:** entidades y reglas de [10 §2-§3](docs/specs/10-tenancy.md).

**Archivos:**
- Create: `libs/tenancy/src/domain/{ids.ts (Email, Slug + normalizadores), role.ts (Role, Action, PERMISSIONS), organization.ts, user.ts, request-context.ts, token-claims.ts, errors.ts}`, specs junto a cada uno; `libs/tenancy/src/index.ts`; `libs/tenancy/test/builders/{a-user.ts, an-organization.ts}`

**Interfaces (produce):** `Role`, `Action`, `User.can(action)`, `User.withRoles(roles, activeOwnersInOrg: number): Result<User>` y `User.deactivate(activeOwnersInOrg: number): Result<User>` — **T-2 vive en el dominio** ([10 §10](docs/specs/10-tenancy.md)): reciben el conteo de `OWNER` activos que el caso de uso lee del repositorio y devuelven `last-owner` si la operación dejaría cero; `Email.of(raw): Result<Email>` (minúsculas, formato), `Slug.of(raw): Result<Slug>` (3-64, `[a-z0-9-]`), `RequestContext`, `TokenClaims`. Errores: `InvalidEmail`, `InvalidSlug`, `LastOwnerError(422 last-owner)`, `InsufficientRoleError(403 insufficient-role)`.

**Pruebas (dominio):** la matriz de permisos completa (8 acciones × 4 roles = 32 casos, generados desde la tabla); normalización de correo (`Marta@X.com` → `marta@x.com`); slug válido/inválido en fronteras (2, 3, 64, 65 caracteres, mayúsculas); `can(READ)` para todos; **T-2**: desactivar al único OWNER activo (`activeOwnersInOrg = 1`) → `last-owner`; con 2 → ok; retirar `OWNER` de un usuario que no lo tiene no cuenta.

**Hecho cuando:** `pnpm test libs/tenancy` verde; cobertura de `domain/` ≥ 95 %.

### F1.7 — Tenancy: casos de uso con dobles

**Entrega:** `CreateOrganization`, `Authenticate`, `RefreshSession`, `Logout`, `CreateUser`, `UpdateUserRoles`, `DeactivateUser`, `ChangePassword` ([10 §4](docs/specs/10-tenancy.md)); puertos de [10 §5](docs/specs/10-tenancy.md); dobles en memoria.

**Archivos:**
- Create: `libs/tenancy/src/application/ports/{organization.repository.ts, user.repository.ts, session.repository.ts, password-hasher.ts, token-issuer.ts, org-provisioner.ts}`, `libs/tenancy/src/application/use-cases/*.ts` (+spec cada uno), `libs/tenancy/src/application/authorize.ts` (`requireAction(ctx, action)` → lanza `InsufficientRoleError`), `libs/tenancy/test/doubles/{in-memory-organization.repository.ts, in-memory-user.repository.ts, in-memory-session.repository.ts, fake-password-hasher.ts, fake-token-issuer.ts, fixed-clock.ts, sequential-id-generator.ts, in-memory-event-publisher.ts, noop-unit-of-work.ts, recording-org-provisioner.ts}`

**Interfaces:**
- Consume: `UnitOfWork`, `Clock`, `IdGenerator`, `EventPublisher` de `@app/common`.
- Produce: los puertos con las firmas de [10 §5](docs/specs/10-tenancy.md) (`UserRepository.findById(orgId, id)` — el `orgId` va explícito, como en [08 §7](docs/specs/08-acceso-a-datos.md)); `Session { id; userId; orgId; tokenHash; expiresAt; revokedAt? }`; eventos `organization.created`, `user.created`, `user.roles_changed`, `user.deactivated`.
- `Authenticate` acepta `slug?` para desambiguar; devuelve `ambiguous-login` si hay más de un candidato con contraseña válida y no hay `slug`.
- `RefreshSession`: hash SHA-256 del token opaco; revoca el usado y emite par nuevo; rechaza revocado/vencido con `refresh-token-invalid`; **rechaza también si el usuario está inactivo** (T-6 aplica a la rotación, no solo al acceso).
- `TokenIssuer.verify(token): { ok: true; claims } | { ok: false; reason: 'expired' | 'invalid' }` para que el guard distinga `401 token-expired` de `401 invalid-credentials` ([10 §9](docs/specs/10-tenancy.md)).

**Pruebas (aplicación):** creación con `RecordingOrgProvisioner` (se invoca una vez, con el id nuevo, antes de emitir `organization.created`); slug tomado → `slug-taken`; login correcto/incorrecto/inactivo → mismo `invalid-credentials`; login ambiguo entre dos organizaciones → `ambiguous-login`, y con `slug` resuelve; refresh rota (el anterior queda revocado) y reutilizar el anterior falla; refresh de un usuario desactivado → `refresh-token-invalid`; `DeactivateUser` del último OWNER → `last-owner`; `UpdateUserRoles` que retira OWNER al único → `last-owner`; `CreateUser` sin `MANAGE_USERS` → `insufficient-role`; `email-taken` en la misma organización, permitido en otra.

**Hecho cuando:** `pnpm test libs/tenancy` verde; cobertura de `application/` ≥ 90 %.

### F1.8 — Tenancy: persistencia y adaptadores técnicos

**Entrega:** DAOs `organization`, `app_user` (ya), `user_role`, `refresh_token`; repositorios Kysely; `Argon2PasswordHasher`; `JoseTokenIssuer`; `SystemClock`; `Uuidv7Generator`; `KyselyOutboxEventPublisher` (D-5).

**Archivos:**
- Create: `libs/persistence/src/dao/{organization.dao.ts, user-role.dao.ts, refresh-token.dao.ts, outbox-event.dao.ts}`, `libs/persistence/src/repositories/{organization.repository.ts, user.repository.ts, session.repository.ts}`, `libs/persistence/src/outbox/outbox-event-publisher.ts`, `libs/tenancy/src/infrastructure/{argon2-password-hasher.ts, jose-token-issuer.ts}`, `libs/common/src/infrastructure/{system-clock.ts, uuidv7-generator.ts}`, `libs/persistence/test/repositories/{user.repository.int-spec.ts, session.repository.int-spec.ts}`, `libs/tenancy/src/infrastructure/*.spec.ts`

**Pruebas:**
- Integración: `findByEmailGlobal` con pool de sistema encuentra el correo en dos organizaciones; **con el pool de tenant y sin `app.current_org` fijado, la consulta falla** (RLS con `FORCE`, [10 §10](docs/specs/10-tenancy.md), [04 §4](docs/specs/04-persistencia.md)); T-1 bajo concurrencia (dos `save` con el mismo correo en la misma org, uno gana con `email-taken`); `countActiveOwners`; sesión revocada no se encuentra como válida.
- Sin infra: `JoseTokenIssuer` emite y verifica; token expirado → `{ ok: false, reason: 'expired' }`; firma ajena → `{ ok: false, reason: 'invalid' }`. `Argon2PasswordHasher` verifica y rechaza.

**Hecho cuando:** suites verdes.

### F1.9 — El borde (a): traza, guard, transacción, identidad, filtro de errores, validación

**Entrega:** los pasos 1-4, 6 y 9 de [07 §3](docs/specs/07-composicion-y-contexto-de-ejecucion.md) sobre un endpoint mínimo `GET /v1/me`.

**Archivos:**
- Create: `apps/tubodega/src/http/pipeline/{trace-id.hook.ts, request-state.ts, params.decorators.ts, auth.guard.ts, public.decorator.ts, transaction.interceptor.ts, identity.interceptor.ts, problem-details.ts, domain-error.filter.ts, validation.pipe.ts}`, `apps/tubodega/src/http/me/{me.controller.ts, me.dto.ts}`, `apps/tubodega/test/edge/{trace-id.int-spec.ts, pipeline-order.int-spec.ts, problem-json.int-spec.ts}`, `test/support/e2e/{app.ts, http.ts, problem.ts}`
- Modify: `apps/tubodega/src/main.ts` (prefijo `v1`, hooks Fastify, `ValidationPipe` con `whitelist: true, forbidNonWhitelisted: false, transform: true` que emite `problem+json` `400 validation-failed` con `errors[].pointer` — cambia el `forbidNonWhitelisted: true` del scaffold por D-10), `apps/tubodega/src/app.module.ts` (registra `PersistenceModule`, `TenancyModule`, interceptores globales en orden)
- Delete: `app.controller.ts`, `app.service.ts`, specs del scaffold, `test/app.e2e-spec.ts`

**Interfaces (produce):**
- `@Public()` (sin guard; el `TransactionInterceptor` abre con `pool:'system'` — son exactamente los tres casos de uso de la lista cerrada de [07 §2](docs/specs/07-composicion-y-contexto-de-ejecucion.md) que corren por HTTP); por defecto tenant con `orgId` del token. No hay un tercer modo.
- `RequestContextStore` (ALS) con `{ traceId, claims?, ctx?: RequestContext }`; `@Ctx()` param decorator que entrega el `RequestContext` definitivo.
- `DomainErrorFilter`: `DomainError` → `problem+json` (`type` = `https://tubodega.app/errors/<type>`, `instance` = ruta, `traceId`); `VersionConflictError` → `409 stale-version`; `HttpException` de Nest → problem equivalente; resto → `500 internal` sin detalles, log con `traceId`.
- Respuesta siempre con `X-Request-Id`.

**Pruebas (integración del borde, app real):**
- `trace-id`: `X-Request-Id` UUID válido se respeta; `req-123` se sustituye por v7 y vuelve en la respuesta; aparece en el `problem+json`.
- `pipeline-order` (T-5): un controlador de prueba registrado solo en test lee `current_setting('app.current_org', true)` a través de un DAO → coincide con el `org` del token; el mismo controlador con `@Public()` y pool de sistema lee `NULL`. Un `GET` intenta `INSERT` → `25006` (READ ONLY). **Orden equivocado** ([06 §5](docs/specs/06-pruebas-y-calidad.md)): un módulo de prueba que registra el `TransactionInterceptor` *después* de un interceptor que consulta `app_user` demuestra que esa consulta no ve ninguna fila (o falla por RLS); es la prueba de que el orden de registro en `app.module.ts` no es cosmético.
- `identity` (T-6): usuario desactivado directamente por repositorio (integración, no e2e) con token vigente → `401 invalid-credentials`; roles vienen de la base aunque el token diga otra cosa.
- `auth-guard`: token vencido → `401 token-expired`; firma inválida o ausente → `401 invalid-credentials`.
- `problem-json`: `DomainError` de prueba → forma completa; error no previsto → `500` sin stack; DTO inválido → `400 validation-failed` con `pointer`.

**Hecho cuando:** `GET /v1/me` con token real devuelve usuario y organización; suites verdes.

### F1.10 — El borde (b): idempotencia

**Entrega:** `IdempotencyInterceptor` + `IdempotencyStore` con la secuencia A/B/C de [07 §5](docs/specs/07-composicion-y-contexto-de-ejecucion.md) y el hash canónico.

**Archivos:**
- Create: `apps/tubodega/src/http/pipeline/{idempotency.interceptor.ts, idempotency.store.ts, canonical-hash.ts, idempotency-exempt.decorator.ts}`, `libs/persistence/src/dao/idempotency-key.dao.ts` (`reserve(orgId, key, hash, now)`: `INSERT … ON CONFLICT DO NOTHING RETURNING *`, luego lectura si no devolvió; `takeOverAbandoned`), `apps/tubodega/src/http/pipeline/canonical-hash.spec.ts`, `apps/tubodega/test/edge/idempotency.int-spec.ts`

**Interfaces:** errores `400 missing-idempotency-key`, `409 idempotency-key-reuse`, `409 idempotency-key-in-flight`; cabecera `Idempotency-Replayed: true` en replay; `@IdempotencyExempt()` en los cuatro endpoints exentos (los `@Public()` lo son implícitamente; `logout` lo declara).

**Pruebas:**
- Dominio: `canonicalHash` ordena claves recursivamente y elimina espacios; el mismo objeto con orden distinto da el mismo hash; multipart hashea bytes.
- Integración (I-7): dos peticiones simultáneas con la misma clave a un endpoint de prueba lento → una `201`, otra `409 idempotency-key-in-flight`; tras terminar, repetir → replay con la misma respuesta y `Idempotency-Replayed: true`; mismo `key` + cuerpo distinto → `409 idempotency-key-reuse`; fila `IN_FLIGHT` con `created_at` de hace 6 min (insertada por integración) se re-reserva; si el handler falla, la clave se libera y el reintento se procesa; `POST` sin cabecera → `400`; `GET` no exige nada.

**Hecho cuando:** suite verde; la reserva y la confirmación son observables en `idempotency_key` dentro de la prueba.

### F1.11 — Tenancy HTTP, paginación, OpenAPI y outbox

**Entrega:** los 10 endpoints de [10 §7](docs/specs/10-tenancy.md); helper de paginación/filtros; documento OpenAPI en `/v1/openapi.json` con snapshot; despachador de outbox como job.

**Archivos:**
- Create: `apps/tubodega/src/http/{organizations,auth,users,me}/<recurso>.controller.ts` y `<recurso>.dto.ts`, `apps/tubodega/src/http/shared/cursor-query.ts` (+spec), `apps/tubodega/src/http/openapi/openapi.controller.ts`, `apps/tubodega/openapi.json`, `apps/tubodega/src/adapters/tenancy/org-provisioner.adapter.ts` (lista de sembradores vacía, D-2), `apps/tubodega/src/jobs/outbox-dispatcher.job.ts`, `apps/tubodega/test/edge/openapi.int-spec.ts`, `libs/persistence/test/outbox/dispatcher.int-spec.ts`, `test/support/e2e/tenant.ts`
- Modify: `app.module.ts`, `main.ts`

**Interfaces:**
- `parsePage(query, { sortable: [...], filters: {...} })` → `{ limit, cursor, sort }` o lanza `400 invalid-filter` (D-10).
- `OutboxDispatcherJob`: `runAs({pool:'system'})`, `FOR UPDATE SKIP LOCKED LIMIT 100`, escribe en log, marca `published_at`; intervalo `OUTBOX_INTERVAL_MS`; expone `tick()` para pruebas. **Regla para todos los jobs desde aquí:** con `NODE_ENV=test` se registran pero no arrancan su intervalo; las pruebas invocan `tick()`.
- `pnpm openapi:write` regenera el snapshot; la prueba compara el documento generado con el archivo y falla si difiere.

**Pruebas:** integración — `dispatcher.int-spec` (dos ticks concurrentes no publican dos veces; el evento marcado no se relee); `openapi.int-spec` (todo endpoint declara al menos una respuesta de error y todo schema lleva `example`; el documento coincide con el snapshot). Dominio — `cursor-query.spec` (defaults 50/200, `sort=-name`, campo no permitido → `invalid-filter`).

**Hecho cuando:** los endpoints responden; `pnpm test:e2e apps/tubodega/test/edge` verde.

### E2E WAVE 1 — `apps/tubodega/test/e2e/w1-abrir-el-negocio.e2e-spec.ts`

Narrativa: Marta registra «Distribuidora La Esquina», invita a Diego, Juan y Sofía, y el sistema demuestra sus garantías transversales. Solo API pública.

| # | Caso de uso real | Llamadas | Afirmaciones |
|---|---|---|---|
| 1 | Marta registra el negocio | `POST /v1/organizations` sin `Idempotency-Key` | `201`, `Location`, cuerpo con organización y owner; slug repetido → `409 slug-taken` |
| 2 | Marta inicia sesión y ve su perfil | `POST /v1/auth/login` (sin `Idempotency-Key`), `GET /v1/me`; `GET /v1/me` con un token firmado con `JWT_SECRET` de prueba y `exp` pasado (lo emite el helper `expiredToken()`), y con un token de firma inventada | tokens; `/me` devuelve roles `[OWNER]` y la organización; contraseña errónea → `401 invalid-credentials` con la misma forma; `401 token-expired`; `401 invalid-credentials` |
| 3 | Marta da de alta al equipo | `POST /v1/users` ×3 (ADMIN, OPERATOR, VIEWER) | `201`; `GET /v1/users?role=OPERATOR` filtra; `GET /v1/users?foo=1` → `400 invalid-filter`; correo repetido → `409 email-taken` |
| 4 | Sofía (VIEWER) intenta administrar | `POST /v1/users` con token de Sofía | `403 insufficient-role` |
| 5 | Diego actualiza roles con control de versión | `PATCH /v1/users/{juan}` con `If-Match` correcto y luego con el viejo | `200` y luego `409 stale-version`; sin `If-Match` → `400 missing-if-match` |
| 6 | Nadie puede dejar la empresa sin dueño | `DELETE /v1/users/{marta}` | `422 last-owner` |
| 7 | Se revoca el acceso de alguien | `DELETE /v1/users/{sofia}` y luego `GET /v1/me` con el token de Sofía | `204`; `401 invalid-credentials` inmediato (T-6) |
| 8 | Sesión larga: refresco y cierre | `POST /v1/auth/refresh` ×2 con el mismo token, `POST /v1/auth/logout`, refresh tras logout | segundo refresh `401 refresh-token-invalid`; logout `204` (sin `Idempotency-Key`, exento); refresh posterior `401` |
| 8b | Juan cambia su contraseña | `POST /v1/me/password {current, next}` con la actual errónea y luego correcta; login con la nueva y con la vieja | `401 invalid-credentials`; `204`; `200`; `401` |
| 9 | Otra empresa no ve nada | segunda `registerOrg` (mismo correo de Juan, permitido: T-1 es por organización); su token pide `GET /v1/users/{juan}` y `PATCH` | `201` con el correo repetido; `404` en ambos, nunca `403` (I-6) |
| 9b | Login con correo en dos empresas | `POST /v1/auth/login` con el correo de Juan sin `slug`; con `slug` | `409 ambiguous-login`; `200` con la organización correcta en `/me` |
| 10 | Nadie elige su organización | `POST /v1/users` con `orgId` de otra org en el cuerpo; `GET /v1/users?orgId=…` | `400 validation-failed` con `pointer:/orgId`; `400 invalid-filter` (T-4, D-10); en ningún caso aparece nada en la otra organización |
| 11 | Reintentos seguros | `POST /v1/users` con la misma clave dos veces; misma clave, otro cuerpo; sin clave | replay `201` + `Idempotency-Replayed: true` y un solo usuario en `GET /v1/users`; `409 idempotency-key-reuse`; `400 missing-idempotency-key` |
| 12 | Trazabilidad | `GET /v1/me` con `X-Request-Id: req-123` y con un UUID | respuesta con UUID nuevo / el mismo; en un error, `traceId` del problem coincide con la cabecera |
| 13 | El contrato está publicado | `GET /v1/openapi.json` | `200`; contiene `/v1/users` |

**Hecho cuando:** `pnpm test:e2e apps/tubodega/test/e2e/w1-*` verde en < 20 s.

---

## WAVE 2 — «Cargar el catálogo y las ubicaciones» (catalog + nodos de inventory)

**Habilita:** el onboarding real: importar la hoja de cálculo, definir campos propios, fotos, escanear, crear lotes/series, y dibujar el árbol de la bodega. Criterios de éxito 1 y 2.

### F2.1 — Catalog: dominio

**Entrega:** [11 §2](docs/specs/11-catalog.md): `Product`, `ProductCode`, `Batch`, `CustomFieldDefinition`, `CustomFieldValues`, enums, `Sku.of`, `FieldKey.of`, normalización de código; errores de [11 §9](docs/specs/11-catalog.md) que sean de dominio.

**Archivos:** `libs/catalog/src/domain/*.ts` + specs; `libs/catalog/src/index.ts`; `libs/catalog/test/builders/{a-product.ts, a-batch.ts, a-custom-field.ts}`.

**Interfaces (produce):** las clases de [11 §2](docs/specs/11-catalog.md). Además `Product.create(input, defs): Result<Product>`, `Product.update(patch, defs): Result<Product>` (incrementa `version` en el repositorio, no aquí), `Batch.create({ product, lotCode?, serial?, expiresAt?, customFields }, defs): Result<Batch>` (C-3, C-4; `defs` son las definiciones con `entity = BATCH`), `CustomFieldDefinition.validate(value)`, `CustomFieldValues.build(defs, raw)` con `errors[]` por `pointer` (C-7). `CustomFieldValues` es el mismo objeto de valor que usará `Node` (F2.5) con las definiciones `entity = NODE`: C-7 cubre las tres entidades con un solo mecanismo.

**Pruebas (dominio):** C-7 para los cinco tipos con casos límite (número como cadena `"12"` rechazado, fecha inválida, opción fuera de lista, `required` ausente, clave desconocida); C-3/C-4 en los tres modos; `requiresBatch()`; `Batch.isExpired`/`expiresWithin` en fronteras exactas con fechas fijas; SKU con espacios rechazado; código normalizado (trim).

**Hecho cuando:** verde; cobertura `domain/` ≥ 95 %.

### F2.2 — Catalog: casos de uso con dobles

**Entrega:** [11 §4](docs/specs/11-catalog.md) completo salvo media (F2.4): `CreateProduct`, `UpdateProduct` (C-8), `DeactivateProduct` (C-9), `AddProductCode`, `RemoveProductCode`, `ResolveCode`, `CreateBatch`, `DefineCustomField` (C-10), `UpdateCustomField`, `ImportProducts`, `ListProducts`, `GetProduct`, `ListBatches`, `ListCodes`, `ListCustomFields`; puertos de [11 §5](docs/specs/11-catalog.md); dobles.

**Archivos:** `libs/catalog/src/application/{ports/*.ts, use-cases/*.ts}` + specs; `libs/catalog/test/doubles/*.ts`.

**Interfaces:** puertos con firmas de [11 §5](docs/specs/11-catalog.md); `MovementCounter`, `StockChecker` (declarados aquí, implementados en F2.6). `StockChecker.hasStock` devuelve `{ has: boolean; nodes: { nodeId; path; quantity }[] }` para que `product-has-stock` liste los nodos (D-3). `DefineCustomField` aplica C-10 sobre la entidad que corresponda (`countEntitiesMissing` cuenta productos, nodos o lotes según `entity`). Eventos `product.created/updated/deactivated`, `batch.created`, `custom_field.defined`.

**Pruebas (aplicación):** import mixto (creadas, actualizadas, erróneas; conteos cuadran; columnas ausentes no pisan valores); `ResolveCode` por código, por serie (devuelve lote), por SKU, y `null`; C-8 con `MovementCounter` que devuelve 3 → `tracking-mode-locked` con `detail` que menciona 3; C-9 → `product-has-stock` con nodos; C-10 con `countEntitiesMissing = 2` → `required-field-would-invalidate`; `UpdateCustomField` cambia tipo con valores existentes → rechazado; autorización: `OPERATOR` puede `CreateBatch` y no `CreateProduct`.

**Hecho cuando:** verde; `application/` ≥ 90 %.

### F2.3 — Catalog: persistencia

**Entrega:** DAOs `product`, `product_code`, `product_media`, `media_upload`, `batch`, `custom_field_definition`; repositorios `Kysely{Product,ProductCode,Batch,CustomFieldDefinition,MediaUpload}Repository`; mapeo de `UniqueViolationError` por constraint a `sku-taken`, `code-taken` (con producto que lo usa), `serial-taken`, `lot-code-taken`.

**Archivos:** `libs/persistence/src/dao/*.dao.ts`, `libs/persistence/src/repositories/*.repository.ts`, `libs/persistence/src/models/*.ts`, `libs/persistence/test/repositories/catalog/*.int-spec.ts`.

**Interfaces:** `countEntitiesMissing(orgId, entity, key)` con `NOT (custom_fields ? $key)` sobre `product`, `node` o `batch` según `entity`; `list(orgId, filter, page)` usa `findPage` con `q` como `OR` de `sku`/`name` `ILIKE`; `findManyBySkus` en lotes de 1000. Los `INSERT` que pueden chocar con un único (`sku`, `code`, `serial`, `lot_code`) van dentro de `uow.run()` (savepoint): tras un `23505` la transacción queda abortada y sin savepoint no se podría leer qué producto usa ya el código para el `detail` de `code-taken`.

**Pruebas (integración):** C-1, C-2, C-5, C-6 bajo concurrencia (dos `withRollback` no sirven para concurrencia: usar dos transacciones reales sobre una org creada y borrada en `afterEach` por el pool de sistema); `EXPLAIN` del filtro por campo custom usa el índice GIN; `list` pagina establemente.

**Hecho cuando:** verde.

### F2.4 — Catalog: media y zona de espera

**Entrega:** `MediaStorage` puerto + `DiskMediaStorage` (`MEDIA_ROOT/<orgId>/<key>`); `StageUpload`, `AttachMedia` (multipart directo → `MANAGE_CATALOG`; `storageKeys[]` → `RECORD_MOVEMENT`, D-14), `RemoveMedia`; `MediaUploadRepository.listUnclaimedBefore` (lo usa la purga de F6.2); `POST /v1/uploads` con `@fastify/multipart` (10 MB, `image/jpeg|png|webp`).

**Archivos:** `libs/catalog/src/application/use-cases/{stage-upload.ts, attach-media.ts, remove-media.ts}` + specs; `libs/catalog/src/infrastructure/disk-media-storage.ts` (+spec con directorio temporal); `apps/tubodega/src/http/uploads/uploads.controller.ts`, `apps/tubodega/src/http/products/product-media.controller.ts`.

**Pruebas:** aplicación — `AttachMedia` con clave inexistente/reclamada → `upload-not-found`; `claim` devuelve las que fallaron; un `OPERATOR` reclama sus claves y no puede adjuntar multipart. Integración del borde — `415 unsupported-media-type`, `413 media-too-large`. Infra — `DiskMediaStorage` `put/delete/signedUrl`.

**Hecho cuando:** verde; subir una imagen y adjuntarla por HTTP funciona.

### F2.5 — Inventory: nodos (dominio y aplicación)

> Va **antes** del HTTP de catálogo (F2.7) porque `UpdateProduct`/`DeactivateProduct` inyectan `MovementCounter`/`StockChecker`, cuyos adaptadores nacen en F2.6. Así `app.module.ts` nunca registra un stub.

**Entrega:** `Node` (con `customFields` validados contra definiciones `entity = NODE`, C-7), `NodeKind`, `NodeCode`, `NodePath`, `isCustodial/isBoundary/isDescendantOf`; `CreateNode`, `UpdateNode` (no cambia `kind`: el DTO no lo admite y el caso de uso lo rechaza), `MoveNode`, `DeactivateNode` (N-3), `ListNodes`, `GetNodeTree`, `SeedBoundaryNodes`; puertos `NodeRepository`, y la parte de solo lectura de `StockBalanceRepository` (`hasAnyStock`, `query`; D-3); dobles.

**Archivos:** `libs/inventory/src/domain/{node.ts, ids.ts, errors.ts}` + specs; `libs/inventory/src/application/{ports/node.repository.ts, ports/stock-balance.repository.ts (parcial), use-cases/nodes/*.ts, use-cases/seed-boundary-nodes.ts}` + specs; `libs/inventory/src/index.ts`; `libs/inventory/test/{builders/a-node.ts, doubles/in-memory-node.repository.ts, doubles/in-memory-stock-balance.repository.ts}`.

**Interfaces (produce):** `SeedBoundaryNodes.execute(orgId)` crea los 8 nodos de [04 §6](docs/specs/04-persistencia.md) (idempotente por `code`); eventos `node.created/updated/moved/deactivated`. Errores `parent-not-internal`, `node-cycle`, `node-code-taken`, `node-has-stock`, `node-inactive`.

**Pruebas:** dominio — `isDescendantOf` por prefijo de `path` (cuidado: `BOD-A/Z1` no es ancestro de `BOD-A/Z10`); `path` de raíz = `code`. Aplicación — I-10 (padre `CUSTODY` rechazado; hijo `CUSTODY` con padre rechazado); ciclos a tres niveles; `MoveNode` recalcula `path` del subárbol en el doble; N-3.

**Hecho cuando:** verde; `libs/inventory/src/domain` al 100 % (empieza aquí y se mantiene).

### F2.6 — Inventory: persistencia de nodos, adaptadores cruzados y HTTP

**Entrega:** `NodeDao`, `KyselyNodeRepository` (`listUnder` con `path LIKE`, `updateSubtreePaths` por prefijo, todo en la misma transacción); `MovementDao` (append-only, solo `countByProduct` por ahora) y `StockBalanceDao` con `hasAnyStock` y `query` (`findPage` por `productId`/`nodeId`, `custodialOnly`, `nonZeroOnly`); adaptadores `MovementCounterAdapter`, `StockCheckerAdapter` (este último une las posiciones con `NodeRepository.findManyByIds` para dar el `path`); `OrgProvisioner` ahora siembra nodos (D-2); 7 endpoints de [12 §7](docs/specs/12-inventory.md) nodos.

**Archivos:** `libs/persistence/src/dao/{node.dao.ts, movement.dao.ts, stock-balance.dao.ts}`, `libs/persistence/src/repositories/{node.repository.ts, movement.repository.ts (parcial), stock-balance.repository.ts (parcial)}`, `apps/tubodega/src/adapters/catalog/*.ts`, `apps/tubodega/src/http/nodes/{nodes.controller.ts, nodes.dto.ts}`, tests de integración.

**Pruebas (integración):** N-1 y N-2 (mover `E3` de `Z1` a `Z2` recalcula `E3` y `B2`, `B3`); **detección de ciclos sobre datos reales** (I-10, [06 §5](docs/specs/06-pruebas-y-calidad.md)): mover `Z1` bajo `B2` con el repositorio Kysely → `node-cycle` y ningún `path` cambia; `node-code-taken` desde `23505`; `listUnder` usa el índice `text_pattern_ops` (`EXPLAIN`); el provisioner deja 8 nodos tras `CreateOrganization`.

### F2.7 — Catalog: HTTP

**Entrega:** los 18 endpoints de [11 §7](docs/specs/11-catalog.md) (los de media vienen de F2.4); `PATCH /v1/custom-fields/{id}` con `If-Match` y `custom-field-type-locked` (D-10).

**Archivos:** `apps/tubodega/src/http/products/{products.controller.ts, product-codes.controller.ts, batches.controller.ts, import.controller.ts, products.dto.ts}`, `apps/tubodega/src/http/codes/codes.controller.ts`, `apps/tubodega/src/http/custom-fields/{custom-fields.controller.ts, custom-fields.dto.ts}`; actualizar `openapi.json`.

**Pruebas:** e2e de la wave. Cada endpoint aparece en el snapshot con error declarado.

### E2E WAVE 2 — `w2-cargar-catalogo-y-ubicaciones.e2e-spec.ts`

Narrativa: Diego (ADMIN) migra la hoja de cálculo y organiza la bodega; Juan (OPERATOR) escanea y registra una remesa con lote.

> **Desviación (D-19), saldada.** La tabla se repartió en dos suites: los casos **1-11 y 16** con
> el plan 3 en `w2a-cargar-el-catalogo.e2e-spec.ts`, y los **12-15** —los de nodos— con el plan 4.
> El plan 4 las reunificó en `w2-cargar-catalogo-y-ubicaciones.e2e-spec.ts` y **renumeró** (D-21):
> los cuatro de nodos entraron como 12-15 y los que ocupaban esos números corrieron a 16-21, con
> lo que el fichero vuelve a estar alineado con esta tabla. Los mismos casos se recorren además
> por HTTP contra un servidor real en `scripts/blackbox/20-catalogo.sh` y `25-ubicaciones.sh`.

| # | Caso de uso real | Llamadas | Afirmaciones |
|---|---|---|---|
| 1 | Diego define un campo propio | `POST /v1/custom-fields {entity:PRODUCT, key:'proveedor', type:TEXT}` y otro `SELECT` `{key:'familia', options:[…]}`; `PATCH /v1/custom-fields/{familia}` con `If-Match` cambiando `label`, y luego cambiando `type` cuando ya hay valores | `201`; `GET /v1/custom-fields?entity=PRODUCT` los lista en orden; `200`; `422 custom-field-type-locked` |
| 2 | **Criterio 1**: importa 500 productos | `POST /v1/products/import` con 500 filas generadas (mezcla `QUANTITY/LOT/SERIAL`, 1-3 códigos cada una, `customFields.proveedor`), una fila con SKU vacío y otra con `familia` fuera de lista | `created: 498, errors: 2` con `line` y `type` (`validation-failed`, `invalid-custom-field`); `GET /v1/products?limit=200` pagina en 3 páginas por cursor sin repetir ni saltar; total 498; `POST /v1/products` con un SKU ya importado → `409 sku-taken` |
| 3 | Re-importar actualiza sin duplicar | mismo lote con `name` cambiado en 10 filas | `updated: 498`; `GET /v1/products?q=NUEVO` encuentra los 10 |
| 4 | Fotos para el catálogo | `POST /v1/uploads` (multipart 1 KB PNG) con token de Juan ×10; `POST /v1/products/{id}/media {storageKeys:[…]}` con token de Juan sobre 10 productos (D-14); reintentar con una clave ya usada; multipart directo con token de Juan y con el de Diego | `201` + `storageKey`; `201` ×10; `422 upload-not-found`; `GET /v1/products/{id}` lista la imagen; `403` y `201`; archivo de 11 MB → `413`; `text/plain` → `415`. (Los 500 con foto se ejecutan en F6.1.) |
| 5 | Códigos | `POST /v1/products/{tor}/codes {value:'7501…', kind:EAN}`; el mismo código en otro producto; `GET /v1/products/{tor}/codes`; `DELETE …/codes/{codeId}` y resolver de nuevo | `201`; `409 code-taken` con el SKU que lo usa en `detail`; lista; `204` y `404 code-not-found` |
| 5b | Quitar una foto | `DELETE /v1/products/{id}/media/{mediaId}` | `204`; `GET /v1/products/{id}` ya no la lista |
| 6 | Escanear en el pasillo | `GET /v1/codes/7501…/resolve`; `GET /v1/codes/TOR-M8/resolve`; `GET /v1/codes/NOEXISTE/resolve` | producto; producto (por SKU); `404 code-not-found` |
| 7 | Juan crea la serie del taladro | `POST /v1/products/{tal}/batches {serial:'BSH-001'}` con token de Juan; `GET /v1/codes/BSH-001/resolve` | `201` (OPERATOR tiene `CREATE_BATCH`); resuelve producto **y** lote; repetir serie → `409 serial-taken`; lote sobre `TOR-M8` → `422 batch-not-allowed` |
| 8 | Lote con vencimiento | `POST /v1/products/{leche}/batches {lotCode:'L-2026-09', expiresAt}`; repetir el mismo `lotCode`; `GET /v1/products/{leche}/batches` | `201`; `409 lot-code-taken`; lista; sin `lotCode` → `422 batch-required` |
| 9 | Juan no puede tocar el catálogo | `POST /v1/products` con token de Juan | `403 insufficient-role` |
| 10 | Edición con versión | `PATCH /v1/products/{id}` `If-Match: 1` → `200`; repetir con `1` → `409 stale-version`; cambiar `trackingMode` (sin movimientos aún) → `200` | (C-8 con movimientos se prueba en W3) |
| 11 | Campo obligatorio retroactivo | `POST /v1/custom-fields {key:'ubicacion_fiscal', required:true}` | `422 required-field-would-invalidate` con el conteo en `detail` |
| 12 | **Criterio 2**: el árbol de la bodega | `POST /v1/nodes` para `BOD-A`, `MUELLE`, `Z1`, `E3`, `B2`, `B3`, `BOD-B`… ; repetir `code:'B2'`; `GET /v1/nodes/{bodA}/tree`; `GET /v1/nodes?under={z1}` | `path` correctos (`BOD-A/Z1/E3/B2`); `409 node-code-taken`; árbol anidado; subárbol filtra; los 8 nodos de frontera ya existen tras el registro (`GET /v1/nodes?kind=SOURCE` → 3) |
| 13 | Reorganizar estantes | `POST /v1/nodes/{e3}/move {parentId: z2}`; mover `Z1` bajo `B2`; `PATCH /v1/nodes/{b2} {name}` con `If-Match` | paths de `E3`, `B2`, `B3` actualizados (`GET /v1/nodes/{b2}` lo confirma); `422 node-cycle`; `200` y con versión vieja `409 stale-version`; `PATCH` con `kind` → `400 validation-failed` |
| 14 | Reglas del árbol | crear `CUSTODY:juan` con `parentId` | `422 parent-not-internal`; crear `CUSTODY:juan` sin padre → `201` |
| 15 | Desactivar un bin vacío | `DELETE /v1/nodes/{b3}` | `204`; `GET` lo muestra `active:false` (N-3 con saldo se prueba en W3) |
| 16 | Otra empresa | segunda org pide `GET /v1/products/{id}` y `GET /v1/nodes/{id}` | `404` |

**Hecho cuando:** verde en < 35 s (el import de 500 es la parte lenta; si supera, se reparte en 5 peticiones de 100). Presupuesto global: `pnpm test:e2e` completo < 120 s ([06 §2](docs/specs/06-pruebas-y-calidad.md)), repartido W1 < 20 s · W2 < 35 s · W3 < 30 s · W4 < 20 s · W5 < 10 s; `mvp-acceptance` corre en el mismo presupuesto y comparte proceso.

---

## WAVE 3 — «Mover mercancía» (el ledger)

**Habilita:** recepción, almacenaje, traslado, despacho, merma, ajustes, préstamo y devolución, compensación, saldo inicial masivo, consultas de stock e histórico. Criterios 3 (variante directa), 4, 6, 7, 8, 9. Es el núcleo; cobertura 100 % en dominio.

### F3.1 — `Quantity`

**Entrega:** [12 §2](docs/specs/12-inventory.md) `Quantity` sobre `bigint` de milésimas.

**Archivos:** `libs/inventory/src/domain/quantity.ts` + spec.

**Pruebas (dominio, 100 %):** `of('12.500')`, `of('0.1')`, `of('-1')` → error, `of('1.2345')` → error (más de 3 decimales), `of('abc')`; `plus`/`minus`; acumular `0.1` mil veces = `100.000` exacto; `compare`; `toString` siempre con 3 decimales; `isZero`, `isPositive`. Aquí se fija en `vitest.config.ts` el umbral 100/100 para `libs/inventory/src/domain` (D-15).

### F3.2 — `Movement`, `StockPosition` y errores del ledger

**Entrega:** `Movement.create(CreateMovementInput): Result<Movement>` con I-1, I-2, I-8, I-11, I-14 (tolerancia 5 min con `recordedAt` del `Clock`), I-16, I-17, I-18, `batch-product-mismatch`; `reverse(by, at)` (I-12); `StockPosition`; `BalanceDelta`; errores de [12 §9](docs/specs/12-inventory.md).

**Archivos:** `libs/inventory/src/domain/{movement.ts, stock-position.ts, errors.ts}` + specs; `libs/inventory/test/builders/a-movement.ts`.

**Pruebas (dominio, 100 %):** una prueba por invariante, nombrada `I-n · …`; `reverse()` invierte nodos, conserva producto/lote/cantidad, `reversesId` apunta al original, `settlesId` no se copia; `settles` con destino distinto al origen → `settles-mismatch`; `pending < quantity` → `settles-exceeded`; origen `CUSTODY` con `reversesId` y sin `settlesId` → válido (I-17 admite compensación).

### F3.3 — Casos de uso del ledger con dobles

**Entrega:** `RecordMovement` (secuencia de 8 pasos de [12 §4.2](docs/specs/12-inventory.md)), `ReverseMovement`, `RecordMovementBatch` (≤ 500, `batch-too-large`), `GetStock`, `GetMovementHistory`, `GetMovementById`, `GetOpenCustodies`; puertos completos `MovementRepository`, `StockBalanceRepository`; eventos `stock.moved`, `stock.reversed`, `stock.balance_changed` (solo custodiables que cruzan cero), `custody.checked_out`, `custody.checked_in` (con pendiente restante).

**Archivos:** `libs/inventory/src/application/{ports/*.ts, use-cases/movements/*.ts, use-cases/stock/*.ts, events.ts}` + specs; dobles: `InMemoryMovementRepository`, `InMemoryStockBalanceRepository` (**simula I-4**: `applyDelta` lanza `InsufficientStockSignal(position)` si un custodiable quedaría negativo, y revierte sus propios cambios), `InMemoryProductLookup`, `InMemoryBatchLookup`.

**Interfaces (produce):** `InsufficientStockSignal { nodeId, productId, batchId?, available: Quantity }` — lo lanza el repositorio (real o doble) dentro del `uow.run()` anidado; el caso de uso lo captura, lee la posición y construye `InsufficientStockError(422)` con `detail` que nombra el `path` del nodo y `errors[{pointer:'/quantity', available, requested}]`. Puertos de lectura hacia catálogo: `ProductLookup.byId(orgId, id)`, `BatchLookup.byId(orgId, id)` (implementados por adaptadores sobre `@app/catalog`).

**I-9 con mecanismo real** ([02 §9](docs/specs/02-modelo-de-dominio.md): «validación de dominio»): en el paso 3 de la secuencia, si el producto es `SERIAL` y el destino es custodiable, `RecordMovement` consulta `StockBalanceRepository.custodialTotal(orgId, batchId)`; si es `> 0` y el origen **no** es custodiable (es decir, la unidad entraría por segunda vez desde una frontera), responde `422 serial-already-placed` (D-10). Un traslado custodiable → custodiable no dispara la regla porque la unidad sale y entra en el mismo asiento. El `CHECK` I-4 sigue cubriendo el caso inverso (sacar de donde no está).

**Pruebas (aplicación):** cada precondición de la secuencia; **I-9**: recibir dos veces `BSH-001` desde `supplier-default` → `serial-already-placed`; el mismo serial trasladado entre bins → ok; `insufficient-stock` con `available` correcto tras el savepoint simulado; `balance_changed` solo al cruzar cero y solo en custodiables; `ReverseMovement` sobre ya compensado → `already-reversed`; compensación con stock movido → `insufficient-stock`; `RecordMovementBatch` con 501 → `batch-too-large`, y con un movimiento inválido en la posición 3 no persiste ninguno; `GetOpenCustodies` calcula `pending` y `overdue` con `FixedClock`; autorización (`OPERATOR` no compensa).

**Hecho cuando:** verde; `application/` ≥ 90 %.

### F3.4 — Persistencia del ledger

**Entrega:** `KyselyMovementRepository` completo (`append`, `appendMany`, `findById`, `existsReversalOf`, `settledQuantity` con la consulta de [04 §3.4](docs/specs/04-persistencia.md), `listOpenCustodies`, `list` con filtros e índices, `countByProduct`); `KyselyStockBalanceRepository` completo (`applyDelta`: ordena por `(nodeId, productId, batchId)`, un `INSERT … ON CONFLICT … DO UPDATE` por delta, traduce `23514` en `stock_balance_i4_non_negative` a `InsufficientStockSignal` leyendo la fila tras `rollbackToSavepoint`; `find`, `query`, `sumUnder`, `hasAnyStock`, `custodialTotal` (I-9)); mapeo `movement_pkey` → `movement-id-taken` (D-10).

**Archivos:** `libs/persistence/src/repositories/{movement.repository.ts, stock-balance.repository.ts}`, `libs/persistence/src/dao/{movement.dao.ts, stock-balance.dao.ts}` (métodos concretos `upsertDelta`, `settledQuantity`, `openCustodies`), tests.

**Pruebas (integración):** savepoint — tras un fallo de I-4 la transacción sigue usable y `available` es correcto; saldo negativo aborta todo: el movimiento no queda insertado; **interbloqueo**: dos transacciones reales que mueven A→B y B→A en paralelo terminan sin `40P01`; `settledQuantity` ignora check-ins compensados; `listOpenCustodies` por préstamo; `list` de últimos 50 por producto usa `(org_id, product_id, occurred_at DESC)` (`EXPLAIN`); `UPDATE movement` por el repositorio es imposible (no existe el método: type-spec) y por SQL falla (`42501`).

### F3.5 — HTTP del ledger

**Entrega:** [12 §7](docs/specs/12-inventory.md) movimientos y existencias; DTOs con decimales como cadena validados por regex `^\d{1,15}(\.\d{1,3})?$`; filtros declarados (`productId`, `nodeId`, `batchId`, `actorId`, `from`, `to`, `sort=±occurredAt`); `GET /v1/stock` con `custodialOnly`, `nonZeroOnly` (default `true`), `under`; `GET /v1/stock/custodies?overdueOnly`.

**Archivos:** `apps/tubodega/src/http/movements/{movements.controller.ts, movements.dto.ts}`, `apps/tubodega/src/http/stock/{stock.controller.ts, stock.dto.ts}`, adaptadores `inventory/{product-lookup.adapter.ts, batch-lookup.adapter.ts}`; `openapi.json`.

### F3.6 — Pruebas de propiedades (invariantes del sistema)

**Entrega:** `test/invariants/` con `fast-check` sobre Postgres a través de los casos de uso reales (`RecordMovement`, `ReverseMovement`) y repositorios Kysely, dentro de `withRollback` por corrida.

**Archivos:** `test/invariants/{arbitraries.ts, ledger-reconciliation.prop-spec.ts (I-5), conservation.prop-spec.ts, serial-uniqueness.prop-spec.ts (I-9), custody-pending.prop-spec.ts (I-18)}`.

**Interfaces:** `arbitraryMovementSequence({ products, nodes, maxLen })` genera operaciones válidas *a priori* (recepciones, traslados, despachos, check-out/in con `settlesId` real, compensaciones); las inválidas (stock insuficiente) se aceptan como resultado esperado `422` y no rompen la propiedad.

**Pruebas:** las cuatro de [06 §7](docs/specs/06-pruebas-y-calidad.md); `numRuns` 50 en CI, `seed` fijado en fallo. Duración < 180 s.

### E2E WAVE 3 — `w3-mover-mercancia.e2e-spec.ts`

Narrativa: primer día de operación. Diego carga el saldo inicial desde la hoja; Juan recibe, ubica, traslada y despacha; presta el taladro; comete un error y Diego lo corrige; Marta audita.

| # | Caso de uso real | Llamadas | Afirmaciones |
|---|---|---|---|
| 1 | Saldo inicial desde Excel | `POST /v1/movements/batch` con 200 movimientos `opening-balance → B2/B3/B1` (Diego) | `201`; `GET /v1/stock?custodialOnly=true` suma lo cargado; una petición con 501 → `422 batch-too-large`; con un movimiento inválido en medio → `422` y `GET /v1/stock` no cambió |
| 2 | **Criterio 3 (directo)**: llega el proveedor | `POST /v1/movements {supplier-default → MUELLE, TOR-M8, 100}` y luego `MUELLE → B2, 100` (Juan) | saldo `MUELLE` 0, `B2` +100; `GET /v1/movements?nodeId={muelle}` muestra ambos; `GET /v1/movements/{id}` devuelve `recordedAt ≥ occurredAt` |
| 3 | **Criterio 4**: traslado que cuadra | `B2 → B3, 40` | `B2` −40, `B3` +40; `GET /v1/stock?under={z1}` agrega 100 |
| 4 | **Criterio 6**: venta | `B3 → sale, 15` | inventario propio (`custodialOnly=true`) baja 15; `GET /v1/stock?nodeId={sale}&custodialOnly=false&nonZeroOnly=false` muestra el acumulado 15 |
| 5 | Merma y ajustes exigen motivo | `B3 → shrinkage` sin `reason` | `422 reason-required` (D-10); con `reason` → `201`; `adjustment-in → B2` con `reason` → `201`; `B3 → consumption` sin `reason` → `201` (el consumo no es ajuste) |
| 6 | No se despacha lo que no hay | `B3 → sale, 999` | `422 insufficient-stock`, `detail` contiene `BOD-A/Z1/E3/B3`, `errors[0].available` y `requested`; el saldo no cambió |
| 7 | **Criterio 7**: error y compensación | Juan registra `MUELLE → B2, 100` donde eran 10; Diego `POST /v1/movements/{id}/reverse {reason}`; Juan registra `10`; Juan intenta `reverse` | histórico muestra los tres con `reversesId`; saldos cuadran; segundo `reverse` → `409 already-reversed`; Juan → `403 insufficient-role` |
| 8 | Compensar sin stock | mover todo `B2 → B3`, luego compensar una recepción a `B2` | `422 insufficient-stock` (no inventa existencias) |
| 9 | Préstamo de herramienta | recibir `BSH-001` desde `supplier-default` por segunda vez; `B2 → CUSTODY:juan, TAL-BOSCH serie BSH-001, dueAt +7d`; `GET /v1/stock/custodies`; un segundo préstamo de `ARROZ-25` con `dueAt` de ayer; `GET /v1/stock/custodies?overdueOnly=true` | `422 serial-already-placed` (I-9); `201`; una fila con `pending "1.000"`, `overdue:false`; prestar el mismo serial desde `B3` → `422 insufficient-stock` (I-4); el filtro devuelve solo el préstamo vencido con `overdue:true` |
| 10 | Préstamo por cantidad y devolución parcial | `B2 → juan, TOR-M8, 5, dueAt`; `juan → B2, 2, settlesId`; `juan → B2, 4, settlesId` | pendiente `3.000`; `422 settles-exceeded` con pendiente real; sin `settlesId` → `422 settles-required`; `settlesId` de otro préstamo con otro producto → `422 settles-mismatch` |
| 11 | Reglas del asiento | mismo nodo origen/destino; cantidad `"0"`; `dueAt` hacia `B3`; `occurredAt` +10 min; `LECHE-1L` sin `batchId`; `TOR-M8` con `batchId`; `LECHE-1L` con el `batchId` del taladro; nodo desactivado `B3` (tras `DELETE`) | `422 same-node`, `non-positive-quantity`, `due-date-not-allowed`, `future-occurrence`, `batch-required`, `batch-not-allowed`, `batch-product-mismatch`, `node-inactive` |
| 12 | El catálogo respeta el ledger | `PATCH /v1/products/{tor}` cambiando `trackingMode`; `DELETE /v1/products/{tor}`; `DELETE /v1/nodes/{b2}` | `422 tracking-mode-locked` (con conteo); `422 product-has-stock` (lista nodos); `422 node-has-stock` |
| 13 | **Criterio 9**: reintentos | repetir un `POST /v1/movements` con la misma clave; mismo `id` de cliente con otra clave | replay idéntico y un solo movimiento en el histórico; `409 movement-id-taken` |
| 14 | **Criterio 8**: Marta reconcilia | leer `GET /v1/movements?limit=200` con cursor hasta `hasMore:false` y `GET /v1/stock?nonZeroOnly=false&custodialOnly=false` igual | sumar por `(nodeId, productId, batchId)` con +/− coincide fila por fila con `stock`; la suma total por producto sobre todos los nodos es `0.000` (conservación) |
| 15 | Sofía solo mira | `POST /v1/movements` con token de Sofía; `GET /v1/movements` | `403`; `200` |

**Hecho cuando:** verde en < 30 s; `pnpm test:e2e test/invariants` verde en < 180 s.

---

## WAVE 4 — «Operar con procesos» (el motor)

**Habilita:** las seis operaciones guiadas paso a paso, con lote nuevo y foto en la misma confirmación, y cancelación limpia. Criterio 3 en su forma definitiva.

### F4.1 — Process: dominio del motor

**Entrega:** tipos de [13 §2](docs/specs/13-process.md); `ProcessTemplate` con validador (P-8 `branching-not-supported`, `unknown-step-type` contra un conjunto de tipos conocido, transición a paso inexistente); `ProcessInstance`, `ProcessContext`, `MovementDraft`, `BatchDraft`, `StepCompletion`; `LinearRunner` (P-2, P-4, P-5, omisión con `null`, `to: null` → `COMPLETED`, efectos solo al completar); **las seis plantillas de fábrica como constantes** (`FACTORY_TEMPLATES`).

**Archivos:** `libs/process/src/domain/{ids.ts, step-types.ts, template.ts, instance.ts, context.ts, drafts.ts, step-completion.ts, runner.ts, linear-runner.ts, factory-templates.ts, effects.ts, errors.ts}` + specs; `libs/process/src/index.ts`; builders.

**Pruebas (dominio, 100 %):** P-1..P-9 nombradas (P-1, P-3, P-7 se cubren en integración; aquí sus contrapartes de dominio); `LinearRunner` recorre cada plantilla de fábrica de principio a fin **tres veces** (`QUANTITY`, `LOT`, `SERIAL`) y el borrador final pasa `Movement.create` (importa `@app/inventory`); `ProcessContext` acumula; omitir `required:true` → `required-step-skipped`; una plantilla con dos transiciones → `branching-not-supported`.

### F4.2 — Process: los ocho manejadores y el registro

**Entrega:** `StepHandler` + `StepHandlerRegistry` + `HandlerDeps`; `SCAN_ITEM`, `CAPTURE_BATCH` (tabla de 6 celdas), `CAPTURE_QTY` (entera si `UNIT/BOX/PACK`), `CAPTURE_PHOTO` (1-5), `SELECT_NODE` (`config.role`, `allowedKinds`), `SET_DUE_DATE` (futura con `Clock`; destino `CUSTODY`), `CAPTURE_REASON` (3-500), `CONFIRM` (borrador completo y coherente; `defaults.fromNodeCode/toNodeCode` resueltos por `FindNodeByCodePort`; efectos en orden `CREATE_BATCH`, `EMIT_MOVEMENTS`, `ATTACH_MEDIA`).

**Archivos:** `libs/process/src/domain/handlers/*.ts` + specs; `libs/process/src/domain/handlers/registry.ts`.

**Interfaces:** `HandlerDeps { resolveCode; findNode; findNodeByCode; findProduct; findBatchByLot; findBatchBySerial; clock }` (amplía [13 §4.2](docs/specs/13-process.md) con lo que `CAPTURE_BATCH` y `CONFIRM` necesitan para decidir `batchId` vs `newBatch` y los `defaults`). Los manejadores siguen siendo de solo lectura.

**Pruebas (dominio, 100 %):** cada manejador con payload válido, inválido (`invalid-step-payload` con `pointer`) y `null`; `CAPTURE_BATCH` en sus seis celdas más «`SCAN_ITEM` ya aportó lote»; `CONFIRM` con borrador incompleto lista lo que falta; `CONFIRM` con `defaults` cuando el borrador ya trae ese lado → prioridad del borrador.

### F4.3 — Process: casos de uso y aplicador de efectos

**Entrega:** `StartProcess`, `CompleteStep` (12 pasos de [13 §7](docs/specs/13-process.md)), `CancelProcess`, `GetProcessInstance` (con completados), `ListProcessInstances`, `ListTemplates`, `GetActiveTemplate` (`404 template-not-found`), `CreateTemplateVersion` (P-9, valida P-8), `SeedFactoryTemplates`; `EffectApplier`; puertos de [13 §8](docs/specs/13-process.md) incluido `hasInstances`; eventos `process.started`, `process.step_completed`, `process.completed`, `process.cancelled` ([13 §11](docs/specs/13-process.md)); dobles.

**Archivos:** `libs/process/src/application/{ports/*.ts, use-cases/*.ts, effect-applier.ts}` + specs; dobles `RecordingMovementRecorder`, `RecordingBatchCreator`, `RecordingMediaAttacher`, repositorios en memoria.

**Pruebas (aplicación):** paso equivocado → `wrong-step` con el actual en `detail`; repetido → `step-already-completed`; cerrada → `instance-closed`; **P-6**: ningún recorder recibe llamadas hasta `CONFIRM`; orden de efectos; `CancelProcess` no invoca nada; `CreateTemplateVersion` crea `v2` y desactiva `v1`; instancia abierta en `v1` sigue resolviendo `v1`.

Nota: `template-has-instances` (409, [13 §12](docs/specs/13-process.md)) no tiene ruta que lo produzca en el MVP porque no existe edición de plantillas; se declara el error de dominio y `ProcessTemplateRepository.hasInstances` (P-9) queda disponible para cuando la haya.

### F4.4 — Process: persistencia, adaptadores cruzados y HTTP

**Entrega:** DAOs `process_template`, `process_instance`, `step_completion` (append-only); repositorios; adaptadores `apps/tubodega/src/adapters/process/*` (`ResolveCodePort` → `ResolveCode` de catalog; `FindNodePort`/`FindNodeByCode` → `NodeRepository`; `FindProductPort`; `BatchCreator` → `CreateBatch`; `MovementRecorder` → `RecordMovementBatch`; `MediaAttacher` → `AttachMedia`); provisioner siembra plantillas (D-2); 8 endpoints de [13 §10](docs/specs/13-process.md) en `http/process-templates/` y `http/process-instances/`.

**Pruebas (integración):** type-spec: `StepCompletionDao` no tiene `update`/`upsert`/`delete` ([08 §8](docs/specs/08-acceso-a-datos.md)); P-1 (instancia con versión inexistente → `23503`); P-3 bajo concurrencia (dos `complete` al mismo paso, uno `201` y otro `409 step-already-completed`, no dos `step_completion`); **P-7**: un `CONFIRM` cuyo movimiento falla por I-4 deja la instancia `OPEN` en el paso `confirmar`, sin `step_completion` de `confirmar`, sin lote nuevo y sin `product_media`.

### E2E WAVE 4 — `w4-operar-con-procesos.e2e-spec.ts`

Narrativa: Juan opera con el teléfono siguiendo lo que el servidor le indica; nunca consulta la plantilla.

| # | Caso de uso real | Llamadas | Afirmaciones |
|---|---|---|---|
| 1 | Las plantillas de fábrica están | `GET /v1/process-templates`; `GET /v1/process-templates/RECEPCION`; `GET /v1/process-templates/PICKING`; `POST /v1/process-instances {templateCode:'PICKING'}` | 6 activas en `version:1`; pasos con `transitions` de un elemento; `404 template-not-found` ×2 |
| 2 | **Criterio 3**: recepción guiada con lote nuevo | `POST /v1/process-instances {templateCode:'RECEPCION'}` → `nextStep.id='origen'`; completar `origen {nodeId: supplier-default}`, `item {code: EAN de LECHE-1L}`, `lote {lotCode:'L-NUEVO', expiresAt}`, `cantidad {quantity:'24'}`, `foto` (`null`), `destino {nodeId: B2}`, `confirmar {}` — usando siempre `nextStep` de la respuesta anterior | cada `complete` devuelve el siguiente paso; el último devuelve `movements[0]` con `processInstanceId`; `GET /v1/products/{leche}/batches` contiene `L-NUEVO`; `GET /v1/stock?nodeId={b2}&batchId=…` = 24; `GET /v1/process-instances/{id}` es `COMPLETED` con 7 completados (`foto` con `payload:null`) |
| 3 | Recepción de un producto por cantidad | `RECEPCION` con `TOR-M8`: `lote` con `null` | avanza; `lote {lotCode:'x'}` → `422 batch-step-not-allowed`; con `LECHE-1L` y `lote null` sin lote del escaneo → `422 batch-step-required` |
| 4 | Foto tomada en el muelle | `POST /v1/uploads` (Juan) → `foto {storageKeys:[k]}` → … → `confirmar` | tras confirmar, `GET /v1/products/{id}` lista la imagen; volver a usar `k` en otra instancia → `422 upload-not-found` |
| 5 | El servidor manda | completar `cantidad` cuando el actual es `item`; completar `origen` de nuevo; `cantidad {quantity:'2.5'}` sobre `UNIT`; `cantidad {quantity:'0'}` | `409 wrong-step` (`detail` nombra `item`); `409 step-already-completed`; `422 invalid-step-payload` con `pointer:/quantity` ×2 |
| 6 | Traslado y salida | `TRASLADO B2→B3 TOR-M8 10`; `SALIDA B3→sale 5` | saldos; `origen {nodeId: supplier-default}` en `TRASLADO` → `422 invalid-step-payload` (kind no permitido) |
| 7 | Ajustes con lado fijo | `AJUSTE_ENTRADA` (sin paso `origen`): item, lote, cantidad, `motivo {reason:'conteo'}`, destino, confirmar; `AJUSTE_SALIDA` | el movimiento sale de `adjustment-in`; `motivo {reason:'x'}` → `422` (3-500) |
| 8 | Préstamo guiado | `CUSTODIA`: origen B2, item `BSH-001` (serie → lote implícito), `lote null`, cantidad 1, `tenedor {nodeId: juan}`, `vencimiento {dueAt: +7d}`, confirmar | `GET /v1/stock/custodies` muestra el préstamo con `dueAt`; `vencimiento` con fecha pasada → `422` |
| 9 | Confirmar sin existencias no ensucia nada | `SALIDA` de 999 `TOR-M8` desde `B3` hasta `confirmar` | `422 insufficient-stock`; `GET /v1/process-instances/{id}` sigue `OPEN` en `confirmar`; `GET /v1/stock` intacto; repetir `confirmar` tras un traslado que reponga → `201` |
| 10 | Abandonar a la mitad | `RECEPCION` hasta `cantidad`, `POST …/cancel` | `CANCELLED`; sin lote nuevo, sin stock, sin imagen adjunta; `complete` posterior → `409 instance-closed` |
| 11 | Reintento del cliente sin red | repetir el `POST …/complete` del `confirmar` con la misma `Idempotency-Key` | replay; un solo movimiento en el histórico |
| 12 | Diego versiona una plantilla | `POST /v1/process-templates/RECEPCION/versions` sin el paso `foto`; instancia abierta en v1 continúa y ve `foto`; nueva instancia no lo ve | `201 version:2`; `GET /v1/process-templates/RECEPCION` devuelve v2; plantilla con dos transiciones → `422 branching-not-supported`; tipo desconocido → `422 unknown-step-type`; Juan (OPERATOR) → `403` |
| 13 | Marta revisa lo que quedó abierto | `GET /v1/process-instances?state=OPEN`; `?templateCode=RECEPCION&actorId={juan}`; `?state=FOO` | solo las abiertas; filtra; `400 invalid-filter` |
| 14 | Roles | Sofía `POST /v1/process-instances` | `403` |

**Hecho cuando:** verde en < 20 s.

---

## WAVE 5 — «Vigilar fechas» (alerts)

**Habilita:** vencimientos de lote y custodias vencidas con resolución automática, umbrales configurables, bandeja y contador. Criterio 5.

### F5.1 — Alerts: dominio

**Entrega:** [14 §2](docs/specs/14-alerts.md): `Alert`, `AlertKind`, `AlertSubject`, `Severity`, `severity(at)`, `daysUntilDue(at)`, `AlertRule` con validación (`invalid-threshold` 0-365, `unknown-alert-kind`), `DEFAULT_RULES`; función pura `reconcile(desired, open): { toRaise, toResolve }`.

**Pruebas (dominio):** severidad en cada frontera; A-5 (misma alerta, dos instantes, severidades distintas); `daysUntilDue` cruzando cero; `reconcile` con conjuntos vacíos, iguales, disjuntos.

### F5.2 — Alerts: casos de uso con dobles

**Entrega:** `EvaluateAlerts(orgId, at)`, `ListAlerts` (con `AlertEnricher`), `GetAlertSummary`, `UpdateAlertRules`, `SeedAlertRules`; puertos de [14 §6](docs/specs/14-alerts.md); dobles.

**Pruebas (aplicación, `FixedClock`):** levanta lo que falta y resuelve lo que sobra; A-2 segunda pasada sin cambios ni eventos; A-3 custodia devuelta (el doble de `OverdueCustodyQuery` ya no la devuelve) → resuelta; A-4 lote vencido sin saldo no genera nada; regla `enabled:false` no evalúa; `UpdateAlertRules` reemplaza el conjunto y valida.

### F5.3 — Alerts: persistencia, adaptadores, job y HTTP

**Entrega:** `AlertDao` (`raiseMany` con `ON CONFLICT DO NOTHING` sobre el índice parcial), `KyselyAlertRepository`, `KyselyAlertRuleRepository`; adaptadores `ExpiringBatchQuery` (consulta de [14 §4](docs/specs/14-alerts.md) en `BatchDao`), `OverdueCustodyQuery` (en `MovementDao`), `AlertEnricher` (join ligero producto/lote/nodo/saldo), `OrgIterator` (`OrganizationDao.listActive`, sistema); `AlertsEvaluatorJob` (contexto de **sistema**, [07 §2](docs/specs/07-composicion-y-contexto-de-ejecucion.md): por organización `runAs({pool:'system', orgId})`, que fija `SET LOCAL app.current_org` aunque el rol salte RLS, + `pg_try_advisory_xact_lock(hashtext(orgId))`; los repositorios filtran por `orgId` como siempre); `POST /v1/alerts/evaluate` (`at` solo con `NODE_ENV=test`, si no `400 evaluate-at-not-allowed`); `GET /v1/alerts`, `/summary`, `GET/PUT /v1/alert-rules` (en `http/alerts/` y `http/alert-rules/`); provisioner siembra reglas (D-2); purga de alertas a 90 días en `purge.job.ts`.

**Pruebas (integración):** A-1 con dos evaluadores concurrentes → una alerta; resuelta y re-cumplida → se re-levanta; `EXPLAIN` de ambas consultas usa los índices parciales; dos préstamos del mismo `QUANTITY` al mismo tenedor, el primero devuelto → solo el segundo alerta; una organización con fallo no impide evaluar la siguiente.

### E2E WAVE 5 — `w5-vigilar-fechas.e2e-spec.ts`

Narrativa: Marta revisa la bandeja cada mañana; el sistema le dice qué se vence y quién no ha devuelto.

| # | Caso de uso real | Llamadas | Afirmaciones |
|---|---|---|---|
| 1 | Reglas por defecto | `GET /v1/alert-rules` | 4 reglas con 30/0/3/0 días |
| 2 | **Criterio 5**: préstamo que vence | prestar `BSH-001` a Juan con `dueAt = T+7d`; `POST /v1/alerts/evaluate {at: T+5d}`; `GET /v1/alerts` | `CUSTODY_DUE` (umbral 3 d) con `severity`, `productName`, `nodeName:'Juan'`, `quantity:'1.000'`; `evaluate {at: T+8d}` → la misma se resuelve y aparece `CUSTODY_OVERDUE`; `GET /v1/alerts?openOnly=false` muestra ambas |
| 3 | Devolver cierra la alerta | `juan → B2` con `settlesId`; `evaluate {at: T+8d}` | `raised:[]`, `resolved:[overdue]`; `GET /v1/alerts` vacío; `summary` en ceros |
| 4 | Dos préstamos, una devolución | dos check-outs `TOR-M8` a Juan (lunes/viernes), check-in del lunes; `evaluate` tras ambos vencimientos | una sola alerta, sobre el check-out del viernes |
| 5 | Lote que se vence | recibir `LECHE-1L` lote con `expiresAt = T+10d`; `evaluate {at: T}` | `BATCH_EXPIRING` (30 d); `evaluate {at: T+11d}` → `BATCH_EXPIRED`; despachar todo el lote a `sale` y evaluar → resuelta (A-4) |
| 6 | Marta ajusta umbrales | `PUT /v1/alert-rules` con `BATCH_EXPIRING: 5`; `evaluate {at: T}` | el lote a 10 d ya no alerta; umbral `400` d → `422 invalid-threshold`; tipo `FOO` → `422 unknown-alert-kind` |
| 7 | Idempotencia del evaluador | `evaluate` dos veces seguidas con `at` igual | segunda: `raised:[]`, `resolved:[]`; sin duplicados en `GET /v1/alerts` |
| 8 | Bandeja y contador | `GET /v1/alerts?kind=BATCH_EXPIRING`; `?dueBefore=T+20d`; `?sort=dueAt`; `GET /v1/alerts/summary` | filtra por tipo y fecha; ordenada por `dueAt`; conteo por tipo coincide con la lista |
| 9 | Roles | Diego (ADMIN) `POST /v1/alerts/evaluate`; Sofía `GET /v1/alerts` | `403` (MANAGE_ORG es solo OWNER); `200` |

**Hecho cuando:** verde en < 10 s.

---

## WAVE 6 — «Cierre del MVP» (aceptación, operación y CI completa)

**Habilita:** la definición operativa de «MVP listo» y lo que falta para operarlo.

### F6.1 — Suite de aceptación: los 10 criterios

**Entrega:** `apps/tubodega/test/e2e/mvp-acceptance.e2e-spec.ts` que, sobre una organización recién creada y solo por API, ejecuta los 10 criterios de [00 §7](docs/specs/00-vision-y-alcance.md) **en orden y en una sola narrativa** (reutiliza helpers, no copia las suites de wave). Cada `it` se titula `Criterio N · …`. El criterio 1 se ejecuta **literal**: 500 productos, cada uno con al menos un código, una foto (500 `POST /v1/uploads` + 500 `POST …/media` en proceso, con `inject`) y un campo custom; si el presupuesto de 120 s se rompe, la suite se mueve a un job de CI aparte antes que recortar el criterio.

**Hecho cuando:** verde; es el `README` vivo del contrato.

### F6.2 — Purgas y programación de jobs

**Entrega:** `purge.job.ts` (idempotency 7 d, outbox publicados 30 d, alertas resueltas 90 d, media sin reclamar 24 h + borrado de archivo vía `MediaStorage.delete`), contexto de sistema, intervalos por `Clock` y env; `@nestjs/schedule` cableado para todos los jobs (la regla «no arrancan en test» viene de F1.11).

**Pruebas (integración):** cada purga borra lo caducado y respeta lo vigente; ejecutar dos veces es inocuo.

### F6.3 — Rate limiting

**Entrega:** `http/pipeline/rate-limit.interceptor.ts`, ventana deslizante por organización (D-12), cabeceras `RateLimit-*` en toda respuesta, `429 rate-limited` con `Retry-After`.

**Pruebas:** integración del borde con `RATE_LIMIT_PER_MINUTE=5`.

### F6.4 — Cobertura y puertas finales

**Entrega:** `vitest.config.ts` con `coverage.thresholds` por directorio (100/100/95/90/85) y `perFile: false`; `dependency-cruiser` con las 6 librerías; `pnpm typecheck` cubre `test/`; CI verde con las cinco puertas + snapshot OpenAPI; el checklist «todo endpoint del snapshot tiene un caso feliz y uno de error» ([06 §6](docs/specs/06-pruebas-y-calidad.md)) **ya no es manual y ya está entregado**: el runner de `pnpm blackbox` lo cruza en cada corrida contra los paths del contrato publicado y falla nombrando lo que falte (tanda 3c).

### F6.5 — Rendimiento nocturno

**Entrega:** `bench/seed.ts` (50 orgs, 5.000 productos, 500 nodos, 1.000.000 movimientos vía `appendMany` + `applyDelta`) y `bench/queries.bench.ts` con los cinco objetivos de [04 §7](docs/specs/04-persistencia.md); falla si supera el objetivo en más del 50 %; workflow `nightly.yml`.

### F6.6 — Contenedor y despliegue

**Entrega:** `compose.yaml` con `db` + `migrate` + `tubodega`, el entorno en un `.env.docker` versionado referenciado con `env_file:`, y `README` actualizado con comandos, roles y flujo de migración.

**Hecho cuando:** `docker compose up --build` sobre volumen limpio levanta la base, la migra y arranca la aplicación; `curl /v1/openapi.json` responde; un `POST /v1/organizations` real funciona contra el contenedor.

**Revisado, y entregada en el plan 3e:** las migraciones no corren en un entrypoint dentro de la imagen de producción, como decía la entrega original, sino en un **servicio `migrate` de un disparo** —patrón init container— que `tubodega` espera con `condition: service_completed_successfully`. El entrypoint habría obligado a meter el CLI de Prisma, `prisma.config.ts` y el directorio de migraciones dentro de la imagen que corre en producción, que es justo lo que [04 §5](docs/specs/04-persistencia.md) quiere evitar; el init container aplica las mismas migraciones, con el mismo advisory lock y el mismo rol, y deja la etapa `runtime` sin una sola línea de Prisma. La pila corre sobre su propia base `tubodega_docker`: contenedor y `pnpm start:dev` compartían `tubodega` pero guardan las fotos en sitios distintos. Lo que queda para el plan 10 es el despliegue de verdad, no el compose local.

---

## 6. Trazabilidad

### Criterios de éxito → dónde se demuestran

| Criterio | Wave (e2e) | Fases que lo sostienen |
|---|---|---|
| 1 · Importar 500 productos con códigos, fotos y campo custom | W2 #2-#4 (muestra) · F6.1 (los 500 con foto) | F2.1-F2.4, F2.7 |
| 2 · Árbol de tres niveles | W2 #12 | F2.5-F2.6 |
| 3 · Recepción que deja stock en un bin | W3 #2 (directo) · **W4 #2 (proceso)** | F3.*, F4.* |
| 4 · Traslado que cuadra | W3 #3 | F3.3-F3.5 |
| 5 · Préstamo con fecha marcado vencido | W3 #9 + **W5 #2** | F3.*, F5.* |
| 6 · Despacho reduce inventario propio | W3 #4 | F3.* |
| 7 · Compensación visible en histórico | W3 #7 | F3.2-F3.5 |
| 8 · Reconciliación ledger = `stock_balance` | W3 #14 + `test/invariants` | F3.4, F3.6 |
| 9 · `Idempotency-Key` no duplica | W1 #11, W3 #13, W4 #11 | F1.10 |
| 10 · Aislamiento entre organizaciones | W1 #9, W2 #16 + `rls.int-spec` | F1.2, F1.5, F1.9 |

### Invariantes → fase que las prueba

| Invariantes | Fase |
|---|---|
| I-1, I-2, I-8, I-11, I-12, I-14, I-16, I-17, I-18 (dominio) | F3.2 |
| I-3 (tipo + REVOKE), I-4, I-10, I-13 (constraints) | F1.4 (tipo), F1.5, F3.4 |
| I-5, I-9, I-18, conservación (propiedades) | F3.6 |
| I-6 (RLS + FK compuestas) | F1.5, F1.9 |
| I-7 | F1.10 |
| I-15 (C-8) | F2.2 |
| T-1..T-6 | F1.6-F1.9 |
| C-1..C-10 | F2.1-F2.3 |
| N-1..N-3 | F2.5-F2.6 |
| P-1..P-9 | F4.1-F4.4 |
| A-1..A-5 | F5.1-F5.3 |
| R-1..R-4 | F1.0 |

## 7. Verificación global

En cada fase, antes de cerrarla:

```bash
pnpm lint && pnpm typecheck && pnpm test
docker compose up -d db && pnpm db:check && pnpm test:e2e <ruta de la fase>
```

Al cerrar cada wave:

```bash
pnpm test:e2e                                    # integración (< 60 s) + e2e (< 120 s) + invariantes (< 180 s)
pnpm test:cov                                    # umbrales activados hasta esa wave (D-15)
git diff --exit-code apps/tubodega/openapi.json  # el contrato cambió solo si se quiso
```

Al cerrar la WAVE 6: además `docker compose up --build` y la suite `mvp-acceptance` contra el contenedor (`BASE_URL` en vez de `inject`).

## 8. Ejecución

1. Tras la aprobación, guardar la Parte C en `docs/superpowers/plans/2026-09-06-00-plan-maestro-mvp.md` y la Parte B en `docs/superpowers/plans/2026-09-06-01-primeros-endpoints.md`, y commitearlas junto con `docs/specs/` (hoy sin versionar).
2. Ejecutar el Plan 1 con `superpowers:subagent-driven-development` (recomendado: un subagente fresco por tarea, revisión entre tareas) o `superpowers:executing-plans`.
3. Antes de cada plan siguiente (2-10, Parte A), `superpowers:writing-plans` produce su documento detallado a partir de las fases de esta Parte C.
4. Una rama por plan (`plan/NN-<nombre>`), un commit por tarea como mínimo; `superpowers:finishing-a-development-branch` al cerrar cada plan con sus puertas verdes.
5. La suite e2e de cada wave es la puerta de cierre de los planes que la terminan (2, 4, 6, 8, 9, 10); no se abre el siguiente plan con el anterior en rojo.
# Parte A — División en planes

Cada plan es un documento propio (`docs/superpowers/plans/2026-MM-DD-NN-<nombre>.md`), escrito con `superpowers:writing-plans` justo antes de ejecutarlo, y cierra con algo que **tú puedes probar por HTTP**. El orden respeta las dependencias del maestro (Parte C); las fases `F<w>.<n>` a las que se refiere cada plan están ahí.

| Plan | Estado | Nombre | Fases del maestro | Qué puedes probar al terminar |
|---|---|---|---|---|
| **1** | **hecho** | **Primeros endpoints: registro, login y `/me`** | F1.0 (parcial), F1.1, F1.2 (solo tablas de tenancy), F1.3, F1.4 (base mínima), F1.6-F1.9 (parcial), F1.11 (parcial) | `POST /v1/organizations`, `POST /v1/auth/login`, `GET /v1/me`, `GET /v1/openapi.json`. RLS real, `problem+json`, `X-Request-Id`, token vencido, login ambiguo entre dos empresas. Con `curl` contra `pnpm start:dev` y Postgres de `docker compose`. |
| 2 | **hecho** | Cierre de la WAVE 1: equipo, sesiones e idempotencia | resto de F1.0, F1.2 (esquema completo, migración `0002`), F1.4 (DSL, `findPage`, tipo), F1.5, F1.7-F1.8 (resto), F1.10, F1.11 (resto) + e2e W1 | Usuarios y roles (`/v1/users`), refresh/logout, cambio de contraseña, `Idempotency-Key` con replay y `409`, `If-Match`, `404` cross-org, despachador de outbox en el log, CI con las cinco puertas, snapshot OpenAPI. |
| 3 | **hecho** | Catálogo, de punta a punta | F1.2 (`full_schema`), F1.5, F2.1-F2.4, F2.7 y los adaptadores de solo lectura de F2.6 | Los 18 endpoints de catálogo: productos, códigos, lotes/series, campos custom, import de 500 filas, fotos, escaneo `GET /v1/codes/{value}/resolve`. Suite `w2a-cargar-el-catalogo`. |
| **3b** | **hecho** *(derivado)* | Saldar la deuda del ciclo rojo-verde | — | 25 mutaciones probadas, las 25 rojas; la prueba que le faltaba al filtro de nodos custodiables; el spec 04 §5.1 corregido; el guion de caja negra recuperado. Merge `8231a1d`, bitácora en [03b](2026-09-12-03b-bitacora-mutaciones.md). |
| **3c** | **hecho** *(derivado)* | La caja negra cubre el contrato entero | — | `pnpm blackbox`: tres suites, 249 comprobaciones, y un cruce que exige de cada operación un camino feliz y uno de error ([06 §6](docs/specs/06-pruebas-y-calidad.md)). Job hermano en CI. Merge `22789d8`. |
| **3d** | **hecho** *(derivado)* | La colección de Postman al día | — | Las 30 operaciones en Postman, 70 peticiones afirmando su código. Merge `e1c0651`. |
| **3e** | **hecho** *(derivado)* | `docker compose up --build`, a la primera | F6.6 | La pila entera en contenedores sobre volumen limpio: `db` + `migrate` (init container con `prisma migrate deploy`) + `tubodega`, entorno en `.env.docker` versionado y base propia `tubodega_docker`. `POST /v1/organizations` contra el contenedor, y las tres suites de la caja negra en verde con `BASE=http://localhost:3001 DB=tubodega_docker`. |
| **3f** | **hecho** *(derivado)* | Un mundo sembrado, cuando haga falta | — | `pnpm seed` y `docker compose --profile seed up`: el reparto narrativo completo por HTTP —La Esquina, las cuatro personas, los campos propios, los cuatro SKU canónicos, un lote y una serie—, idempotente y con `SEED_SLUG` para sembrar mundos paralelos. |
| 4 | **hecho** | Ubicaciones y cierre de la WAVE 2 | F2.5, resto de F2.6 + e2e W2 | Los 7 endpoints de `/v1/nodes` con `tree` y `move`, `libs/inventory` (nodos), el sembrador de los ocho de frontera en `ORG_SEEDERS`, y la suite `w2-cargar-catalogo-y-ubicaciones` con los 21 casos. |
| **5** | **hecho** | **El ledger, de punta a punta** | F3.1-F3.5 *(re-cortado: la Parte A le daba solo F3.1-F3.4)* | Los 7 endpoints de [12 §7](docs/specs/12-inventory.md): `/v1/movements`, `/batch`, `/{id}`, `/{id}/reverse`, `/v1/stock`, `/v1/stock/custodies`. `Quantity`, `Movement`, los siete casos de uso, el `applyDelta` con savepoint y la suite de caja negra `30-movimientos`. Sin e2e W3 todavía. |
| **6** | **hecho** | **Cierre de la WAVE 3: las propiedades y la narrativa** | F3.6 + e2e W3 | `test/invariants/` con `fast-check` —I-5, conservación, I-9, I-18— y `w3-mover-mercancia.e2e-spec.ts` con 16 casos; criterios 3-4-6-7-8-9. Y **D-41**: la generación encontró que I-9 no valía al compensar un despacho. |
| 7 | pendiente | Motor de procesos: dominio y manejadores | F4.1-F4.2 | Sin endpoints nuevos; `LinearRunner` recorriendo las seis plantillas de fábrica en pruebas. |
| 8 | pendiente | Operar con procesos y cierre de la WAVE 4 | F4.3-F4.4 + e2e W4 | `/v1/process-templates`, `/v1/process-instances`, recepción guiada paso a paso con lote nuevo y foto; cancelación limpia. |
| 9 | pendiente | Alertas y cierre de la WAVE 5 | F5.1-F5.3 + e2e W5 | `/v1/alerts`, `/summary`, `/evaluate`, `/v1/alert-rules`; criterio 5 completo. |
| 10 | pendiente | Cierre del MVP | F6.1-F6.5 (F6.6 entregada en el plan 3e) | Suite `mvp-acceptance` con los 10 criterios, purgas, rate limit, cobertura, benchmark nocturno. |

Reglas de la división:

- Un plan no empieza con el anterior en rojo (`pnpm lint && pnpm typecheck && pnpm test && pnpm test:e2e`).
- Un plan no deja stubs en producción: si un puerto no tiene adaptador real todavía, el caso de uso que lo necesita **no se registra** en `app.module.ts` hasta el plan que lo trae.
- Cada plan termina con un commit por tarea y una rama `plan/NN-<nombre>` integrada con `superpowers:finishing-a-development-branch`.
- **Todo plan que añada endpoints actualiza la colección de Postman y `scripts/seed.sh`** en el mismo plan, no después. Los dos aparentan cubrir el contrato entero, así que uno que se queda atrás miente: la colección sale verde sin tocar lo nuevo, y el mundo sembrado parece completo mientras le falta justo lo que acabas de construir.
- La decisión D-1 del maestro cambia: **el esquema es incremental**, una migración por plan que lo necesite (`0001_tenancy` en el plan 1, `0002_full_schema` en el plan 2). Sigue siendo solo hacia adelante y `pnpm db:check` sigue vigilando que schema y migraciones coincidan.

---

