# Parte B — Plan 8: Operar con procesos, y el cierre de la WAVE 4

> Rama `plan/08-operar-con-procesos` · documento en `docs/superpowers/plans/2026-09-19-08-operar-con-procesos.md`
> Fases del maestro: **F4.3**, el resto de **F4.4** y la **e2e WAVE 4** *(re-corte, D-51)*

## Estado: **en ejecución** · 2026-09-19

---

## Context

El plan 7 dejó el motor entero y ninguna forma de arrancarlo. `libs/process` tiene el
`LinearRunner`, los ocho manejadores, las seis plantillas de fábrica sembradas al registrar
una organización y dos `GET` que las publican — pero:

- **`LinearRunner` no se instancia en ningún sitio de `src/`.** Solo lo construyen las
  pruebas. Ningún módulo lo registra.
- `ProcessInstanceRepository` y `StepCompletionRepository`, dos de los tres puertos de
  [13 §8](docs/specs/13-process.md), **no existen**.
- `HandlerDeps` solo lo implementa un doble de prueba (`test/doubles/fake-handler-deps.ts`).
- Cuatro errores están declarados y **nadie los lanza**: `process-instance-not-found`,
  `process-instance-id-taken`, `step-already-completed`, `template-has-instances`.
- `movement.process_instance_id` lleva desde `full_schema` esperando a que alguien lo llene,
  y `RecordMovementInput.processInstanceId` lo acepta desde el plan 5.

Este plan cierra la WAVE 4: las seis operaciones del negocio se pueden **ejecutar** paso a
paso por HTTP, con lote nuevo y foto en la misma confirmación, con cancelación limpia y con
plantillas versionables. Es el **criterio de éxito 3** en su forma definitiva, y lo demuestra
`w4-operar-con-procesos.e2e-spec.ts` con los 14 casos de la tabla del maestro.

**Lo que ya está y no se toca**, porque el plan 7 lo dejó apuntando aquí:

| Qué | Dónde, y qué dice su comentario |
|---|---|
| `parseSteps` exportado | `domain/template.ts` — «porque `CreateTemplateVersion` del plan 8 necesita la misma respuesta antes de escribir una fila» |
| `AdvanceOutcome.payload` | `domain/runner.ts` — «parseado, para que quien llame escriba el `step_completion` sin volver a parsear» |
| `ProcessTemplateDao.hasInstances` | «plan 8, que escribe esa tabla, trae el suyo [DAO]» |
| `RecordMovementBatch` | su cabecera dice que es la puerta que usará el `CONFIRM` de la spec 13 |
| Las tres tablas | migradas en `full_schema`, con la FK compuesta que es P-1 y el `UNIQUE (org_id, instance_id, step_id)` que es P-3 |

**Ninguna acción nueva.** Los seis endpoints se reparten entre `RECORD_MOVEMENT`,
`MANAGE_CATALOG` y `READ`; la matriz de 32 casos no se toca. El `OPERATOR` tiene
`RECORD_MOVEMENT` y `CREATE_BATCH` y no tiene `MANAGE_CATALOG`, que es exactamente el reparto
que piden los casos 12 y 14 de la e2e.

---

## Global Constraints (heredadas)

- Dominio puro (R-1); `process → tenancy, catalog, inventory` y nada más (R-2); solo
  barriles (R-3). **Ni un puerto puente** (D-46): `CreateBatch`, `RecordMovementBatch` y
  `AttachMedia` se inyectan por clase, y los repositorios por su token.
- La autorización es la primera línea de cada `execute`, nunca el borde.
- Comentarios de código **en inglés**; `detail` de errores y descripciones de pruebas
  **en español**.
- **Test primero, y el ciclo rojo-verde se ve**: cada Step «Run → FAIL» se ejecuta de verdad
  y se anota qué falló. *(En el plan 7 esto se incumplió en la Task 5; aquí no.)*
