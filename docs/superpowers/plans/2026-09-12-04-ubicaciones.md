# Parte B — Plan 4: Ubicaciones y cierre de la WAVE 2

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cerrar la WAVE 2 dándole a la mercancía un *dónde*. Al terminar, Diego dibuja el árbol de «Distribuidora La Esquina» —`BOD-A/Z1/E3/B2`— contra `http://localhost:3000/v1`, lo reorganiza sin que ningún `path` quede mintiendo, y cada organización nace con sus ocho nodos de frontera ya puestos. Es el **criterio de éxito 2** de [00 §7](docs/specs/00-vision-y-alcance.md), y deja el ledger de la WAVE 3 con los dos extremos contra los que asentar.

**Rama:** `plan/04-ubicaciones`; al terminar, merge local a `master` con `superpowers:finishing-a-development-branch`.

---

## Context

El plan 3 entregó el catálogo entero: 18 endpoints, `libs/catalog` completa y las 20 tablas del esquema. Pero entregó **productos sin lugares**. `POST /v1/movements` no existe todavía porque un movimiento es una partida doble entre dos nodos, y hoy no hay forma de crear un nodo por HTTP: la tabla existe y está vacía.

Ese hueco es lo que el plan maestro asignó al plan 4 — **F2.5, el resto de F2.6, y la e2e de la WAVE 2** (Parte A, fila 4). Tres consecuencias concretas:

1. **`libs/inventory` no existe.** Es la única de las cinco librerías del maestro que no ha nacido. Este plan la abre con su mitad de nodos; el ledger (`Quantity`, `Movement`, saldos) es el plan 5.
2. **`ORG_SEEDERS` está vacío.** `CompositeOrgProvisioner` se construyó, registró y probó en el plan 1 (D-2) para que los planes 4, 8 y 9 solo añadieran un elemento. El 4 es el primero en usarlo: sin los ocho nodos de frontera de [04 §6](docs/specs/04-persistencia.md), «una organización a medio sembrar no puede registrar ni un movimiento».
3. **La WAVE 2 está partida.** D-19 dividió su suite e2e en `w2a-cargar-el-catalogo` (plan 3) y `w2-cargar-catalogo-y-ubicaciones` (plan 4, «que absorbe la narrativa entera»). Este plan la reunifica.

**No hace falta migración, y es importante que no la haya.** La tabla `node`, el enum `node_kind_enum`, el `UNIQUE (org_id, code)`, el índice `(org_id, path text_pattern_ops)`, el parcial `(org_id, kind) WHERE active`, el `CHECK node_i10_parent_is_internal` y la política RLS entraron con `20260912162952_full_schema`. `pnpm db:check` tiene que seguir saliendo 0 **sin tocar `schema.prisma`**: si a alguien le tienta declarar ahí el `text_pattern_ops`, la desviación 4 del plan 3 explica por qué eso rompe `db:check` para siempre.

## Global Constraints (heredadas)

- Dominio puro: `libs/*/src/domain` no importa `@nestjs`, `kysely`, `pg`, `fastify` ni `application/` (R-1).
- `inventory → tenancy, catalog` y nada más (R-2). **`.dependency-cruiser.cjs` ya nombra `inventory` en sus tres reglas de orden: no hay que tocarlo.** Ninguna librería importa `@app/persistence` (R-4): los repositorios Kysely viven en `libs/persistence/src/repositories/inventory/` e importan `@app/inventory`, nunca al revés.
- Solo barriles: se importa `@app/inventory`, nunca un archivo interno (R-3).
- La autorización no vive en el borde: primera línea de cada `execute` es `requireAction(ctx, Action.MANAGE_NODES)` o `Action.READ`. **`MANAGE_NODES` ya existe** en `libs/tenancy/src/domain/role.ts` (OWNER y ADMIN sí; OPERATOR y VIEWER no): la matriz de permisos no se toca.
- Comentarios de código **en inglés**, incluidos los que explican negocio; `detail` de errores y descripciones de pruebas **en español**. Es lo que hace hoy todo el árbol.
- Test primero, siempre — y **el ciclo rojo-verde se ve**. Es la deuda que costó la tanda 3b entera: cada Step «Run → FAIL» se ejecuta de verdad y se anota qué falló, antes de escribir la implementación.
- Las cinco puertas antes de cerrar: `pnpm lint`, `pnpm typecheck`, `pnpm db:check`, `pnpm test`, `pnpm test:e2e`. Más la sexta desde la tanda 3c: `pnpm blackbox`.
- **Todo plan que añade endpoints actualiza la colección de Postman y `scripts/seed.sh` en el mismo plan** (regla de la Parte A).

## Decisiones de ejecución (continúan la serie D-n del maestro)

