# Parte B — Plan 6: El cierre de la WAVE 3 — las propiedades y la narrativa

> Rama `plan/06-el-cierre-de-la-wave-3` · documento en `docs/superpowers/plans/2026-09-12-06-el-cierre-de-la-wave-3.md`
> Fases del maestro: **F3.6** y la **e2e WAVE 3**

## Estado: **ejecutado** (2026-09-12)

Siete tareas, ocho commits. Al cerrar: **568 unitarias**, **241 de integración,
e2e y propiedades**, **421 comprobaciones de caja negra** en cinco suites. El
contrato se queda en **44 operaciones** —el plan 6 no añade endpoints— y el cruce
de cobertura sigue completo: 44 ejercitadas, 44 con camino feliz, 44 con camino
de error. La pirámide de [06 §2](docs/specs/06-pruebas-y-calidad.md) queda con
sus **seis niveles poblados** por primera vez.

### Lo que se encontró al ejecutar, y no estaba previsto

**I-9 no valía al compensar un despacho.** Es el hallazgo del plan, y lo encontró
la generación, no una persona. La secuencia: una serie entra, se traslada, se
vende, el proveedor manda otra unidad con la misma serie a otra estantería —cosa
legítima, el sistema no puede saber que es la misma pieza hasta que la ve— y
entonces alguien deshace la venta. La compensación devuelve la serie al sitio del
que salió y la misma pieza queda en dos estanterías. Ninguna operación por
separado hace nada raro.

`guardSerial` tenía la condición correcta —entrar a un nodo custodiable desde uno
que no lo es— y deshacer un despacho la cumple exactamente, porque es una entrada
`TERMINAL → INTERNAL`. Lo que fallaba no era la regla: era que `ReverseMovement`
no se la preguntaba a nadie. Y `custodialTotal` devuelve cero justo hasta el
instante en que deja de hacerlo.

Con la guarda quitada, la propiedad de I-9 cae a los **902 casos** y encoge a seis
pasos, que es exactamente la secuencia de arriba. Ningún ejemplo escrito a mano la
cubría, y ninguna de las 558 pruebas que había la habría encontrado nunca.

**Y el patrón es raro: dos de cada mil.** Medido sobre 20.000 secuencias, el
interleaving que rompe I-9 aparece el 0,2 % de las veces con el mundo completo.
Por eso la suite de I-9 corre sobre un mundo estrecho —un producto por serie, dos
series, un par de estantes y una frontera de cada clase— y con 1500 corridas en
vez de 50. Cincuenta no lo verían nunca. Y por eso el testigo escrito a mano
sigue ahí: la propiedad busca lo que no sabemos, el ejemplo clava lo que ya sabemos.

### Dos tests ajenos que esto puso en rojo, y por qué no era culpa suya

Ninguno de los dos falló por una línea de código nueva. Los dos daban por hecho
algo sobre la base de test que dejó de ser cierto cuando el ledger empezó a
escribir de verdad.

| Qué | Por qué se cayó |
|---|---|
| `outbox-dispatcher.int-spec.ts` · «publishes what is pending» y «two concurrent passes» | El despachador publica de **100 en 100** y la base de test no se limpia nunca. Las suites del ledger dejan varios cientos de eventos por publicar, así que el `tick()` del test se gastaba el lote entero en historia de otros y sus tres eventos no llegaban a reclamarse. Ahora vacía primero |
| `ledger.int-spec.ts` · «los últimos por producto van por el índice» | Fijaba el **nombre** de un índice. Con cientos de organizaciones, el planificador no tiene estadísticas para un par `(org, producto)` nuevo, estima **una fila**, y `movement_org_id_occurred_at_idx` y `movement_org_id_product_id_occurred_at_idx` empatan en coste: se lleva el que ese día sea una página más bajo. El test se puso rojo sin que cambiara nada, solo porque la base había crecido — y no puede arreglarse sus propias estadísticas, porque **`ANALYZE` se salta en silencio** para un rol que no es dueño de la tabla, y ninguno de los dos de aplicación lo es. Pasa a afirmar lo que D-37 promete: que esa consulta **nunca escanea la tabla** |

### Desviaciones al ejecutar