- Cobertura: `libs/process/src/domain/**` sigue al **100 %** líneas y ramas;
  `application/**` al 90 %. El listón es `pnpm test:cov` **entero** — filtrar por librería no
  puede pasar, porque deja sin correr las pruebas de los otros umbrales.
- Las seis puertas antes de cerrar: `pnpm lint`, `pnpm typecheck`, `pnpm db:check`,
  `pnpm test`, `pnpm test:e2e`, `pnpm blackbox`.
- Todo plan que añade endpoints actualiza **Postman y `scripts/seed.sh`** en el mismo plan.
- La caja negra corre **contra un proceso propio en un puerto libre**. Al empezar este plan
  había algo escuchando en `:3000` y un contenedor `tubodega` *unhealthy*: verificar ahí es
  comprar un falso verde.

---

## Decisiones heredadas que mandan aquí

| # | Qué obliga |
|---|---|
| **D-46** | No se escribe ni un puerto puente hacia catalog o inventory |
| **D-49** | El `REVOKE UPDATE, DELETE ON step_completion` entra en migración propia con este plan |
| **D-50** | La suite de caja negra es `35-procesos.sh`, que ya existe y crece |
| **D-51** | Este re-corte: el plan 7 se llevó la mitad de lectura, este se lleva las instancias |
| **D-52** | `upload-not-found` es el de `@app/catalog`; `process` no declara un gemelo |
| **D-55** | Los efectos se piden solo al completar. P-6 es estructura, no convención |
| **D-56** | `validate` devuelve el payload enriquecido, y **eso** es lo que guarda `step_completion` |
| **D-57** | `advance` es `async` y recibe los deps; `start` recibe el `id` |
| **D-58** | `CAPTURE_PHOTO` no comprueba la zona de espera: lo hace `AttachMedia` al aplicar el efecto |

---

## Decisiones nuevas (continúan en D-60)

| # | Qué decide |
|---|---|
| **D-60** | **`GET /v1/process-templates` rechaza toda clave de query desconocida** con `400 invalid-filter`, y sigue sin paginar. Cierra D-59: era la única colección del contrato que se tragaba un `?limit=2` en silencio. Es una guarda de claves, no `parsePage` — que traería una paginación que el recurso no quiere |
| **D-61** | **`POST /v1/process-templates/{code}/versions` recibe `{ version, steps }`**, con la versión propuesta por el cliente. Choque contra `(org_id, code, version)` → **`409 template-version-taken`** (error nuevo, molde de `movement-id-taken`); una versión que no supera a la activa → `422 invalid-template`. La nueva queda activa y **todas** las demás del código se desactivan; las instancias abiertas siguen resolviendo la suya (P-9) |
| **D-62** | **`GET /v1/process-instances` ordena solo por `createdAt`, descendente por defecto** (molde D-37: solo la columna indexada). La migración del plan añade `(org_id, created_at DESC)` **además** del `REVOKE` de D-49, y el `@@index` gemelo en `schema.prisma` para que `pnpm db:check` siga saliendo 0 |
| **D-63** | **`GET /v1/process-instances/{id}` devuelve `currentStep`** —la definición completa, no el id— cuando la instancia está `OPEN`, junto a `completions[]`. Quien retoma una instancia abandonada no tiene que ir a buscar la plantilla, que es la propiedad por la que `complete` devuelve la definición |
| **D-64** | **`ProcessContext` ⇄ JSONB se serializa a mano** en `repositories/process/mapping.ts`, no con un `JSON.stringify` del objeto. `values` es un `Map`, `draft.quantity` es un `Quantity` y hay `Date` dentro de los payloads (`expiresAt`, `dueAt`): los tres se pierden en un `stringify` ingenuo, y el fallo saldría al **rehidratar**, media instancia después |
| **D-65** | **`HandlerDeps` lo construye `handlerDeps(ctx)`**, una fábrica de `application/`, no un puerto. Cierra sobre el `RequestContext` porque `ResolveCode.execute(ctx, raw)` lo exige mientras que la firma del dep es `(orgId, raw)` |
| **D-66** | **`ProcessModule` registra `LinearRunner` bajo el token `PROCESS_RUNNER`** con `mvpRegistry()`. `GraphRunner` será cambiar esa línea, que es lo que la interfaz existía para permitir |