| # | Decisión | Por qué |
|---|---|---|
| **D-21** | La suite e2e se renombra a `w2-cargar-catalogo-y-ubicaciones.e2e-spec.ts` y **renumera**: los cuatro casos de nodos entran como **12-15**, y los actuales 12-17 corren a 16-21 | D-19 dice «absorbe la narrativa entera», y la numeración del fichero se había desalineado de la tabla del maestro. Renumerar la realinea de una vez; el diff es grande pero mecánico |
| **D-22** | El reparto narrativo del maestro dice `BOD-B › Z1`, pero `UNIQUE (org_id, code)` lo prohíbe: `Z1` ya cuelga de `BOD-A`. La zona de `BOD-B` pasa a ser **`Z2`** | El `code` es único **por organización**, no por padre — el escáner no sabe bajo qué bodega está. `Z2` es además el destino al que el caso 13 mueve `E3`, así que la narrativa cuadra sola |
| **D-23** | La caja negra de nodos va en una suite nueva `scripts/blackbox/25-ubicaciones.sh` | El runner descubre por el glob `[0-9]*.sh`; una suite propia permite `--only ubicaciones` y no infla `20-catalogo.sh`, que ya tiene 428 líneas |
| **D-24** | `UpdateNodeDto` declara `kind`, `code` y `parentId` como `?: never` con `@IsEmpty()` y **sin `@ApiProperty`** | `whitelist: true` solo elimina propiedades **sin metadatos de validación**: una con decorador sobrevive al filtrado y se valida, y `@IsEmpty` falla ante cualquier valor presente. Así el borrado silencioso se vuelve el `400 validation-failed` que exige el caso 13, acumulado con los demás campos malos de la misma petición — un `if` en el controlador correría después del pipe y reportaría uno solo. Sin `@ApiProperty` porque no hay plugin de Swagger en `nest-cli.json`: no son entrada aceptada, así que no salen en el esquema, y el guardián de «cada propiedad lleva `example`» sigue verde |
| **D-25** | El `code` de un nodo es **inmutable**, como el `kind` | `code` es el segmento del `path`: cambiarlo convertiría cada `PATCH` en una reescritura de subárbol de coste no acotado que además puede dar `409 node-code-taken` sin anunciarlo. Es también la clave por la que el sembrador es idempotente y por la que las plantillas de proceso (plan 8) referenciarán nodos. Misma forma que `UpdateProductDto`, que ya no lleva `sku` |
| **D-26** | `SeedBoundaryNodes.execute(orgId)` **no recibe `RequestContext` ni llama a `requireAction`**, y **no publica `node.created`** | No hay a quién autorizar: corre dentro de `CreateOrganization`, que es contexto de sistema porque cuando empieza la organización no existe ([07 §2](docs/specs/07-composicion-y-contexto-de-ejecucion.md)). Fabricar un ctx con roles falsos sería una autorización que no puede fallar, o sea ninguna. **La firma es la salvaguarda**: un caso de uso cuyo primer parámetro es `OrgId` no se ata a un controlador por descuido, porque `@Ctx()` devuelve un `RequestContext`. Y no publica eventos porque `organization.created` ya cuenta el hecho: nadie «creó» esos ocho nodos |
| **D-27** | `MoveNode` llama primero a `save(moved)` y después a `updateSubtreePaths`, y **no abre `uow.run()`** | `save` es la comprobación barata que puede fallar (`stale-version`, la FK compuesta del padre nuevo): no tiene sentido reescribir N descendientes antes de saber que pasa. Y un savepoint solo sirve para sobrevivir a un error y seguir leyendo; aquí un fallo debe deshacer el movimiento entero, así que la atomicidad de N-1+N-2 es la de la transacción que el borde ya abrió |
| **D-28** | El `under` de `GET /v1/nodes` apuntando a un nodo inexistente responde **`400 invalid-filter`** | El 404 de esta casa es para el recurso nombrado en la **ruta** — `uuid-param.pipe.ts` lo dice explícitamente—; devolverlo por un parámetro de *query* diría que el endpoint de colección se esfumó. Y una página vacía es indistinguible de «ese subárbol está vacío», así que un uuid mal tecleado pintaría «no hay nodos» para siempre. Es la misma clase de equivocación que un `sort` desconocido. Un nodo de otra organización cae en la misma respuesta, que es I-6 |
| **D-29** | `GET /v1/nodes/{id}/tree` **incluye los nodos inactivos**, no limita la profundidad, y **sí limita el tamaño a 1000** (`422 tree-too-large`) | Un estante desactivado entre una zona activa y un contenedor activo no se puede omitir sin dejar huérfanos a sus hijos o reasignarlos en silencio: las dos cosas son mentira. La profundidad está acotada por la realidad física. El tamaño no: `/tree` es el único endpoint del módulo sin cursor, y el árbol raíz de una organización de 500 nodos se serializaría entero en cada carga de panel. Mismo molde que `MAX_IMPORT_ROWS`/`import-too-large` |
| **D-30** | `DELETE /v1/nodes/{id}` sobre un nodo con **hijos activos** responde `422 node-has-children`, con los hijos en el detalle | Ni cascada ni silencio. La cascada haría que un `DELETE` de un recurso escribiera N filas que el cliente no nombró; dejar los hijos activos crea un subárbol operable colgando de una zona que dice no operar —seguirías moviendo mercancía a `B2` con `Z1` inactiva—, que es exactamente la incoherencia que N-3 existe para prevenir. Desactivar de abajo arriba es explícito y reversible |