| Qué | Por qué |
|---|---|
| El testigo a mano de I-9 vive en `test/invariants/serial-reversal.int-spec.ts`, no en `libs/persistence/test/repositories/inventory/` | Necesita los casos de uso reales cableados contra Postgres, que es justo lo que monta el harness de las propiedades. En `libs/persistence` habría que rehacerlo entero |
| `fcParams()` acepta un `numRuns` en la llamada, y la suite de I-9 pide 1500 | D-44 dice que local y CI corren igual, no que las cuatro propiedades tengan que correr lo mismo. Una cuyo estado interesante aparece dos de cada mil necesita más casos, y decirlo en el sitio de la llamada es más honesto que subir el número para todas |
| `arbitraries.ts` añade `checks.ts` y `harness.ts`, que F3.6 no nombra | F3.6 lista los ficheros mínimos. `checks.ts` separa las cuatro consultas porque I-5 y la conservación comparten el CTE del ledger, y deja cada `prop-spec` en cuarenta líneas legibles |
| El generador **produce** la secuencia que rompe I-9 en vez de esquivarla | Primero la esquivaba, y con eso la propiedad salía verde incluso con la guarda quitada: el modelo se había vuelto más listo que el sistema. Una operación válida a priori se genera; quien tiene que negarse es el producto |
| Un caso 16 en la e2e que el maestro no pide: el aislamiento del ledger entre empresas | Ni la caja negra ni w1/w2 lo tocan, porque ninguna crea una segunda organización con el ledger en pie |
| El e2e no importa `Quantity` (D-45) | El criterio 8 pide un oráculo. Con la aritmética del dominio, un fallo en `Quantity` saldría verde justo en la prueba que existe para cazarlo |

### Lo que encontró cada capa de prueba

| Capa | Qué encontró que la anterior no podía |
|---|---|
| La spec del propio generador | Que el sobregiro de una serie salía en `1.250` unidades. Una serie se mueve entera, y eso no lo dice ningún `CHECK` |
| Propiedades sobre Postgres | **El agujero de I-9.** Y, de paso, que el modelo del generador y el dominio coinciden exactamente: 1729 operaciones, 120 rechazos, y los 120 son los sobregiros deliberados |
| e2e por HTTP | Que el despachador de outbox y el plan del índice daban por hecho que estaban solos en la base |
| Caja negra sobre el socket | Que había un `nest --watch` colgado en el `:3000` sirviendo un build viejo. El arreglo de I-9, comprobado a mano con `curl`: `422 serial-already-placed` donde antes había un `201` |

---

## Context

El plan 5 dejó el ledger funcionando de punta a punta: siete endpoints, 44 operaciones en el
contrato, cinco suites de caja negra. Pero la WAVE 3 no está cerrada, y le faltan justo las dos
capas que prueban el sistema **entero** en vez de una operación cada vez:

- **F3.6** — `test/invariants/` con `fast-check`. Las cuatro propiedades de
  [06 §7](docs/specs/06-pruebas-y-calidad.md) —I-5, conservación, I-9, I-18— sobre Postgres, a
  través de los casos de uso reales. Hoy `vitest.config.e2e.ts` ya incluye `**/*.prop-spec.ts`
  y **no hay ni un fichero**; `fast-check` ni siquiera está instalado. El nivel «Invariantes» de
  la pirámide de [06 §2](docs/specs/06-pruebas-y-calidad.md) existe en la tabla y está vacío.
- **`w3-mover-mercancia.e2e-spec.ts`** — 15 casos narrativos, criterios 3, 4, 6, 7, 8 y 9. Es la
  única capa que ejercita `tracking-mode-locked`, `product-has-stock` y `node-has-stock` **con
  stock real**: el código existe desde los planes 3 y 4, pero hasta ahora no había nada que mover
  que los disparase.

**El plan 6 no añade endpoints.** El contrato se queda en 44 operaciones, la colección de Postman
no se toca y `scripts/seed.sh` tampoco: el saldo inicial ya lo siembra desde el plan 5 (Task 7).
Lo que sí se toca es la caja negra, porque la e2e estrena caminos que hoy solo vería
`fastify.inject()` —y el plan 5 enseñó lo que eso cuesta.