---

## Mapa de archivos

```
libs/process/
  src/domain/errors.ts                    + TemplateVersionTakenError (D-61)      (M)
  src/application/
    ports/{process-instance.repository.ts, step-completion.repository.ts}
    events.ts                             processEvent(), los cuatro de [13 §11]
    handler-deps.factory.ts               handlerDeps(ctx) — D-65
    effect-applier.ts                     CREATE_BATCH → EMIT_MOVEMENTS → ATTACH_MEDIA
    use-cases/{start-process, complete-step, cancel-process,
               get-process-instance, list-process-instances,
               create-template-version}.ts                        + spec cada uno
  src/process.module.ts                   runner, deps, applier, los seis casos    (M)
  src/index.ts                                                                     (M)
  test/builders/an-instance.ts
  test/doubles/{in-memory-instance.repository.ts,
                in-memory-step-completion.repository.ts}

libs/persistence/
  prisma/schema.prisma                    @@index([orgId, createdAt(Desc)])        (M)
  prisma/migrations/2026…_process_append_only/migration.sql   REVOKE (D-49) + índice
  src/models/index.ts                     los cinco alias nuevos                   (M)
  src/dao/process-instance.dao.ts         AbstractOrgDao, versioned = TRUE
  src/dao/step-completion.dao.ts          AbstractOrgAppendDao
  src/repositories/process/{instance.repository.ts, step-completion.repository.ts}
  src/repositories/process/mapping.ts     contexto ⇄ JSONB (D-64)                  (M)
  src/index.ts                                                                     (M)
  test/repositories/process/instance.repository.int-spec.ts

apps/tubodega/
  src/http/process-instances/{process-instances.controller.ts, .dto.ts}
  src/http/process-templates/process-templates.controller.ts  + versions, + D-60   (M)
  src/http/process-templates/process-templates.dto.ts         CreateVersionDto     (M)
  src/http/shared/views.ts                processInstanceView, stepCompletionView  (M)
  src/app.module.ts                       el controlador nuevo                     (M)
  src/adapters/adapters.module.ts         los dos tokens nuevos                    (M)
  openapi.json                            seis operaciones nuevas                  (M)
  test/edge/openapi.int-spec.ts           la lista literal de paths                (M)
  test/e2e/w4-operar-con-procesos.e2e-spec.ts       los 14 casos

scripts/blackbox/lib.sh                   plantilla() aprende cuatro rutas         (M)
scripts/blackbox/35-procesos.sh           feliz + error por cada operación nueva   (M)
scripts/seed.sh                           una RECEPCION guiada de verdad           (M)
docs/postman/tubodega.postman_collection.json     la carpeta «Procesos» crece      (M)
README.md                                 la tabla de endpoints y el estado W4     (M)
docs/superpowers/plans/2026-09-06-00-plan-maestro-mvp.md   D-60..D-66, fila 8      (M)
```

---

## Tasks

### Task 0: Rama y documento del plan

- [x] **Step 1:** `git checkout -b plan/08-operar-con-procesos`
- [x] **Step 2:** Este documento.
- [x] **Step 3: Commit** `docs(plan): plan 8 — operar con procesos`

---

### Task 1: Los dos puertos que faltan, y el error de D-61

**Files:** `libs/process/src/application/ports/{process-instance.repository.ts,
step-completion.repository.ts}`; `libs/process/src/domain/errors.ts` (M) + spec;
`libs/process/test/doubles/{in-memory-instance.repository.ts,
in-memory-step-completion.repository.ts}`; `libs/process/test/builders/an-instance.ts`;
`libs/process/src/index.ts` (M)