### Desviaciones de las specs, declaradas aquí

| Qué | Dónde |
|---|---|
| `NodeRepository.listUnder` gana un parámetro `limit` (lo exige el tope de D-29) | [12 §5](docs/specs/12-inventory.md) |
| Tres errores que [12 §9](docs/specs/12-inventory.md) no tabula: `parent-not-found` (422), `invalid-node-code` (422), `tree-too-large` (422) | [12 §9](docs/specs/12-inventory.md) |
| `node-has-children` (422), nuevo por D-30 | [12 §9](docs/specs/12-inventory.md) |
| `StockBalanceRepository` se entrega **parcial**: `hasAnyStock` y `positionsIn`. `query`, `find`, `sumUnder` y `applyDelta` devuelven `StockPosition`, que lleva `Quantity`, y `Quantity` es del ledger | [12 §5](docs/specs/12-inventory.md), plan 5 |

---

## Mapa de archivos

```
libs/inventory/                              librería nueva
  src/domain/{ids,node,errors}.ts + specs
  src/application/events.ts
  src/application/ports/{node.repository,
                         stock-balance.repository}.ts
  src/application/use-cases/nodes/{create-node,update-node,move-node,
                                   deactivate-node,list-nodes,
                                   get-node-tree}.ts + specs
  src/application/use-cases/seed-boundary-nodes.ts + spec
  src/{index.ts, inventory.module.ts}
  test/builders/a-node.ts
  test/doubles/in-memory.ts
  tsconfig.lib.json

libs/persistence/
  src/dao/node.dao.ts                        + listUnder, updateSubtreePaths
  src/dao/stock-balance.dao.ts               + positions(scope, limit?)
  src/repositories/inventory/{node.repository,
                              stock-balance.repository,
                              mapping}.ts    nuevo
  src/{persistence.module.ts, index.ts}      + los dos repositorios
  test/repositories/inventory/nodes.int-spec.ts  nuevo

apps/tubodega/
  src/http/nodes/{nodes.controller.ts, nodes.dto.ts}   nuevo
  src/http/shared/views.ts                   + nodeView, nodeTreeView
  src/adapters/inventory/boundary-nodes.seeder.ts      nuevo
  src/adapters/adapters.module.ts            + ORG_SEEDERS, + los dos puertos
  src/app.module.ts                          + InventoryModule, + NodesController
  openapi.json                               regenerado
  test/edge/openapi.int-spec.ts              + los 4 paths de nodos
  test/e2e/w2-cargar-catalogo-y-ubicaciones.e2e-spec.ts   renombrada desde w2a-

scripts/blackbox/25-ubicaciones.sh           nuevo
scripts/blackbox/lib.sh                      + reglas de plantilla() para /nodes
scripts/seed.sh                              + el árbol de la bodega
docs/postman/tubodega.postman_collection.json  + carpeta «Ubicaciones»
raíz: tsconfig.json, nest-cli.json, vitest.config.ts,
      vitest.config.e2e.ts, README.md
docs/superpowers/plans/2026-09-06-00-plan-maestro-mvp.md   D-21…D-30 y el reparto
```

---

### Task 0: Rama y documento del plan

- [ ] **Step 1:** `git checkout -b plan/04-ubicaciones`
- [ ] **Step 2:** Este documento en `docs/superpowers/plans/2026-09-12-04-ubicaciones.md`.
- [ ] **Step 3: Commit** `docs(plan): plan 4 — las ubicaciones y el cierre de la WAVE 2`

---

### Task 1: `libs/inventory` — dominio (F2.5, parte 1) y cableado del monorepo

**Files:**
- Create: `libs/inventory/src/domain/{ids,node,errors}.ts` + specs, `libs/inventory/src/index.ts`, `libs/inventory/tsconfig.lib.json`, `libs/inventory/test/builders/a-node.ts`
- Modify: `tsconfig.json`, `nest-cli.json`, `vitest.config.ts`, `vitest.config.e2e.ts`

**Interfaces (produce):** `NodeId`, `NodeCode`, `NodePath` branded (molde `libs/catalog/src/domain/ids.ts`); `enum NodeKind { INTERNAL, CUSTODY, TERMINAL, SOURCE }`; la clase `Node` de [12 §2](docs/specs/12-inventory.md) con `isCustodial()`, `isBoundary()`, `canReceiveMovements()`, `isDescendantOf()`, y `create`/`rehydrate`/`update`/`moveTo`/`deactivate`.

**Una sola regla, tres sitios.** Ser descendiente es **empezar por `path + '/'`**, nunca por `path` — y de ahí salen las tres piezas que tienen que decir lo mismo: `isDescendantOf` en el dominio, el `LIKE` de `listUnder` y el `LIKE` de `updateSubtreePaths`. De ahí también sale que **`/` no puede formar parte de un `code`**: admitirlo dejaría falsificar una ascendencia que la cadena de padres no respalda.

