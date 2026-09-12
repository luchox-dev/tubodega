# Parte B — Plan 7: El motor de procesos, y las plantillas publicadas

> Rama `plan/07-el-motor-de-procesos` · documento en `docs/superpowers/plans/2026-09-12-07-el-motor-de-procesos.md`
> Fases del maestro: **F4.1**, **F4.2** y la mitad de lectura de **F4.4** *(re-cortado, D-51)*

## Estado: **en curso**

---

## Context

El plan 6 cerró la WAVE 3: hay catálogo, hay ubicaciones y hay ledger. Lo que no hay es
**forma de guiar a nadie**. `libs/process` no existe —ni scaffold— aunque el repo lleva
meses preparándole el sitio:

- `libs/common/src/ids.ts` ya declara `ProcessInstanceId`, con un comentario que explica
  que vive ahí porque lo referencia `inventory`.
- `movement.process_instance_id` existe en la base desde `full_schema`, y
  `RecordMovementInput.processInstanceId` lo acepta. **Nadie lo llena todavía.**
- `RecordMovementBatch` lleva escrito en su cabecera que es «la puerta que usará el
  `CONFIRM` de la spec 13».
- Las tres tablas (`process_template`, `process_instance`, `step_completion`) están
  migradas, con la FK compuesta que convierte P-1 en una garantía de base de datos y el
  `UNIQUE (org_id, instance_id, step_id)` que es P-3.
- El comentario de `org-provisioner.adapter.ts` dice «Plans 4, 8 and 9 each add their
  seeder».
- `.dependency-cruiser.cjs` ya nombra `process` en las reglas R-2 de las otras tres.

Todo apunta a este plan, y ninguna línea de código lo empieza.

**Por qué el re-corte (D-51).** La Parte A le daba al plan 7 «F4.1-F4.2, sin endpoints
nuevos», con `pnpm test` como única puerta. Eso choca con su propia regla —cada plan cierra
con algo probable por HTTP— y es el mismo motivo por el que el plan 3 se re-cortó (D-19) y
el plan 5 se llevó F3.5. Este plan se lleva además **la mitad de lectura de F4.4**: el DAO y
el repositorio de `process_template`, el sembrador de las seis plantillas de fábrica y los
dos `GET` de `/v1/process-templates`. Al terminar, registrar una organización deja seis
plantillas sembradas y visibles con `curl`. El plan 8 se queda con las instancias.

**Los specs venían mal, y ya se corrigieron.** El refinamiento del 2026-09-12 encontró 26
huecos y contradicciones entre [13](docs/specs/13-process.md) y [14](docs/specs/14-alerts.md).
Los que este plan ejecuta:

| Qué decía el spec | Qué dice ahora |
|---|---|
| `validate(payload, ctx, deps)` y `apply(payload, ctx)` | Las dos reciben el `config` del paso. Sin él, `SELECT_NODE` no puede leer `role` ni `allowedKinds`, y `CONFIRM` no puede resolver sus `defaults` — que es justo lo que §5 les pide |
| `HandlerDeps` con tres lecturas | Seis lecturas y un reloj: `CAPTURE_BATCH` busca lote por `lotCode` **y** por serie, `CONFIRM` resuelve nodos por **código**, y `SET_DUE_DATE` pregunta por el ahora |
| `CAPTURE_PHOTO` aporta «efecto `ATTACH_MEDIA`» | Acumula `storageKeys` en el contexto. `apply` devuelve un `ProcessContext` y P-6 dice que los efectos salen al completar: el manejador no tenía por dónde devolver un efecto |
| `ProcessContext.draft: MovementDraft[]` con `withDraft` en singular | Un borrador, y `withDraft` **funde**. §3 ya decía «una instancia produce a lo sumo un movimiento» |
| Cinco plantillas como diagrama ASCII | Las seis en JSONC, con `id`, `required`, `config` y `transitions`. Un esquema sin ids no se puede sembrar |
| Seis puertos puente en §8 | Ninguno (D-46): los métodos existen con la firma exacta en catalog e inventory |

**No hace falta migración.** Las tres tablas están; `prisma-kysely` ya generó
`ProcessTemplate`, `ProcessInstance` y `StepCompletion` en `db.ts`. El `REVOKE` de
`step_completion` (D-49) va con el plan 8, que es quien escribe en esa tabla.

---

## Global Constraints (heredadas)