- [x] **Step 1: spec primero** para `TemplateVersionTakenError`: `type`
      `template-version-taken`, estado 409, y el `detail` nombra código y versión.
- [x] **Step 2: Run** → **FAIL**, anotar.
- [x] **Step 3: los dos puertos.** `ProcessInstanceRepository { findById, list(orgId,
      filter, page), save(instance, expectedVersion?): Promise<number> }` y
      `StepCompletionRepository { listByInstance, append }`, cada uno con su `Symbol`.
      `save` devuelve la versión guardada (molde D-31) aunque la vista **no** la exponga:
      [13 §9] dice que `process_instance.version` es lock interno y no contrato, y ningún
      endpoint pide `If-Match`.
- [x] **Step 4: los dobles** en memoria, con comportamiento: el de instancias respeta el
      lock óptimista y el de completados rechaza el `(instanceId, stepId)` repetido, que es
      P-3. Un doble que no muerda deja la Task 5 probando nada.
- [x] **Step 5: Run** `pnpm test` → PASS.
- [x] **Step 6: Commit** `feat(process): los puertos de instancia, y el error de la versión repetida`

---

### Task 2: Abrir una instancia, cancelarla y consultarla

**Files:** `libs/process/src/application/events.ts`;
`libs/process/src/application/use-cases/{start-process,cancel-process,
get-process-instance,list-process-instances}.ts` + specs

- [x] **Step 1: spec primero** de los cuatro, con los dobles de la Task 1:
      `requireAction` como primera línea (`RECORD_MOVEMENT` los dos primeros, `READ` los
      dos últimos); `StartProcess` sobre un código sin versión activa → `404
      template-not-found`; `CancelProcess` sobre una cerrada → `409 instance-closed` y
      **sin invocar nada** (P-6); `GetProcessInstance` de otra organización → `404`
      (I-6, nunca 403); `ListProcessInstances` filtra por los tres campos.
- [x] **Step 2: Run** → **FAIL**, anotar.
- [x] **Step 3: implementar.** `StartProcess` acuña el id con `IdGenerator` si el cliente no
      lo trae, llama a `runner.start` y devuelve `{ instance, nextStep }`.
      `GetProcessInstance` carga la plantilla **en la versión de la instancia** (P-1) para
      poder devolver `currentStep` (D-63).
- [x] **Step 4:** `application/events.ts` con `processEvent()` y los cuatro tipos de
      [13 §11], molde de `inventoryEvent`. Aquí se publican `process.started` y
      `process.cancelled`.
- [x] **Step 5: Run** → PASS.
- [x] **Step 6: Commit** `feat(process): abrir una instancia, cancelarla y consultarla`

---

### Task 3: Los deps del manejador, y el runner registrado

**Files:** `libs/process/src/application/handler-deps.factory.ts` + spec;
`libs/process/src/process.module.ts` (M)

- [x] **Step 1: spec primero:** las siete entradas de `HandlerDeps` resuelven contra los
      repositorios reales, y el `orgId` sale del `ctx`.
- [x] **Step 2: Run** → **FAIL**, anotar.
- [x] **Step 3: implementar** `handlerDeps(ctx)` (D-65). Cierra sobre el `RequestContext`
      porque `ResolveCode.execute(ctx, raw)` lo exige mientras que la firma del dep es
      `(orgId, raw)`; las otras cinco se atan directas a los métodos del repositorio, que ya
      tienen la firma exacta (D-46).
- [x] **Step 4:** `ProcessModule` gana `PROCESS_RUNNER` → `LinearRunner(mvpRegistry())`
      (D-66), e **importa `CatalogModule` e `InventoryModule`** para poder inyectar sus
      casos de uso por clase.
- [x] **Step 5: Run** `pnpm test && pnpm typecheck` → PASS.
- [x] **Step 6: Commit** `feat(process): los deps del manejador, y el runner registrado`

---

### Task 4: El aplicador de efectos