- [ ] **Step 1: cableado (cinco sitios, ninguno opcional).** `paths["@app/inventory"]` **y** `references` en `tsconfig.json`; proyecto `library` en `nest-cli.json`; alias en **los dos** vitest configs (duplicados a propósito, con un comentario que lo advierte); `tsconfig.lib.json` copiado de `libs/catalog` cambiando `outDir`.
- [ ] **Step 2: specs del dominio primero.** `isDescendantOf` por prefijo **con la barra** — `BOD-A/Z1` no es ancestro de `BOD-A/Z10`, y esa es la prueba que lo fija; un nodo no es descendiente de sí mismo; `path` de raíz = `code`; `path` de hijo = `padre.path + '/' + code`; `NodeCode.of` rechaza `/` y espacios en los extremos; `isCustodial`/`isBoundary` para los cuatro `kind`; `Node.create` con `customFields` validados contra definiciones `entity = NODE` (C-7, reutilizando `CustomFieldValues.build` de `@app/catalog`); `moveTo(undefined)` deja `path = code`.
- [ ] **Step 3: Run** `pnpm test libs/inventory` → **FAIL**, y anotar qué falló.
- [ ] **Step 4: implementar** el dominio y `errors.ts`: `ParentNotInternalError` (422 `parent-not-internal`), `ParentNotFoundError` (422 `parent-not-found`), `NodeCycleError` (422 `node-cycle`), `NodeCodeTakenError` (409 `node-code-taken`), `NodeHasStockError` (422 `node-has-stock`), `NodeHasChildrenError` (422 `node-has-children`, D-30), `NodeInactiveError` (422 `node-inactive`), `NodeNotFoundError` (404 `not-found`), `InvalidNodeCodeError` (422 `invalid-node-code`), `TreeTooLargeError` (422 `tree-too-large`), `UnknownFilterNodeError` (400 `invalid-filter`, `pointer: '/under'`). Todos extienden `DomainError` de `@app/common`: el filtro los reconoce por *duck typing*, no hay nada que registrar.
- [ ] **Step 5: umbral** `libs/inventory/src/domain/**` al **100 %** de líneas y ramas en `vitest.config.ts`. Lo dice F2.5 dos veces («empieza aquí y se mantiene»), no el 95 de catalog.
- [ ] **Step 6: Run** `pnpm test libs/inventory` y `pnpm test:cov` → PASS.
- [ ] **Step 7: Commit** `feat(inventory): el grafo de nodos, con su path materializado`

---

### Task 2: Casos de uso de nodos (F2.5, parte 2)

**Files:** `libs/inventory/src/application/{events.ts, ports/*.ts, use-cases/nodes/*.ts, use-cases/seed-boundary-nodes.ts}` + specs; `libs/inventory/test/doubles/in-memory.ts`; `libs/inventory/src/inventory.module.ts`

**Interfaces (produce):** `NodeRepository` con las firmas de [12 §5](docs/specs/12-inventory.md) más el `limit` de `listUnder`; el filtro del puerto lleva `underPath?: NodePath`, **nunca un id** — la resolución id→path es del caso de uso, para que el repositorio siga siendo traducción pura y no esconda un segundo viaje a la base; `StockBalanceRepository` parcial con `hasAnyStock(orgId, { productId?, nodeId? })` y `positionsIn(orgId, scope, cap)`; `inventoryEvent(...)` calcado de `catalogEvent` con `node.created/updated/moved/deactivated`.

- [ ] **Step 1: dobles y specs.**
  - `CreateNode`: I-10 por los dos lados (padre `CUSTODY` → `parent-not-internal`; hijo `CUSTODY` con padre → `parent-not-internal`), `path` concatenado, padre inexistente → `parent-not-found`.
  - `UpdateNode`: cambia `name` y `customFields` y nada más (D-25).
  - `MoveNode`: **ciclos a tres niveles** (mover `Z1` bajo su nieto `B2` → `node-cycle`), sobre sí mismo → `node-cycle`, a la raíz → `path = code`, mover al mismo padre → no-op sin `UPDATE` vacío, y el doble comprueba que el subárbol entero quedó recalculado (N-2).
  - `DeactivateNode`: **N-3** con saldo → `node-has-stock`; **D-30** con hijos activos → `node-has-children`; hoja vacía → desactiva; ya inactivo → no-op.
  - `ListNodes`: filtros `kind`, `active`, `under`; `under` inexistente → `400 invalid-filter` (D-28).
  - `GetNodeTree`: anidado, incluye inactivos, y por encima de 1000 → `tree-too-large` (D-29).
  - `SeedBoundaryNodes`: crea los 8; **llamarlo dos veces deja 8**, no 16; y **no publica eventos**.
  - Autorización: `OPERATOR` no puede `CreateNode` ni `MoveNode`; `VIEWER` sí puede `ListNodes`.