- Dominio puro: `libs/process/src/domain` no importa `@nestjs`, `kysely`, `pg` ni
  `application/` (R-1). **Sí puede importar `@app/inventory` y `@app/catalog`**: R-1 prohíbe
  la infraestructura, no el dominio vecino, y F4.1 exige que el borrador final pase
  `Movement.create`.
- `process → tenancy, catalog, inventory` y nada más (R-2). La regla que falta —`process`
  contra `alerts`— la añade este plan (D-48).
- Solo barriles (R-3): `@app/inventory`, nunca un fichero interno.
- La autorización no vive en el borde: primera línea de cada `execute`. **Ninguna acción
  nueva**: `READ` cubre los dos `GET` de este plan, y la matriz de 32 casos no se toca.
- Comentarios de código **en inglés**; `detail` de errores y descripciones de pruebas
  **en español**.
- Test primero, y **el ciclo rojo-verde se ve**: cada Step «Run → FAIL» se ejecuta de verdad
  y se anota qué falló antes de escribir la implementación.
- Las seis puertas antes de cerrar: `pnpm lint`, `pnpm typecheck`, `pnpm db:check`,
  `pnpm test`, `pnpm test:e2e`, `pnpm blackbox`.
- Cobertura: `libs/process/src/domain/**` al **100 %** líneas y ramas desde este plan (D-15);
  `application/**` al 90 %.
- **Todo plan que añade endpoints actualiza Postman y `scripts/seed.sh` en el mismo plan.**
- La caja negra corre **contra un proceso propio en un puerto libre**. Un `nest --watch`
  colgado en el `:3000` sirve un build viejo, y el falso verde es tuyo.

---

## Decisiones heredadas que mandan aquí

| # | Qué obliga |
|---|---|
| **D-46** | No se escribe ni un puerto puente. `HandlerDeps` son funciones que la `application/` construye desde `ResolveCode`, `NODE_REPOSITORY`, `PRODUCT_REPOSITORY` y `BATCH_REPOSITORY` |
| **D-48** | El alta de `libs/process` son seis ficheros, y es la Task 1 entera |
| **D-50** | La suite de caja negra es `35-procesos.sh` |
| **D-51** | Este re-corte |
| **D-26** | `SeedFactoryTemplates.execute(orgId)` no recibe `RequestContext`, no llama a `requireAction` y no publica eventos |
| **D-15** | El umbral de cobertura se activa en la fase que crea el directorio, no al final |

Las decisiones nuevas de este plan continúan la serie en **D-52**.

---

## Mapa de archivos

```
nest-cli.json                       projects.process                              (M)
tsconfig.json                       paths + references                            (M)
vitest.config.ts                    alias + umbrales de libs/process              (M)
vitest.config.e2e.ts                alias                                         (M)
.dependency-cruiser.cjs             R-2 process ↛ alerts                          (M)

libs/process/
  tsconfig.lib.json                 copia del de inventory
  src/index.ts                      el barril
  src/process.module.ts             los casos de uso de este plan
  src/domain/
    ids.ts                          StepId, TemplateCode           + spec
    step-types.ts                   StepType, StepPayload, StepConfig
    errors.ts                       los 16 de [13 §12]
    template.ts                     ProcessTemplate + validador    + spec
    factory-templates.ts            las seis, copiadas de [13 §6]  + spec
    instance.ts                     ProcessInstance                + spec
    context.ts                      ProcessContext                 + spec
    drafts.ts                       MovementDraft, BatchDraft
    step-completion.ts              StepCompletion
    effects.ts                      Effect
    runner.ts                       ProcessRunner (interfaz)
    linear-runner.ts                LinearRunner                   + spec
    handlers/
      registry.ts                   StepHandlerRegistry            + spec
      {scan-item,capture-batch,capture-qty,capture-photo,
       select-node,set-due-date,capture-reason,confirm}.ts         + spec cada uno
    walkthrough.spec.ts             las seis plantillas ×3 modos, hasta Movement.create
  src/application/
    ports/process-template.repository.ts
    use-cases/{list-templates,get-active-template,seed-factory-templates}.ts + spec
  test/{builders/a-template.ts, doubles/in-memory-template.repository.ts,
        doubles/fake-handler-deps.ts}

libs/persistence/
  src/models/index.ts               ProcessTemplateModel/New/Patch                (M)
  src/dao/process-template.dao.ts
  src/repositories/process/{template.repository.ts, mapping.ts}
  src/index.ts                      exporta el DAO nuevo                          (M)
  test/repositories/process/template.repository.int-spec.ts

apps/tubodega/
  src/adapters/process/factory-templates.seeder.ts
  src/adapters/adapters.module.ts   ORG_SEEDERS gana una entrada                  (M)
  src/app.module.ts                 ProcessModule + el controlador                (M)
  src/http/process-templates/{process-templates.controller.ts, process-templates.dto.ts}
  openapi.json                      dos operaciones nuevas → 46                   (M)
  test/edge/openapi.int-spec.ts     la lista literal de paths                     (M)
  test/edge/org-seeding.int-spec.ts las seis plantillas tras registrar            (M)

scripts/blackbox/lib.sh             plantilla() aprende /process-templates/{code} (M)
scripts/blackbox/35-procesos.sh     la suite nueva
scripts/seed.sh                     comprueba las seis sembradas                  (M)
docs/postman/tubodega.postman_collection.json   carpeta «Procesos»                (M)
README.md                           la fila del seed, y el estado de la WAVE 4    (M)
```