**El hallazgo, antes de empezar.** Al diseñar el generador apareció un agujero real en I-9:
recibir un serial → despacharlo a un TERMINAL → recibirlo otra vez desde SOURCE a otro bin →
compensar el despacho deja el serial en **dos nodos custodiables**. `guardSerial` solo se dispara
al entrar desde frontera y consulta `custodialTotal`, que tras el despacho vale cero; y
`ReverseMovement` no la llama nunca, aunque la compensación de un despacho es exactamente una
entrada `TERMINAL → INTERNAL`. Se arregla en este plan (Task 4, D-41). Es lo que la generación
encuentra y el ejemplo escrito a mano no: nadie iba a escribir esa secuencia de cuatro pasos.

**No hace falta migración.** El arreglo de I-9 es código; `pnpm db:check` tiene que seguir saliendo
0 sin tocar `schema.prisma`.

---

## Global Constraints (heredadas)

- Dominio puro (R-1); `inventory → tenancy, catalog` y nada más (R-2); solo barriles (R-3); ninguna
  librería importa `libs/persistence` (R-4). **`test/` en la raíz queda fuera de `depcruise`** —que
  solo recorre `apps` y `libs`— pero **sí lo linta `oxlint`** (`pnpm lint` incluye `test/`) y sí
  entra en `pnpm typecheck`.
- Comentarios de código **en inglés**; `detail` de errores y descripciones de pruebas **en español**.
- Test primero, y **el ciclo rojo-verde se ve**: cada Step «Run → FAIL» se ejecuta de verdad y se
  anota qué falló antes de escribir la implementación.
- Las seis puertas antes de cerrar: `pnpm lint`, `pnpm typecheck`, `pnpm db:check`, `pnpm test`,
  `pnpm test:e2e`, `pnpm blackbox`.
- Cobertura: `libs/inventory/src/domain/**` al **100 %**, aplicación al 90 %.
- La caja negra corre **contra un proceso propio en un puerto libre**. Un `nest --watch` colgado en
  el `:3000` sirve un build viejo, y el falso verde es tuyo.

---

## Decisiones de ejecución (continúan la serie D-n; la última fue D-40)

| # | Decisión | Por qué |
|---|---|---|
| **D-41** | La guarda de I-9 deja de ser privada de `RecordMovement` y la llama **también `ReverseMovement`** | La condición que ya tenía era correcta —entrar a un nodo custodiable desde uno que no lo es— y la compensación de un despacho (`TERMINAL → INTERNAL`) la cumple exactamente. Lo que fallaba no era la regla, era quién la consultaba. `ReverseMovement` gana `PRODUCT_REPOSITORY` y `BATCH_REPOSITORY`, que es el precio de que I-9 valga en los dos caminos que escriben asientos |
| **D-42** | Cada operación de una secuencia generada corre en su **propio `uow.run()`** (savepoint), no suelta en la transacción de la corrida | `RecordMovement` inserta el asiento **antes** de tocar los saldos, y el savepoint de `applyDelta` solo envuelve los upserts: tras un `insufficient-stock` la fila de `movement` sigue ahí. En producción no importa —el `TransactionInterceptor` deshace la petición entera— pero una propiedad que captura el 422 y sigue vería el asiento huérfano y fallaría I-5 en el primer rechazo, acusando al producto de un defecto que no tiene. El `uow.run()` por operación **es** esa frontera de petición |
| **D-43** | El generador produce **enteros pequeños** que un `plan()` puro interpreta contra un modelo en memoria, en vez de `fc.commands` | Las dependencias entre operaciones son posicionales (un check-in necesita *su* check-out), y con `.map()` lo que fast-check encoge es el array de enteros: `plan` es total, así que **todo encogimiento vuelve a ser una secuencia válida**. No existe el contraejemplo inválido. Y fast-check imprime el valor ya mapeado, que se lee |
| **D-44** | El `seed` de fast-check **no se fija** en el fichero; `numRuns` es 50 igual en local y en CI | Un `seed` fijo convierte la suite en cincuenta ejemplos fijos, que es lo contrario de para lo que existe. Y que las pruebas corran distinto en las dos máquinas es exactamente cómo se pudren. Para reproducir un fallo están `FC_SEED`/`FC_PATH`, que es lo que fast-check imprime |
| **D-45** | El e2e de la WAVE 3 **no importa `Quantity`**: lleva su propia aritmética de milésimas en `bigint` | El criterio 8 pide un oráculo. Si la aritmética del test fuera la del dominio, un fallo en `Quantity` saldría verde en la prueba que existe para cazarlo |

### Desviaciones de la tabla del maestro, declaradas aquí