- [ ] **Step 2: Run** → **FAIL**, anotando qué falló.
- [ ] **Step 3: implementar.** `MoveNode`, en este orden y todo en la transacción que el borde ya abrió (D-27):
  1. `requireAction(ctx, Action.MANAGE_NODES)`
  2. resolver nodo y, si viene `parentId`, padre
  3. **ciclo sin recursión**: `parent.id === node.id || parent.isDescendantOf(node)` → `node-cycle`. El `path` ya contiene la cadena entera
  4. I-10 por los dos lados — el `CHECK` del esquema solo cubre la mitad del hijo
  5. `const moved = node.moveTo(parent)`; si el `path` no cambió, salir
  6. `nodes.save(moved)` — la comprobación barata que puede fallar
  7. `nodes.updateSubtreePaths(orgId, oldPath, moved.path)` — solo descendientes estrictos
  8. `events.publish([inventoryEvent('node.moved', { fromPath, toPath })])`

  `SeedBoundaryNodes.execute(orgId)` (D-26, sin `ctx`) recorre los ocho de [04 §6](docs/specs/04-persistencia.md) — `SOURCE`: `supplier-default`, `adjustment-in`, `opening-balance`; `TERMINAL`: `sale`, `consumption`, `shrinkage`, `adjustment-out`, `supplier-return` — con `findByCode` → crear si falta. **Leyendo antes, no apoyándose en `ON CONFLICT`**: un `23505` abortaría la transacción que crea la organización, que es justo lo que la idempotencia viene a evitar.

  `GetNodeTree` arma el árbol con una función pura `buildTree(root, descendants)` de **dos pasadas y sin recursión**, en `libs/inventory`: primero un `Map` de todos, luego cada uno se cuelga de su padre. No se apoya en que `listUnder` venga ordenado por `path` —aunque venga—, porque eso ataría el resultado al *collation* de la base.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: umbral** `libs/inventory/src/application/**` ≥ 90 % en `vitest.config.ts`.
- [ ] **Step 6:** `inventory.module.ts` con `const USE_CASES = [...]` y `@Module({ providers: USE_CASES, exports: USE_CASES })`; barril `index.ts` en orden domain → application → module.
- [ ] **Step 7: Commit** `feat(inventory): crear, mover y retirar nodos, y sembrar la frontera`

---

### Task 3: Persistencia de nodos (resto de F2.6)

**Files:** `libs/persistence/src/dao/{node,stock-balance}.dao.ts`, `libs/persistence/src/repositories/inventory/{node.repository,stock-balance.repository,mapping}.ts`, `libs/persistence/src/{persistence.module.ts,index.ts}`, `libs/persistence/test/repositories/inventory/nodes.int-spec.ts`

- [ ] **Step 1: int-specs primero** (molde: `test/repositories/catalog/catalog.int-spec.ts`, con `createPersistenceHarness` y transacciones reales):
  - **N-1 y N-2**: montar `BOD-A/Z1/E3/B2` y `.../B3`, mover `E3` bajo `Z2`, y comprobar que `E3`, `B2` **y** `B3` quedaron con el `path` nuevo en la misma transacción.
  - **Ciclo sobre datos reales**: mover `Z1` bajo `B2` con el repositorio Kysely → `node-cycle` y **ningún `path` cambió**.
  - `node-code-taken` desde un `23505` de verdad, y bajo concurrencia: dos transacciones reales creando el mismo `code`, una gana.
  - `listUnder` **usa el índice**: `EXPLAIN` del `LIKE 'BOD-A/Z1/%'` menciona `node_org_id_path_idx`.
  - **La trampa del prefijo, también en SQL**: con `BOD-A/Z1` y `BOD-A/Z10` creados, `listUnder('BOD-A/Z1')` no devuelve `Z10`.
  - **El escape del `LIKE`**: un nodo de código `50%` no arrastra medio árbol.
  - El provisioner deja **8 nodos** tras `CreateOrganization`.