---

## Tasks

### Task 0: Rama y documento del plan

- [x] **Step 1:** `git checkout -b plan/07-el-motor-de-procesos`
- [x] **Step 2:** Este documento.
- [x] **Step 3: Commit** `docs(plan): plan 7 — el motor de procesos`

---

### Task 1: El alta de `libs/process`, y los tipos que no dependen de nada

**Files:** `nest-cli.json`, `tsconfig.json`, `vitest.config.ts`, `vitest.config.e2e.ts`,
`.dependency-cruiser.cjs`, `libs/process/tsconfig.lib.json`,
`libs/process/src/{index.ts, domain/ids.ts, domain/step-types.ts, domain/errors.ts}`

- [x] **Step 1: los seis ficheros del andamiaje** (D-48). Copiar de `inventory` en cada uno.
      `tsconfig.json` lleva **las dos cosas**: `paths['@app/process']` apuntando al
      `index.ts` —bajo `moduleResolution: nodenext` un directorio no resuelve por índice— y
      una entrada en `references`. Los alias de vitest están **duplicados a mano en dos
      ficheros**: el que se olvide falla solo en `pnpm test:e2e`, media hora después.
- [x] **Step 2: la regla R-2 que falta.** `.dependency-cruiser.cjs` nombra `process` y
      `alerts` en las reglas de tenancy, catalog e inventory, lo que hace *parecer* que
      están cubiertos. No hay ninguna que impida `process → alerts`. Probarla con un import
      prohibido temporal, ver `pnpm lint` en rojo, y retirarlo.
- [x] **Step 3:** `domain/ids.ts` con `StepId` y `TemplateCode`. **Aquí y no en
      `@app/common`**: solo `ProcessInstanceId` vive allí, y su comentario explica por qué
      (lo referencia `inventory`). `TemplateCode.of` valida contra `varchar(64)`.
- [x] **Step 4:** `step-types.ts` y `errors.ts` — los dieciséis de
      [13 §12](docs/specs/13-process.md), incluidos los tres que el refinamiento añadió:
      `process-instance-not-found` (404), `process-instance-id-taken` (409) e
      `invalid-template` (422). Los de instancia se declaran aunque el plan 8 sea quien los
      lance: el fichero de errores del módulo se escribe una vez.
- [x] **Step 5: Run** `pnpm lint && pnpm typecheck && pnpm test` → PASS con la librería
      vacía. Si `depcruise` no ve `libs/process`, es que falta el `paths`.
- [x] **Step 6: Commit** `feat(process): la librería de alta, y el vocabulario del motor`

---

### Task 2: `ProcessTemplate`, su validador, y las seis de fábrica

**Files:** `libs/process/src/domain/{template.ts, factory-templates.ts}` + specs;
`libs/process/test/builders/a-template.ts`

- [x] **Step 1: spec primero.** El validador rechaza: dos transiciones en un paso
      (`branching-not-supported`, P-8); un `type` que no está en `StepType`
      (`unknown-step-type`); una transición a un `id` que no existe, un paso inalcanzable
      desde el primero, y una plantilla que no cierra con `to: null` (`invalid-template`).
      Y acepta: `firstStep()`, `step(id)`, `transitionsFrom(id)`.