**Files:** `libs/process/src/application/effect-applier.ts` + spec

- [ ] **Step 1: spec primero**, con **espías sobre los casos de uso reales** (`CreateBatch`,
      `RecordMovementBatch`, `AttachMedia`) y no sobre `Recording*Port`, que ya no existen
      (D-46): el orden es `CREATE_BATCH` → `EMIT_MOVEMENTS` → `ATTACH_MEDIA`; el `id` del
      lote recién creado aterriza en `drafts[feeds].batchId` **antes** de emitir nada; sin
      `CREATE_BATCH` no se llama a `CreateBatch`; sin claves no se llama a `AttachMedia`.
- [ ] **Step 2: Run** → **FAIL**, anotar.
- [ ] **Step 3: implementar.** `occurredAt` lo pone el `Clock` —una instancia puede llevar
      abierta desde ayer, y la hora del asiento es el instante en que se confirma— y
      `processInstanceId` se estampa aquí: es lo que por fin llena la columna. `AttachMedia`
      se llama en su forma `storageKeys`, la que exige `RECORD_MOVEMENT` (D-14) y la que
      lanza el `upload-not-found` de `@app/catalog` (D-52, D-58).
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(process): el aplicador de efectos, y el asiento que sale del confirmar`

---

### Task 5: Completar un paso — los doce de [13 §7]

**Files:** `libs/process/src/application/use-cases/complete-step.ts` + spec

- [ ] **Step 1: spec primero:** paso equivocado → `409 wrong-step` con el actual en
      `extensions`; repetido → `409 step-already-completed`; cerrada → `409
      instance-closed`; **P-6**: ningún espía recibe nada hasta `CONFIRM`; el
      `step_completion` guarda el payload **enriquecido** que devolvió `validate` (D-56), y
      un paso omitido guarda el literal JSON `null`.
- [ ] **Step 2: Run** → **FAIL**, anotar.
- [ ] **Step 3: implementar** la secuencia de [13 §7] en orden. Devuelve
      `{ instance, nextStep?, movements? }`. Publica `process.step_completed` y, al cerrar,
      `process.completed`.
- [ ] **Step 4: Run** → PASS, y `pnpm test:cov` para ver `application/**` por encima de 90.
- [ ] **Step 5: Commit** `feat(process): completar un paso, y los doce pasos de la spec 13 §7`

---

### Task 6: Versionar una plantilla

**Files:** `libs/process/src/application/use-cases/create-template-version.ts` + spec

- [ ] **Step 1: spec primero:** `MANAGE_CATALOG`; crea `v2` y **desactiva todas** las demás
      del código; una instancia abierta en `v1` sigue resolviendo `v1`; las reglas de D-61.
      Reutiliza `parseSteps` —ya exportado para esto— así que hereda
      `branching-not-supported`, `unknown-step-type` e `invalid-template` sin escribir
      validación nueva.
- [ ] **Step 2: Run** → **FAIL**, anotar.
- [ ] **Step 3: implementar.** Nota de [13 §12]: `template-has-instances` **sigue sin ruta
      que lo produzca** —no hay edición, solo versionado— y `hasInstances` queda disponible.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(process): versionar una plantilla, sin tocar la anterior`

---

### Task 7: Persistencia, y la migración de D-49

**Files:** `libs/persistence/src/models/index.ts` (M);
`libs/persistence/src/dao/{process-instance.dao.ts, step-completion.dao.ts}`;
`libs/persistence/src/repositories/process/{instance.repository.ts,
step-completion.repository.ts, mapping.ts (M)}`;
`libs/persistence/prisma/schema.prisma` (M) + migración nueva;
`libs/persistence/src/index.ts` (M);
`libs/persistence/test/repositories/process/instance.repository.int-spec.ts`

- [ ] **Step 1: spec primero** (integración): type-spec de que `StepCompletionDao` no tiene
      `update`, `upsert` ni `delete`; **P-1** (instancia con versión inexistente → `23503`);
      **P-3** bajo concurrencia (dos `append` al mismo paso: uno gana, una sola fila); ida y
      vuelta del contexto por `jsonb` con `Quantity`, `Date` y el `Map`.
- [ ] **Step 2: Run** → **FAIL**, anotar.
- [ ] **Step 3: los DAOs.** `ProcessInstanceDao` con `versioned =` **`true`** — aquí
      `version` **sí** es lock óptimista y la tabla **sí** tiene `updated_at`: es la trampa
      del plan 7 al revés, y equivocarla en cualquiera de los dos sentidos rompe algo.
      `StepCompletionDao` extiende `AbstractOrgAppendDao`.
- [ ] **Step 4: el mapeo del contexto (D-64)**, que es lo delicado: `values` es un `Map`,
      `draft.quantity` es un `Quantity` y hay `Date` dentro de los payloads.
- [ ] **Step 5: los repositorios**, con el `translate` de la casa: `23505` sobre
      `process_instance_pkey` → `process-instance-id-taken`, sobre
      `step_completion_org_id_instance_id_step_id_key` → `step-already-completed`.
- [ ] **Step 6: la migración.** `REVOKE UPDATE, DELETE ON step_completion FROM tubodega_app,
      tubodega_system` (D-49) y el índice de D-62, más el `@@index` gemelo en
      `schema.prisma`. `pnpm db:check` tiene que salir **0**.
- [ ] **Step 7: Run** `pnpm test:e2e libs/persistence` → PASS.
- [ ] **Step 8: Commit** `feat(persistence): las instancias y sus pasos, append-only de verdad`

---

### Task 8: Los seis endpoints

**Files:** `apps/tubodega/src/http/process-instances/{process-instances.controller.ts,
process-instances.dto.ts}`; `apps/tubodega/src/http/process-templates/*` (M);
`apps/tubodega/src/http/shared/views.ts` (M); `apps/tubodega/src/app.module.ts` (M);
`apps/tubodega/src/adapters/adapters.module.ts` (M); `apps/tubodega/openapi.json` (M);
`apps/tubodega/test/edge/openapi.int-spec.ts` (M)

- [ ] **Step 1: los controladores**, molde exacto de `movements.controller.ts`:
      `@ApiTags('process')`, `@Ctx()` primero, `UuidParam` en `{id}` y **no** en `{code}`
      ni en `{stepId}`, `Location` en los `201`, todo error declarado como
      `ProblemDetailsView` con los slugs separados por ` · `.
- [ ] **Step 2: el listado.** `PAGE_OPTIONS = { sortable: ['createdAt'], defaultSort:
      '-createdAt', filters: ['state','templateCode','actorId'] }` y un `parseFilters` que
      valide el enum — `?state=FOO` es `400 invalid-filter`, no una página vacía.
- [ ] **Step 3: D-60.** La guarda de claves en `GET /v1/process-templates`.
- [ ] **Step 4: el cableado.** Los dos tokens en `adapters.module.ts`, el controlador en
      `app.module.ts`. Los tres `POST` **no** se eximen de `Idempotency-Key`.
- [ ] **Step 5: el snapshot.** La lista literal de paths de `openapi.int-spec.ts`,
      `pnpm openapi:write`, y **contar el diff de verdad** antes de escribir el número en la
      bitácora: el plan 7 lo puso mal.
- [ ] **Step 6: Run** `pnpm lint && pnpm typecheck && pnpm test:e2e` → PASS.
- [ ] **Step 7: Commit** `feat(http): las instancias de proceso, y el versionado de plantillas`

---

### Task 9: Caja negra, Postman y seed

**Files:** `scripts/blackbox/lib.sh` (M); `scripts/blackbox/35-procesos.sh` (M);
`scripts/seed.sh` (M); `docs/postman/tubodega.postman_collection.json` (M)

- [ ] **Step 1:** `plantilla()` aprende las cuatro rutas nuevas, **las más específicas
      primero** (`…/{code}/versions`, `…/{id}/steps/{stepId}/complete`, `…/{id}/cancel`,
      `…/{id}`). Sin esto el cruce de contrato da las operaciones por no ejercitadas y el
      verde es falso.
- [ ] **Step 2:** `35-procesos.sh` recorre una `RECEPCION` entera y un camino de error por
      cada operación nueva, que es lo que el cruce del runner exige.
- [ ] **Step 3: Run** contra un proceso propio **en un puerto libre**, comprobando antes con
      `ss -ltnp` quién responde.
- [ ] **Step 4:** `scripts/seed.sh` deja por fin una instancia guiada —es lo que su cabecera
      reserva desde el plan 3f— y la fila «instancias de proceso … plan 8» desaparece.
- [ ] **Step 5:** Postman gana el par feliz/error por operación.
- [ ] **Step 6: Commit** `test(blackbox): los procesos, de punta a punta por el socket`

---

### Task 10: La e2e de la WAVE 4

**Files:** `apps/tubodega/test/e2e/w4-operar-con-procesos.e2e-spec.ts`

- [ ] **Step 1:** los **14 casos** de la tabla «E2E WAVE 4» del maestro, en orden y
      encadenados como w3 (los saldos se arrastran). Narrativa: Juan opera con el teléfono
      siguiendo lo que el servidor le indica y **nunca consulta la plantilla** — cada
      `complete` usa el `nextStep` de la respuesta anterior. Solo el contrato público: ni
      una consulta a la base ([06 §6]).
- [ ] **Step 2: Run** → verde en < 20 s.
- [ ] **Step 3: Commit** `test(e2e): operar con procesos — el cierre de la WAVE 4`

---

### Task 11: La bitácora

**Files:** este documento; `README.md`; el maestro

- [ ] **Step 1:** cerrar este documento con lo ejecutado, lo que se encontró y no estaba
      previsto, las desviaciones, y «lo que encontró cada capa de prueba».
- [ ] **Step 2:** `README.md` — la tabla de endpoints, el estado de la WAVE 4 y la fila del
      seed.
- [ ] **Step 3:** el maestro: D-60..D-66 y la fila 8 de la Parte A a **hecho**.
- [ ] **Step 4:** las seis puertas.
- [ ] **Step 5: Commit** `docs(plan): la bitácora del plan 8`

---

## Verificación de extremo a extremo

```bash
docker compose up -d db

pnpm lint && pnpm typecheck && pnpm db:check && pnpm test
pnpm test:e2e                       # incluye w4 (< 20 s) y los int-spec de P-1/P-3/P-7
pnpm test:cov                       # entero: domain/** de process sigue al 100 %

git diff --exit-code apps/tubodega/openapi.json    # tras openapi:write: sin cambios

pnpm build
PORT=3100 node dist/apps/tubodega/main &
ss -ltnp | grep :3100               # que responda EL binario recién compilado
BASE=http://localhost:3100 pnpm blackbox           # cruce sin huecos → exit 0
BASE=http://localhost:3100 pnpm seed
```

`pnpm db:check` tiene que salir **0**: la migración nueva y `schema.prisma` llevan el mismo
índice, y el `REVOKE` no lo introspecciona `prisma migrate diff` — igual que el
`text_pattern_ops` de D-1.

---

## Qué queda fuera del plan 8 (y dónde entra)

| Qué | Dónde |
|---|---|
| Alertas: `/v1/alerts`, `/summary`, `/evaluate`, `/v1/alert-rules` | Plan 9 |
| `mvp-acceptance`, purgas, rate limit, cobertura global | Plan 10 |
| Editar una plantilla **sembrada** sin versionarla (y con ello, una ruta para `template-has-instances`) | Fuera del MVP — [13 §14] |
| Instancias multi-línea, ramas (`GraphRunner`), pasos nuevos | Fuera del MVP — [90 §12] |