- [ ] **Step 2: Run** `pnpm test:e2e libs/persistence/test/repositories/inventory` → **FAIL**.
- [ ] **Step 3: implementar.**
  - `NodeDao` (hoy solo `countByCustomKey`) gana `listUnder` y `updateSubtreePaths`. El filtro de subárbol sale del DSL sin *escape hatch*: `where: { path: { startsWith: \`${prefix}/\` } }` ya compila a `LIKE` con `escapeLike` aplicado al valor (`dao/base/where.ts`), y `\` es el `ESCAPE` por defecto de Postgres, así que no hace falta cláusula. El `UPDATE` por prefijo sí necesita `sql` crudo, porque el valor se calcula **sobre la propia columna**:
    ```ts
    path: sql<string>`${newPrefix} || substring("path" from ${oldPrefix.length + 1})`
    ```
    **`substring` y no `replace`**: `replace` reescribiría *todas* las apariciones, y un `path` como `BOD-A/Z1/BOD-A` quedaría corrupto. Actualiza también `updated_at` y `version`: la fila cambió, y un cliente con la versión vieja de un descendiente tiene una fila cuyo lugar ya no conoce — su `If-Match` debe dar `409`.
  - `KyselyNodeRepository.save`, calcado de `KyselyProductRepository.save` para que el diff entre los dos solo cambie nombres: `uow.run()` alrededor del `update` y del `create`, y `translate` sobre `UniqueViolationError` con `constraint === 'node_org_id_code_key'` → `NodeCodeTakenError`. El savepoint es la desviación 5 del plan 3, ya pagada una vez: tras un `23505` la transacción queda abortada. El `23503` de la FK del padre y el `23514` del `CHECK` **no se traducen**: el caso de uso ya los comprobó, así que uno que llegue aquí es un fallo del dominio, y un 500 con traza informa más que un 422 fabricado.
  - `StockBalanceDao` gana `positions(orgId, scope, limit?)`, que **generaliza** `positionsOfProduct` (mismas reglas: solo nodos custodiables, saldo distinto de cero, orden por `path`). `positionsOfProduct` se queda delegando, para que `StockCheckerAdapter` y `test/dao/stock-balance.int-spec.ts` no se toquen: este plan añade, no reescribe. Los dos ámbitos van por índice — los parciales `(org_id, product_id)` y `(org_id, node_id) WHERE quantity <> 0`.
  - Registrar los dos repositorios en `persistence.module.ts` (`DAOS`/`ADAPTERS`, en `providers` **y** `exports`) y en `index.ts`.
- [ ] **Step 4: Run** `pnpm test:e2e libs/persistence` → PASS.
- [ ] **Step 5: Commit** `feat(persistence): los nodos en Kysely, con el subárbol que se mueve entero`

---

### Task 4: El sembrador de la frontera y el cableado de la raíz (D-2)

**Files:** `apps/tubodega/src/adapters/inventory/boundary-nodes.seeder.ts`, `apps/tubodega/src/adapters/adapters.module.ts`, `apps/tubodega/src/app.module.ts`

- [ ] **Step 1:** `BoundaryNodesSeeder implements OrgSeeder` (la interfaz vive en `adapters/tenancy/org-provisioner.adapter.ts`), delegando en `SeedBoundaryNodes`.
- [ ] **Step 2:** en `adapters.module.ts`, `{ provide: ORG_SEEDERS, useValue: [] }` pasa a fábrica — **`useValue` entregaría la clase, no la instancia**, y `seeder.seed(orgId)` reventaría en ejecución:
  ```ts
  BoundaryNodesSeeder,
  { provide: ORG_SEEDERS, inject: [BoundaryNodesSeeder],
    useFactory: (n: BoundaryNodesSeeder): readonly OrgSeeder[] => [n] },
  ```
  Los planes 8 y 9 lo extienden añadiendo una entrada a `inject` y un parámetro aquí. Añadir también `{ provide: NODE_REPOSITORY, useExisting: KyselyNodeRepository }` y `{ provide: STOCK_BALANCE_REPOSITORY, useExisting: KyselyStockBalanceRepository }` en `providers` **y** en `exports`, e importar `InventoryModule`.
- [ ] **Step 3:** `InventoryModule` también en los `imports` de `app.module.ts`, junto a `CatalogModule`. Sin ciclos: `NODE_REPOSITORY → KyselyNodeRepository → NodeDao → TransactionContext`.
- [ ] **Step 4: Run** `pnpm test:e2e apps/tubodega` → las suites que registran organización siguen verdes, y ahora cada una nace con 8 nodos.

  > **RLS: no hay nada que hacer, y es importante entender por qué.** `POST /v1/organizations` lleva `@Public()`, así que el `TransactionInterceptor` abre `{ pool: 'system' }` **sin `orgId`** y nunca ejecuta `set_config('app.current_org', …)`. El rol `tubodega_system` tiene `BYPASSRLS`, que gana sobre `FORCE ROW LEVEL SECURITY` — `FORCE` solo quita la exención del *dueño* de la tabla. Intentar poner el GUC además sería imposible: `runAs()` lanza dentro de una transacción activa, y `uow.run()` solo abre un savepoint. Lo que sí sigue vigente de [07 §2](docs/specs/07-composicion-y-contexto-de-ejecucion.md) es la otra mitad: **el rol de sistema no exime del filtro del repositorio**, así que `KyselyNodeRepository` escribe `org_id` explícito y filtra por él, igual que ya hacen los repositorios de organización y usuario en este mismo endpoint.
- [ ] **Step 5: Commit** `feat(inventory): toda organización nace con sus ocho nodos de frontera`

---

### Task 5: HTTP de nodos (los 7 endpoints de [12 §7](docs/specs/12-inventory.md))

**Files:** `apps/tubodega/src/http/nodes/{nodes.controller.ts, nodes.dto.ts}`, `apps/tubodega/src/http/shared/views.ts`, `apps/tubodega/src/app.module.ts`, `apps/tubodega/openapi.json`, `apps/tubodega/test/edge/openapi.int-spec.ts`

| Método | Ruta | Acción |
|---|---|---|
| `GET` | `/v1/nodes` | `READ` — filtros `kind`, `active`, `under` |
| `POST` | `/v1/nodes` | `MANAGE_NODES` — `Idempotency-Key` |
| `GET` | `/v1/nodes/{id}` | `READ` |
| `PATCH` | `/v1/nodes/{id}` | `MANAGE_NODES` — `If-Match` |
| `POST` | `/v1/nodes/{id}/move` | `MANAGE_NODES` — `If-Match`, cuerpo `{ parentId? }` |
| `DELETE` | `/v1/nodes/{id}` | `MANAGE_NODES` — desactiva, `204` |
| `GET` | `/v1/nodes/{id}/tree` | `READ` — subárbol anidado |

- [ ] **Step 1: implementar** con la receta de la casa (molde: `http/custom-fields/custom-fields.controller.ts`): `@ApiTags('inventory') @ApiBearerAuth()`, **nada de `@Roles()`**, `@Ctx()`, `UuidParam`, `parseIfMatch`, `parsePage(query, { sortable: ['path','code','name','createdAt'], defaultSort: 'path', filters: ['kind','active','under'] })` — `path` por defecto porque es el único orden que se lee como un almacén, y lo respalda `node_org_id_path_idx` —, `pageView(found, nodeView)`, y **un `@ApiResponse` por cada error** que el endpoint puede dar.
  - `UpdateNodeDto` con los tres `?: never` de D-24. En el controlador, **desestructurar** (`const { name, customFields } = dto`) en vez de hacer *spread*, para que el tipo de entrada del caso de uso no vea los `never`.
  - `NodeTreeView` es autorreferente: `@ApiProperty({ type: () => [NodeTreeView] })`. El resolver perezoso es la vía sancionada por `@nestjs/swagger` para la autorreferencia, y genera `{ type: 'array', items: { $ref } }` — el guardián de «cada propiedad lleva `example`» acepta `items`, y poner un `example` recursivo sería mentir. **No usar `@ApiHideProperty()`**: en la versión 12 es literalmente una función vacía.
- [ ] **Step 2:** registrar `NodesController` en `app.module.ts`.
- [ ] **Step 3:** añadir `/v1/nodes`, `/v1/nodes/{id}`, `/v1/nodes/{id}/move` y `/v1/nodes/{id}/tree` a la lista de `openapi.int-spec.ts` (y ampliar el título del `it` a «spec 10 §7, 11 §7 y 12 §7»), y `pnpm openapi:write`.
- [ ] **Step 4: Run** `pnpm test:e2e apps/tubodega/test/edge` → PASS, con los tres invariantes del snapshot.
- [ ] **Step 5: Commit** `feat(http): los siete endpoints del árbol de la bodega`

---

### Task 6: La suite e2e reunificada (D-21) y el cierre

**Files:** `apps/tubodega/test/e2e/w2-cargar-catalogo-y-ubicaciones.e2e-spec.ts` (renombrada), `scripts/blackbox/{25-ubicaciones.sh, lib.sh}`, `scripts/seed.sh`, `docs/postman/tubodega.postman_collection.json`, `README.md`, el plan maestro

- [ ] **Step 1:** `git mv` de `w2a-cargar-el-catalogo.e2e-spec.ts` a `w2-cargar-catalogo-y-ubicaciones.e2e-spec.ts`; actualizar la cabecera narrativa; **insertar 12-15 y renumerar 12-17 → 16-21**.
  - **12 · el árbol de la bodega (Criterio 2).** `GET /v1/nodes?kind=SOURCE` → **3** y `?kind=TERMINAL` → **5** *antes de crear nada*: los ocho de frontera ya estaban. Luego `BOD-A`, `MUELLE`, `Z1`, `E3`, `B2`, `B3`, `BOD-B`, `Z2` (D-22); `path` de `B2` = `BOD-A/Z1/E3/B2`; repetir `code:'B2'` → `409 node-code-taken`; `GET /v1/nodes/{bodA}/tree` anidado; `GET /v1/nodes?under={z1}` filtra el subárbol; `?under=<uuid inexistente>` → `400 invalid-filter` (D-28).
  - **13 · reorganizar estantes.** `POST /v1/nodes/{e3}/move {parentId: z2}` → los `path` de `E3`, `B2` y `B3` cambian, y `GET /v1/nodes/{b2}` lo confirma; mover `Z1` bajo `B2` → `422 node-cycle`; `PATCH /v1/nodes/{b2} {name}` con `If-Match` bueno → `200`, con el viejo → `409 stale-version`; `PATCH` con `kind` → `400 validation-failed` con `pointer: '/kind'`.
  - **14 · reglas del árbol.** `CUSTODY:juan` con `parentId` → `422 parent-not-internal`; sin padre → `201` y `path = 'juan'`.
  - **15 · desactivar un bin vacío.** `DELETE /v1/nodes/{b3}` → `204` y `active:false`; `DELETE /v1/nodes/{z1}` (que aún cuelga `E3`) → `422 node-has-children` (D-30). (N-3 con saldo se prueba en W3.)
  - **20 · otra empresa** (era 16) gana `GET /v1/nodes/{id}` → `404`, nunca `403`.
  - **21 · el contrato publicado** (era 17) gana las cuatro rutas de nodos.
- [ ] **Step 2: Run** `pnpm test:e2e apps/tubodega/test/e2e/w2-*` → PASS en **< 35 s** ([06 §2](docs/specs/06-pruebas-y-calidad.md)).
- [ ] **Step 3: caja negra** (D-23). En `lib.sh`, añadir a `plantilla()` —**las específicas primero**— `s#^/nodes/$u/(move|tree)\$#/nodes/{id}/\1#;` y `s#^/nodes/$u\$#/nodes/{id}#;`. Sin eso el cruce cuenta `/v1/nodes/<uuid>` como operación desconocida y `pnpm blackbox` sale 1. Luego `scripts/blackbox/25-ubicaciones.sh` con la misma narrativa y **camino feliz y camino de error por cada una de las 7 operaciones**.
- [ ] **Step 4: seed y Postman.** En `scripts/seed.sh`, un `step "5 · la bodega"` (renumerando el actual 5) que cree el árbol y afirme los 8 de frontera; añadir las ubicaciones al bloque final `cat <<FIN`; **quitar la línea «ubicaciones y nodos de frontera … plan 4»** de la cabecera. Carpeta «Ubicaciones» en Postman, con **cada petición afirmando su código** — la lección de la tanda 3d: una aserción que no puede fallar no prueba nada.
- [ ] **Step 5: README.** Las 7 filas nuevas en la tabla de endpoints; el estado pasa a «Plan 4 — el catálogo y las ubicaciones»; `libs/inventory/` en el Layout; `25-ubicaciones.sh` en la tabla de suites; quitar «Las ubicaciones llegan en el plan 4» y su fila en la tabla del seed; actualizar los conteos.
- [ ] **Step 6: plan maestro.** Marcar la fila 4 como **hecho**; añadir D-21…D-30 y la tabla de desviaciones; corregir el reparto narrativo (`BOD-B › Z2`, D-22); anotar la renumeración en la tabla «E2E WAVE 2».
- [ ] **Step 7: las seis puertas** — `pnpm lint`, `pnpm typecheck`, `pnpm db:check` (**sale 0 y sin tocar `schema.prisma`**), `pnpm test`, `pnpm test:cov`, `pnpm test:e2e`, y `pnpm blackbox` contra `pnpm start:dev`.
- [ ] **Step 8: Commit** `test(e2e): la bodega entera por HTTP — cierre de la WAVE 2`
- [ ] **Step 9:** merge local a `master` con `superpowers:finishing-a-development-branch`.