- [x] **Step 2: Run** → **FAIL**, anotar.
- [x] **Step 3: implementar.** `invalid-template` es el que importa y el que el maestro no
      pedía: `unknown-step-type` cubre el tipo raro y `branching-not-supported` la rama, pero
      una plantilla cuyo `confirmar` transite a un paso mal escrito **pasa las dos y se
      siembra rota**, y el fallo aparece semanas después en la instancia de alguien, como un
      500.
- [x] **Step 4:** `FACTORY_TEMPLATES`, **copiadas literalmente** de
      [13 §6](docs/specs/13-process.md), que ya las trae en JSONC con `id`, `required`,
      `config` y `transitions`. No se inventa ninguna.
- [x] **Step 5:** la prueba que las cruza: **cada una de las seis pasa el validador**. Es
      barata y es la única que impide sembrar una plantilla rota en cada organización nueva.
- [x] **Step 6: Run** → PASS.
- [x] **Step 7: Commit** `feat(process): la plantilla, su validador, y las seis de fábrica`

---

### Task 3: La instancia, el contexto y los borradores

**Files:** `libs/process/src/domain/{instance.ts, context.ts, drafts.ts, step-completion.ts, effects.ts}` + specs

- [x] **Step 1: spec primero.** `ProcessInstance.isOpen()`, `canComplete(stepId)`;
      `ProcessContext.with` acumula por paso; `withDraft` **funde** —no añade— y
      `withStorageKeys` acumula aparte.
- [x] **Step 2: Run** → **FAIL**, anotar.
- [x] **Step 3: implementar.** El borrador es **uno** (la corrección de
      [13 §2](docs/specs/13-process.md)), y **no lleva `occurredAt`**: la hora del asiento
      la pone el aplicador de efectos con el `Clock` en el plan 8, porque una instancia puede
      llevar abierta desde ayer.
      Las claves de foto van en su propio campo y no en el borrador: alimentan otro efecto,
      y sobre un producto, no sobre una posición.
- [x] **Step 4:** `effects.ts` con el `feeds` de la corrección: el índice del borrador al que
      alimenta el `CREATE_BATCH`. Hoy siempre `0`; sin él, el orden de los efectos no sirve
      de nada porque el `batchId` no tiene dónde aterrizar.
- [x] **Step 5: Run** → PASS.
- [x] **Step 6: Commit** `feat(process): la instancia, el contexto que acumula, y los efectos`

---

### Task 4: `LinearRunner`

**Files:** `libs/process/src/domain/{runner.ts, linear-runner.ts}` + spec

- [ ] **Step 1: spec primero**, una prueba por invariante y nombrada por su número:
      **P-2** paso que no es el actual → `wrong-step` con el actual en el `detail`;
      **P-4** instancia `COMPLETED` o `CANCELLED` → `instance-closed`;
      **P-5** `required: true` con payload `null` → `required-step-skipped`;
      omitir un `required: false` avanza **sin invocar al manejador**;
      `to: null` deja la instancia `COMPLETED`;
      y **efectos vacíos en todo paso que no sea `CONFIRM`** (P-6).