| Qué dice el maestro | Qué se hace |
|---|---|
| E2E W3 caso 7: «Juan registra `MUELLE → B2, 100`» | `MUELLE` quedó en cero en el caso 2, así que ese asiento daría `insufficient-stock` y no habría error de cantidad que compensar. El asiento equivocado es **`supplier-default → B2, 100`**, que además es lo que necesita el caso 8 |
| E2E W3 caso 7: «histórico muestra **los tres** con `reversesId`» | Solo la compensación lo lleva. Se afirma que los tres están y que **exactamente uno** tiene `reversesId`, apuntando al original |
| E2E W3 caso 3: «`GET /v1/stock?under={z1}` agrega **100**» | Depende del reparto del saldo inicial, que el maestro no fija. Con 100/60/40 sobre `B1`/`B2`/`B3` son **`300.000`** |
| E2E W3 caso 9: «`ARROZ-25`» sin `trackingMode` | `QUANTITY`, `uom: UNIT` |
| E2E W3 caso 1: «una petición con 501 → `422 batch-too-large`» | Cierto con **501 exactos**. Con 502 responde el `@ArrayMaxSize(501)` del DTO: `400 validation-failed` |
| F3.6: «las **tres** propiedades» en [06 §7](docs/specs/06-pruebas-y-calidad.md), y lista cuatro | Se escriben las **cuatro**, que es lo que pide la lista de archivos de F3.6. Se corrige el texto de la spec |
| Los nodos de frontera: el maestro nombra siete | Son **ocho**; `supplier-return` (TERMINAL) se le queda fuera de la enumeración |

---

## Mapa de archivos

```
package.json                                    fast-check en devDependencies   (M)

test/invariants/
├── harness.ts                                  el contexto Nest, el mundo, attempt(), fcParams()
├── arbitraries.ts                              el generador — PURO, sin Nest ni Kysely
├── arbitraries.spec.ts                          lo que se le exige al generador (unitario)
├── checks.ts                                   las cuatro consultas de invariante
├── ledger-reconciliation.prop-spec.ts          I-5
├── conservation.prop-spec.ts                   conservación
├── serial-uniqueness.prop-spec.ts              I-9
└── custody-pending.prop-spec.ts                I-18

libs/inventory/src/application/use-cases/movements/
├── record-movement.ts                          guardSerial pasa a función libre exportada   (M)
├── reverse-movement.ts                         la llama; gana dos repositorios              (M)
└── movements.spec.ts                           los unitarios del arreglo                    (M)
libs/inventory/test/doubles/in-memory.ts        lo que el doble necesite para I-9            (M)
libs/persistence/test/repositories/inventory/
└── serial-reversal.int-spec.ts                 el testigo del agujero, escrito a mano

apps/tubodega/test/e2e/w3-mover-mercancia.e2e-spec.ts    la narrativa del primer día
scripts/blackbox/30-movimientos.sh              los caminos que estrena el e2e               (M)
README.md                                       dos sitios que se quedaron atrás             (M)
docs/specs/06-pruebas-y-calidad.md              «las tres» → «las cuatro»                    (M)
docs/specs/12-inventory.md                      I-9 también en la compensación               (M)
```

---

## Tasks

### Task 0: Rama y documento del plan

- [x] **Step 1:** `git checkout -b plan/06-el-cierre-de-la-wave-3`
- [x] **Step 2:** Este documento.
- [x] **Step 3: Commit** `docs(plan): plan 6 — el cierre de la WAVE 3`

---

### Task 1: `fast-check`, el harness, y el spike que decide todo lo demás

**Files:** `package.json`; `test/invariants/harness.ts`

- [x] **Step 1:** `pnpm add -D fast-check`.
- [x] **Step 2: el spike, antes de escribir nada más.** Un fichero desechable que, dentro de
      `withRollback`, haga `append()` de un movimiento y luego `uow.run(() => applyDelta(delta negativo))`,
      y compruebe que (a) la transacción sigue usable y (b) el asiento desapareció. Anida savepoints
      a **tres** niveles (`runAs` → `run` → el `run` interno de `applyDelta`), y ese anidamiento
      **nunca se ha ejercitado en este repo**. Si falla, cambia el diseño entero (D-42).