---

## Verificación de extremo a extremo

1. `docker compose up -d db && pnpm db:migrate && pnpm db:generate && pnpm db:check` → **sale 0 sin migración nueva**. Es la comprobación de que este plan no tocó el esquema.
2. `pnpm lint && pnpm typecheck && pnpm test && pnpm test:cov && pnpm test:e2e` → verde; `libs/inventory/src/domain` al 100 %; `pnpm test:e2e` completo por debajo de 120 s y la W2 por debajo de 35 s.
3. `pnpm start:dev` y recorrer con `curl -i`: registrar organización → `GET /v1/nodes?kind=SOURCE` devuelve **3 nodos que nadie creó** → crear `BOD-A`, `Z1`, `E3`, `B2`, `B3`, `Z2` → `GET /v1/nodes/{bodA}/tree` anidado → `POST /v1/nodes/{e3}/move {parentId: z2}` y comprobar que `B2` y `B3` cambiaron de `path` sin haberlos tocado → mover `Z1` bajo `B2` → `422 node-cycle` → `PATCH` con `kind` → `400` con `pointer: '/kind'` → `CUSTODY` con padre → `422 parent-not-internal` → `DELETE` la zona con hijos → `422 node-has-children` → `DELETE` un bin hoja → `204` y `active:false` → `?under=<uuid inexistente>` → `400 invalid-filter` → con el token de Juan (OPERATOR), `POST /v1/nodes` → `403 insufficient-role` → una segunda organización pidiendo un nodo ajeno recibe `404`, nunca `403`.
4. Cada error, `application/problem+json` con `type`, `title`, `detail`, `instance` y un `traceId` que coincide con `X-Request-Id`.
5. `pnpm blackbox` → las cuatro suites verdes y el cruce dice **37 operaciones, 37 ejercitadas, 37 con camino feliz, 37 con camino de error**.
6. `pnpm seed && psql "$DATABASE_URL" -c "SELECT kind, count(*) FROM node GROUP BY kind"` → `SOURCE 3`, `TERMINAL 5`, `INTERNAL` el árbol sembrado.

## Qué queda fuera del Plan 4 (y dónde entra)

| Pieza | Plan |
|---|---|
| `Quantity`, `Movement`, `RecordMovement`, `ReverseMovement`, saldos y `applyDelta` | 5 (F3.1-F3.4) |
| `/v1/movements`, `/v1/stock`, `/v1/stock/custodies`; el resto de `StockBalanceRepository` y `MovementRepository` | 6 (F3.5-F3.6) |
| **N-3 con saldo real por HTTP** (`node-has-stock`) e I-16 (`node-inactive`) | 6 — aquí se prueban con dobles, porque no hay forma de crear un saldo por el contrato |
| `StockCheckerAdapter` re-apuntado a `StockBalanceRepository` (hoy va directo al DAO, D-18) | 6 |
| La prueba de propiedades de conservación, e I-9 | 6 (F3.6) |
| `process_*` y `alert*` en `ORG_SEEDERS` (plantillas y reglas) | 8 y 9 |