- [ ] **Step 2: Run** → **FAIL**, anotar.
- [ ] **Step 3: implementar.** `advance` devuelve `Result<AdvanceOutcome>`, no lanza: es
      dominio.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(process): el motor lineal, y las cinco invariantes que sostiene`

---

### Task 5: Los ocho manejadores y el registro

**Files:** `libs/process/src/domain/handlers/*.ts` + spec cada uno;
`libs/process/test/doubles/fake-handler-deps.ts`

`HandlerDeps` es un objeto de **funciones**, no de puertos (D-46), y el doble es un objeto
literal con mapas en memoria — no hay clase que escribir.

- [ ] **Step 1: spec primero**, cada manejador con payload válido, inválido
      (`invalid-step-payload` con `pointer`) y `null`.
- [ ] **Step 2: Run** → **FAIL**, anotar.
- [ ] **Step 3: los cinco simples.** `SCAN_ITEM` (resuelve con `resolveCode`, que devuelve
      `null` en vez de lanzar), `CAPTURE_QTY` (positiva; entera si la unidad es
      `UNIT`/`BOX`/`PACK`), `CAPTURE_REASON` (3-500), `SET_DUE_DATE` (futura contra el
      `clock`; el destino ya es `CUSTODY` porque el paso `tenedor` va antes en la plantilla),
      `CAPTURE_PHOTO` (1-5 claves; **acumula en el contexto, no produce efecto** — la
      corrección de [13 §5](docs/specs/13-process.md); una clave que no está en la zona de
      espera o ya fue reclamada es `upload-not-found`, no `invalid-step-payload`).
- [ ] **Step 4: `SELECT_NODE`,** que es donde se ve que `validate` y `apply` necesitan el
      `config`: lee `allowedKinds` al validar y `role` al aplicar. Es **un** manejador
      parametrizado y no dos, y es lo que hace que seis plantillas se armen con ocho piezas.
- [ ] **Step 5: `CAPTURE_BATCH`,** las **seis celdas** de la tabla de
      [13 §5](docs/specs/13-process.md) más «`SCAN_ITEM` ya aportó lote». Decide `batchId`
      contra `newBatch` con `findBatchByLot` y `findBatchBySerial`, que es justo por lo que
      `HandlerDeps` creció.
- [ ] **Step 6: `CONFIRM`.** Borrador completo y coherente; borrador incompleto →
      `incomplete-draft` con la lista de lo que falta en el `detail`; los `defaults`
      resueltos con `findNodeByCode` —y no con una lista de uuids, que sería una plantilla
      de fábrica que solo vale para una empresa—; **lo que el borrador ya trae gana sobre el
      `default`**. Emite los tres efectos en orden.
- [ ] **Step 7:** `registry.ts`. Un registro y no un `switch`: añadir un paso es una clase.
- [ ] **Step 8: Run** `pnpm test libs/process` → PASS, cobertura de `domain/**` al 100 %.
- [ ] **Step 9: Commit** `feat(process): los ocho manejadores, y el registro que los reúne`

---

### Task 6: Las seis plantillas, recorridas de punta a punta

**Files:** `libs/process/src/domain/walkthrough.spec.ts`

Es la prueba que [13 §13](docs/specs/13-process.md) exige y la que cierra el 100 %:
**cada plantilla de fábrica, de principio a fin, tres veces** —con un producto `QUANTITY`,
uno `LOT` y uno `SERIAL`— y el borrador final tiene que pasar `Movement.create` de
`@app/inventory`.

- [ ] **Step 1:** el mundo de papel en el doble de `HandlerDeps`: cuatro productos (uno por
      modo más el de la serie), los nodos del reparto narrativo, y los ocho de frontera por
      `code` —`adjustment-in` y `adjustment-out` hacen falta de verdad, porque los `defaults`
      de las dos plantillas de ajuste los resuelven por código—.
- [ ] **Step 2:** el recorrido. **18 combinaciones** (6 × 3), y las que no aplican se
      afirman como el error que toca, no se saltan: `CAPTURE_BATCH` con `null` sobre un `LOT`
      sin lote del escaneo es `batch-step-required`, y con datos sobre un `QUANTITY` es
      `batch-step-not-allowed`.
- [ ] **Step 3:** la aserción que cierra el círculo — el `MovementDraft` final se convierte
      en `RecordMovementInput` (con un `occurredAt` fijo, que aquí lo pone la prueba) y
      `Movement.create` lo acepta. **Es la única prueba que demuestra que el motor y el
      ledger hablan el mismo idioma**, y la que habría cazado que `MovementDraft` no tenía
      `occurredAt` si el refinamiento no lo hubiera visto antes.
      Ojo con las dos de ajuste: un extremo `adjustment-in`/`adjustment-out` exige `reason`
      en el dominio (D-36), y por eso su paso `motivo` es `required: true`.
- [ ] **Step 4: Run** `pnpm test:cov libs/process` → PASS con `domain/**` al 100/100.
- [ ] **Step 5: Commit** `test(process): las seis plantillas de punta a punta, y el asiento que producen`

---

### Task 7: La plantilla persistida, y el sembrador

**Files:** `libs/persistence/src/models/index.ts`; `libs/persistence/src/dao/process-template.dao.ts`;
`libs/persistence/src/repositories/process/{template.repository.ts, mapping.ts}`;
`libs/persistence/src/index.ts`; `libs/process/src/application/ports/process-template.repository.ts`;
`libs/process/src/application/use-cases/seed-factory-templates.ts` + spec;
`apps/tubodega/src/adapters/process/factory-templates.seeder.ts`;
`apps/tubodega/src/adapters/adapters.module.ts`; `libs/process/src/process.module.ts`;
`libs/persistence/test/repositories/process/template.repository.int-spec.ts`;
`apps/tubodega/test/edge/org-seeding.int-spec.ts`

- [ ] **Step 1:** los tres alias en `models/index.ts` —**un solo fichero**, no el
      `src/models/*.ts` que dibuja el mapa del maestro— y `process-template.dao.ts` sobre
      `AbstractOrgDao`. `steps` es `jsonb`: el mapeo de ida y vuelta vive en `mapping.ts`,
      como en catalog e inventory.
      **Trampa:** `process_template.version` **no es el bloqueo optimista**, es parte de la
      clave natural `(org_id, code, version)`. `protected override versioned` se queda en
      `false` —como en `NodeDao` está en `true` porque allí sí lo es—, o el DAO tratará el
      número de versión de la plantilla como un contador de ediciones y `save` fallará con
      `VersionConflictError` la primera vez que alguien cree una `v2`.
- [ ] **Step 2:** el puerto `ProcessTemplateRepository` con los cinco métodos de
      [13 §8](docs/specs/13-process.md). `hasInstances` se declara aunque **no tenga ruta
      que lo produzca en el MVP**: es P-9, y el plan 8 lo usa.
- [ ] **Step 3: spec primero** de `SeedFactoryTemplates`: siembra las seis en versión 1, y
      **llamarlo dos veces no duplica**. Idempotente por `findVersion(code, 1)` antes de
      `save`, como `SeedBoundaryNodes` — y no con `ON CONFLICT`, porque un `23505` abortaría
      la transacción que crea la organización.
- [ ] **Step 4: implementar** (D-26): `execute(orgId)`, **sin `RequestContext`, sin
      `requireAction`, sin eventos**. Cuando corre no hay organización ni token, y un ctx con
      roles inventados sería una autorización que no puede fallar. `organization.created` ya
      cuenta el hecho.
- [ ] **Step 5:** el adaptador y el cableado. `factory-templates.seeder.ts` es el molde
      exacto de `boundary-nodes.seeder.ts`. En `adapters.module.ts`, `ORG_SEEDERS` gana una
      línea en `inject` y un parámetro en el `useFactory` —**`useFactory` y no `useValue`**,
      que es lo que ya dice su comentario—, y `AdaptersModule` importa `ProcessModule` como
      ya importa `InventoryModule`.
- [ ] **Step 6: integración.** El repositorio contra Postgres con `withRollback`, y
      `org-seeding.int-spec.ts` —que ya existe para los ocho nodos— comprobando que tras
      `CreateOrganization` hay **seis plantillas activas en versión 1**, y que las seis pasan
      el validador al releerlas de la base. El `jsonb` de ida y vuelta es donde se rompen
      estas cosas.
- [ ] **Step 7: Run** `pnpm test:e2e libs/persistence apps/tubodega/test/edge` → PASS.
- [ ] **Step 8: Commit** `feat(process): las seis plantillas sembradas con la organización`

---

### Task 8: Las plantillas, por HTTP

**Files:** `libs/process/src/application/use-cases/{list-templates,get-active-template}.ts` + spec;
`apps/tubodega/src/http/process-templates/{process-templates.controller.ts, process-templates.dto.ts}`;
`apps/tubodega/src/app.module.ts`; `apps/tubodega/openapi.json`;
`apps/tubodega/test/edge/openapi.int-spec.ts`; `scripts/blackbox/lib.sh`;
`scripts/blackbox/35-procesos.sh`; `scripts/seed.sh`; `docs/postman/…`

- [ ] **Step 1: spec primero** de los dos casos de uso: `requireAction(ctx, Action.READ)`
      como primera línea; `ListTemplates` devuelve solo las activas;
      `GetActiveTemplate` da `404 template-not-found` para un código que no existe **y** para
      uno sin versión activa.
- [ ] **Step 2: Run** → **FAIL**, anotar.
- [ ] **Step 3: implementar** los dos, y `process.module.ts` con ellos y el sembrador.
- [ ] **Step 4: el controlador**, molde `nodes.controller.ts`: `@ApiTags('process')`,
      `@ApiBearerAuth()`, `@ApiOperation` en español, y **todo error declarado como
      `ProblemDetailsView` con los slugs separados por ` · `**. `GET /v1/process-templates`
      no pagina —son seis, y el día que sean por tenant seguirán siendo pocas—, así que **no
      lleva `parsePage`** y por tanto tampoco filtros: cualquier query sobra.
      El `{code}` de la ruta no es un uuid: `UuidParam` **no** se aplica, y un código que no
      existe es `404 template-not-found` por el caso de uso.
- [ ] **Step 5:** el snapshot. La lista literal de paths de `openapi.int-spec.ts` gana los
      dos, `pnpm openapi:write`, y `git diff` del `openapi.json` enseña exactamente **dos
      operaciones nuevas: 44 → 46**.
- [ ] **Step 6: la caja negra** (D-50). `plantilla()` en `lib.sh` aprende
      `/process-templates/{code}` —**antes** de la regla que lo dejaría tal cual—, y
      `35-procesos.sh` recorre: las seis activas en versión 1, una con sus pasos y sus
      transiciones de un elemento, `404 template-not-found`, `401` sin token, y el `404`
      cross-org con una segunda organización (I-6, nunca `403`). Camino feliz **y** de error
      por cada una de las dos operaciones, que es lo que el cruce del runner exige.
- [ ] **Step 7: Run** contra un proceso propio **en un puerto libre**, no el `:3000`.
- [ ] **Step 8:** Postman —carpeta «Procesos», con el par feliz/error— y `scripts/seed.sh`,
      que gana un paso comprobando que el mundo sembrado trae las seis plantillas. El seed
      no las *crea*: las siembra el provisioner. Lo que hace es no mentir sobre lo que hay.
- [ ] **Step 9: Commit** `feat(http): las plantillas de proceso, publicadas`

---

### Task 9: La bitácora

**Files:** este documento; `README.md`

- [ ] **Step 1:** cerrar este documento con lo ejecutado, lo que se encontró y no estaba
      previsto, las desviaciones, y «lo que encontró cada capa de prueba».
- [ ] **Step 2:** `README.md` — la tabla del seed («plantillas e instancias de proceso |
      plan 8» pasa a ser solo las instancias) y el estado de la WAVE 4.
- [ ] **Step 3:** las decisiones nuevas, numeradas desde **D-52**, también en el maestro si
      cambian una fase pendiente.
- [ ] **Step 4:** las seis puertas.
- [ ] **Step 5: Commit** `docs(plan): la bitácora del plan 7`

---

## Verificación de extremo a extremo

```bash
docker compose up -d db

pnpm lint && pnpm typecheck && pnpm db:check && pnpm test
pnpm test:e2e

pnpm test:cov libs/process          # domain/** al 100 % líneas y ramas
git diff --exit-code apps/tubodega/openapi.json   # tras openapi:write: solo dos operaciones

pnpm build
PORT=3100 node dist/apps/tubodega/main &
BASE=http://localhost:3100 pnpm blackbox          # cruce de contrato sin huecos → exit 0
```

Y a mano, que es de lo que trata el re-corte:

```bash
# registrar una organización nueva y ver que nace con sus seis plantillas
TOKEN=...   # del POST /v1/organizations + login
curl -s -H "Authorization: Bearer $TOKEN" localhost:3100/v1/process-templates | jq '.data | length'
# → 6

curl -s -H "Authorization: Bearer $TOKEN" localhost:3100/v1/process-templates/RECEPCION \
  | jq '.steps | map({id, type, required, to: .transitions[0].to})'
# → los siete pasos de [13 §6], cerrando en "to": null

curl -s -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer $TOKEN" \
  localhost:3100/v1/process-templates/NOEXISTE      # → 404
```

`pnpm db:check` tiene que seguir saliendo **0 sin tocar `schema.prisma`**: las tres tablas
entraron con `full_schema` y este plan no migra nada.

---

## Qué queda fuera del plan 7 (y dónde entra)

| Qué | Dónde |
|---|---|
| `StartProcess`, `CompleteStep`, `CancelProcess`, el `EffectApplier` y los seis endpoints de escritura | Plan 8 |
| `CreateTemplateVersion` y `POST /v1/process-templates/{code}/versions` | Plan 8 — el validador ya está, le falta la ruta |
| Los DAOs de `process_instance` y `step_completion`, y el `REVOKE` de D-49 | Plan 8, que es quien escribe en esas tablas |
| La e2e `w4-operar-con-procesos` con sus 14 casos | Plan 8 |
| Que `movement.process_instance_id` se llene de verdad | Plan 8 |
| Alertas | Plan 9 |