- [x] **Step 3:** `createInvariantHarness()` sobre `ConfigModule + AdaptersModule + InventoryModule`.
      `AdaptersModule` es la raíz de composición real: replicar su tabla puerto↔adaptador aquí haría
      que la propiedad probase un cableado inventado. Importarla desde `test/` tiene precedente
      (`test/support/e2e/app.ts` hace lo mismo con `AppModule`). **No** se arranca la app entera:
      por HTTP cada petición commitea y no habría forma de deshacer una corrida.
- [x] **Step 4:** `seedInvariantWorld(h, label)` — commitea por el pool `system` una organización
      con 2 productos QUANTITY, 1 LOT con 2 lotes, 1 SERIAL con 3 series, 3 INTERNAL, 2 CUSTODY,
      2 TERMINAL, 2 SOURCE. `seedWorld` de `libs/persistence/test/support/raw-rows.ts` no sirve
      (un nodo de cada clase, ningún SERIAL) y ensancharlo obligaría a un deep-import.
      **Trampa:** ningún `code` puede ser `shrinkage`, `adjustment-in` ni `adjustment-out`
      (`REASON_REQUIRED_CODES`), o todo movimiento generado exigiría `reason`.
- [x] **Step 5:** `attempt()`, `applySequence()` y `fcParams()` (D-42, D-44). Los rechazos que la
      spec acepta son `insufficient-stock`, `settles-exceeded`, `serial-already-placed` y
      `already-reversed`; **todo lo demás se repropaga**, porque un 23514 o un 25P02 es un fallo de
      la propiedad, no un resultado.
- [x] **Step 6: Commit** `test(invariants): el contexto de las propiedades, y el savepoint por operación`

---

### Task 2: `arbitraries.ts` — el generador, y lo que se le exige a él

**Files:** `test/invariants/{arbitraries.ts,arbitraries.spec.ts}`

- [x] **Step 1: spec primero.** Toda secuencia empieza por `receive`; ningún `checkIn` referencia
      un `ref` inexistente; ningún `reverse` apunta a uno ya compensado; ninguna cantidad supera lo
      que el modelo dice que hay, salvo en `overdraw`. **Un generador con un bug produce propiedades
      verdes que no prueban nada**, y esto es lo único que lo cierra.
- [x] **Step 2: Run** `pnpm test test/invariants` → **FAIL**, anotar.
- [x] **Step 3: implementar** `plan()` con el modelo en milésimas enteras (D-43). Escalera de
      degradación, no descarte: si el `pick` es imposible en el estado actual cae al siguiente y en
      último término a `receive`, para que la longitud sea estable bajo encogimiento.
      `occurredAt` **no se genera** —se calcula al aplicar—, porque un instante reutilizado a lo
      largo de un encogimiento cruzaría la tolerancia de `i14_not_from_future`.
      De momento cada serial se recibe como mucho una vez por secuencia; **la Task 4 levanta esa
      restricción**.
- [x] **Step 4: Run** `pnpm test test/invariants` → PASS.
- [x] **Step 5: Commit** `test(invariants): el generador de secuencias, y lo que se le exige a él`

---

### Task 3: Las cuatro propiedades

**Files:** `test/invariants/checks.ts` + los cuatro `*.prop-spec.ts`

Cada comprobación **devuelve las filas que la violan** (vacío = invariante en pie), y **toda
comparación de decimales vive en SQL** sobre `numeric`: `'0'` y `'0.000'` son el mismo número y
distinta cadena.

- [x] **Step 1:** `checks.ts`. `ledgerMismatches` despliega cada asiento en sus dos lados con signo
      y hace **`FULL OUTER JOIN`** contra `stock_balance` —un saldo sin historia que lo respalde es
      tan grave como una historia que no llegó al saldo— con `batch_id IS NOT DISTINCT FROM`, porque
      el lote nulo de los productos por cantidad es el caso más común del catálogo y `=` lo perdería.
      `serialsInTwoPlaces` y `custodyPendingBreaches` **cruzan además contra el puerto**
      (`custodialTotal`, `settledQuantity`): si la consulta y el método que implementa el invariante
      en producción divergen, se ve aquí.
- [x] **Step 2:** los cuatro `prop-spec`. `seedInvariantWorld` en `beforeAll` (commiteado: si viviera
      dentro del rollback, la primera secuencia no tendría ni productos que mover) y
      `withRollback` **por corrida**, para que cada secuencia arranque con ledger vacío y saldo cero
      — sin eso la propiedad sería «tras la concatenación de cincuenta secuencias», que no es la que
      enuncia la spec. Un mundo **por fichero**: vitest paraleliza ficheros y compartir organización
      los pondría a pelear por `movement_org_id_reverses_id_key` y por los mismos `batch.serial`.
      Cada uno afirma también que algo se escribió: una secuencia entera rechazada probaría la
      propiedad sobre la nada.
- [x] **Step 3: Run** `time pnpm test:e2e test/invariants` → PASS en **< 180 s**.
- [x] **Step 4: Commit** `test(invariants): I-5, la conservación, I-9 y el pendiente de las custodias`

---

### Task 4: El agujero de I-9, en rojo y luego en verde

**Files:** `libs/persistence/test/repositories/inventory/serial-reversal.int-spec.ts`;
`libs/inventory/src/application/use-cases/movements/{record-movement,reverse-movement}.ts` + spec;
`libs/inventory/test/doubles/in-memory.ts`; `test/invariants/arbitraries.ts`;
`docs/specs/12-inventory.md`

- [x] **Step 1: el testigo.** Un `int-spec` que escriba la secuencia a mano —recibir `BSH-001` en
      `BIN-1`, despacharlo a `TRM-1`, recibirlo otra vez en `BIN-2`, compensar el despacho— y afirme
      que I-9 se sostiene. **Run → FAIL**, anotar el saldo que queda. Sin esta prueba el arreglo no
      tiene testigo.
- [x] **Step 2: arreglar** (D-41). `guardSerial` pasa a función libre exportada en
      `record-movement.ts`, junto a `applyOrExplain`, `deltasOf` y `movementEvents`, que
      `ReverseMovement` ya importa. `ReverseMovement` gana `PRODUCT_REPOSITORY` y `BATCH_REPOSITORY`.
- [x] **Step 3:** unitarios de aplicación en `movements.spec.ts` con los dobles en memoria, y los de
      dominio que haga falta para sostener el 100 % de `libs/inventory/src/domain/**`.
- [x] **Step 4: soltar el generador**: quitar la restricción de seriales de la Task 2 y dejar que
      `serial-uniqueness.prop-spec.ts` recorra el camino libremente.
- [x] **Step 5: Run** `pnpm test && pnpm test:e2e` → PASS. Corregir [12](docs/specs/12-inventory.md).
- [x] **Step 6: Commit** `fix(inventory): I-9 también vale cuando se compensa un despacho`

---

### Task 5: `w3-mover-mercancia.e2e-spec.ts`

**Files:** `apps/tubodega/test/e2e/w3-mover-mercancia.e2e-spec.ts`

Un solo `describe`, `it` planos y numerados, molde `w2-cargar-catalogo-y-ubicaciones.e2e-spec.ts`.
Los saldos se **encadenan** entre `it` —vitest los corre en orden de declaración y w1/w2 ya dependen
de eso—; va dicho en un comentario de cabecera, porque el primer refactor que reordene los casos los
rompe todos.

- [x] **Step 1:** el `beforeAll` monta el mundo. En la WAVE 3 el mundo ya existe cuando empieza el
      primer día de operación: crearlo no es la historia. Los 8 nodos de frontera se **descubren**
      con un `GET /v1/nodes?limit=200`; `MUELLE` cuelga de `BOD-A` y no de `Z1`, que es lo que hace
      honesta la agregación `under={z1}`; el `CUSTODY:juan` va sin padre (I-10). Dos guardias ahí
      dentro: los ocho códigos, y `B3.path === 'BOD-A/Z1/E3/B3'` — mejor que reviente el montaje que
      una aserción de `detail` tres casos después.
- [x] **Step 2:** los casos 1-10, encadenando el libro mayor. Reparto inicial 100/60/40.
- [x] **Step 3:** los casos 11-12, que son los que rompen el mundo. Los siete fallos sin efecto
      lateral van **con `B3` vivo** (`due-date-not-allowed` y `future-occurrence` apuntan a `B3`, y
      un nodo inactivo cortocircuitaría con `node-inactive`); luego se vacía `B3` con un asiento
      real —`DeactivateNode` mira el saldo **antes** que los hijos—, luego el `DELETE`, luego
      `node-inactive`. `B3` queda inactivo para siempre.
- [x] **Step 4:** los casos 13-15 y el **16**, que cubre el aislamiento del ledger entre
      organizaciones: ni la caja negra ni w1/w2 lo tocan.
- [x] **Step 5:** el caso 14, la reconciliación de Marta. `nonZeroOnly=false` y `custodialOnly=false`
      en **los dos lados**: el libro reconstruido tiene claves en cero, y sin las fronteras la suma
      por producto no da cero — **la conservación *es* la frontera**. Y el conjunto de ids vistos se
      compara con el de asientos que la narrativa consiguió escribir, que detecta un movimiento
      fantasma que un 422 hubiera dejado escrito.
- [x] **Step 6: Run** `time pnpm test:e2e apps/tubodega/test/e2e/w3-mover-mercancia.e2e-spec.ts`
      → PASS en **< 30 s**.
- [x] **Step 7: Commit** `test(e2e): el primer día de operación — cierre de la WAVE 3`

---

### Task 6: La caja negra alcanza al e2e

**Files:** `scripts/blackbox/30-movimientos.sh`

- [x] **Step 1:** añadir los caminos que hoy solo vería `fastify.inject()`: el lote de 200 desde la
      hoja, `batch-too-large` con 501 exactos, el todo-o-nada con el saldo intacto, `node-inactive`
      tras un `DELETE` real, `product-has-stock`, `tracking-mode-locked`, la compensación sin stock,
      y **el replay que no duplica el saldo**.
- [x] **Step 2: Run** contra un proceso propio en un puerto libre. El plan 5 ya enseñó lo que cuesta
      no hacerlo: el `:3000` colgado servía un build viejo y la primera corrida dio 64 fallos contra
      un servidor sin `/v1/movements`.
- [x] **Step 3: Commit** `test(blackbox): los caminos del cierre de la WAVE 3 contra el socket real`

---

### Task 7: La bitácora, y los dos sitios donde el README miente

**Files:** este documento; `README.md`; `docs/specs/06-pruebas-y-calidad.md`

- [x] **Step 1:** cerrar este documento con lo ejecutado, lo que se encontró y no estaba previsto,
      las desviaciones y «lo que encontró cada capa de prueba».
- [x] **Step 2:** `README.md` — «El ledger llega en la WAVE 3» (ya llegó) y la fila «Movimientos y
      existencias | plan 6» de la tabla del seed, que `scripts/seed.sh` ya siembra desde el plan 5.
- [x] **Step 3:** [06 §7](docs/specs/06-pruebas-y-calidad.md): «las tres propiedades» son cuatro.
- [x] **Step 4:** las seis puertas.
- [x] **Step 5: Commit** `docs(plan): la bitácora del plan 6, y el I-9 que la generación encontró`

---

## Verificación de extremo a extremo

```bash
docker compose up -d db

pnpm lint && pnpm typecheck && pnpm db:check && pnpm test
pnpm test:e2e

time pnpm test:e2e test/invariants                 # < 180 s
time pnpm test:e2e apps/tubodega/test/e2e/w3-mover-mercancia.e2e-spec.ts   # < 30 s

pnpm build
PORT=3100 node dist/apps/tubodega/main &
BASE=http://localhost:3100 pnpm blackbox           # cruce de contrato sin huecos → exit 0
```

Y una tanda larga antes de cerrar, para que las propiedades no salgan verdes por suerte:

```bash
FC_NUM_RUNS=500 pnpm test:e2e test/invariants
FC_VERBOSE=1   pnpm test:e2e test/invariants       # la mezcla de operaciones que genera de verdad
```

Reproducir un fallo: fast-check imprime `Seed: N, Path: p` → `FC_SEED=N FC_PATH=p pnpm test:e2e …`.

**A mano, el arreglo de I-9**, con el servidor en `:3100`: recibir `BSH-001`, despacharlo a `sale`,
recibirlo otra vez en otro bin y compensar el despacho. Tiene que dar `422 serial-already-placed`
donde antes daba `201` y dejaba el serial en dos sitios.

---

## Qué queda fuera del plan 6 (y dónde entra)

| Qué | Dónde |
|---|---|
| Procesos guiados (`processInstanceId` se acepta y se guarda, pero nadie lo llena todavía) | Planes 7-8 |
| Alertas de custodia vencida sobre `dueAt` | Plan 9 |
| Que `GET /v1/stock?under=` descarte en silencio `nodeId`, `batchId`, `custodialOnly` y `nonZeroOnly` | Se deja escrito, no se arregla aquí: cambiaría el contrato y el plan 6 no toca endpoints |
