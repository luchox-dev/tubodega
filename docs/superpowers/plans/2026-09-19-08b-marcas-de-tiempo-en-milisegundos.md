# Plan 8b — Las marcas de tiempo, en milisegundos

> Rama `plan/08b-marcas-de-tiempo-en-milisegundos` · documento en
> `docs/superpowers/plans/2026-09-19-08b-marcas-de-tiempo-en-milisegundos.md`
> Derivado del plan 8, como 3b..3f lo fueron del 3. **Sin fases del maestro.**

## Estado: **ejecutado** · 2026-09-19

---

## Context

**Tu pregunta primero, porque decide si este documento tiene sentido.** El arreglo de D-67
estuvo bien donde estuvo. Una prueba del plan 8 salió roja, la causa no era del plan 8 sino
de dos endpoints publicados desde el plan 3, y el síntoma es el único que un cursor existe
para no tener: saltarse filas sin decirlo. Dejarlo apuntado para otro día habría sido cerrar
la WAVE 4 sabiendo que `GET /v1/products?sort=createdAt&limit=50` devuelve una segunda
página vacía después de un import. El coste de meterlo fue una migración de más y una nota
de desviación, y las dos están escritas. Lo que **no** cabía allí es lo que queda, y es por
lo que existe este 8b.

**Lo que queda, y no es poco.** La nota de D-67 dice «tres columnas alcanzables como clave
de cursor» y la lista está incompleta:

| Hueco | Qué pasa hoy |
|---|---|
| **`movement.occurred_at` es la cuarta clave de cursor** | `sortable: ['occurredAt']` en `movements.controller.ts:30` y en `stock.controller.ts:21`. D-67 la dio por segura «porque la manda el cliente y pasa por `new Date(iso)`». Es cierto **por convención de escritura, no por tipo**: la columna sigue siendo `timestamptz(6)` y cualquier escritor que no sea el camino de hoy —un backfill, una importación, un `DEFAULT now()` que se active— mete microsegundos y el cursor vuelve a saltarse filas. En dos sitios, porque `/v1/stock/custodies` tiene su propio cursor a mano (`movement.dao.ts:102,117`) |
| **`node.created_at` no tiene ni una prueba que la sostenga** | Revertir `20260919121500_cursor_millisecond_precision/migration.sql:20` a mano no pone roja **ninguna** prueba. El único caso de paginación de nodos ordena por `path` |
| **La regresión de `process_instance` es accidental** | `instance.repository.int-spec.ts:194` funciona como regresión solo porque su cuerpo entero corre dentro de un `withRollback`, así que las tres filas comparten un `now()`. Nada en su nombre ni en sus comentarios lo dice: mover un `save` fuera de la transacción la desarma en silencio |
| **Nada impide que el defecto vuelva a nacer** | `pnpm db:check` compara migraciones contra `schema.prisma` y sale 0 si las dos dicen lo mismo. Una tabla nueva con `created_at @db.Timestamptz` y un `createdAt` en su `sortable` es perfectamente consistente, y reproduce D-67 entero |

Y por debajo de las cuatro claves de cursor hay **25 columnas `timestamptz(6)` más** que se
comparan contra un `Date` de JavaScript (`batch.expires_at`, `movement.due_at`,
`idempotency_key.created_at`, `refresh_token.expires_at`, `outbox_event.occurred_at`,
`media_upload.created_at`…). Ninguna está rota hoy, y todas lo están por la misma razón:
resulta que el camino de escritura actual pasa por la aplicación. Ninguna lo está por su
tipo.

**Lo que este plan decide.** La aplicación no sabe representar microsegundos en ningún
sitio: un `Date` de JavaScript llega al milisegundo y todo lo que sale de Postgres pasa por
uno. Guardar una precisión que nadie puede leer no es información de más, es una trampa
armada. Las **32** columnas de tiempo que aún son `timestamptz(6)` pasan a `timestamptz(3)`
y una prueba de convenciones exige la propiedad contra `information_schema`, sin censo que
mantener — que es la diferencia con una lista blanca, y el motivo de que una lista blanca no
valga: heredaría el modo de fallo del defecto que arregla.

**Nada de esto añade una línea de TypeScript de producción.** Son SQL, `schema.prisma`, dos
comentarios y pruebas. La cobertura no se puede mover.

---

## Global Constraints (heredadas)

- **Test primero, y el ciclo rojo-verde se ve.** Cada Step «Run → FAIL» se ejecuta de verdad
  y se anota qué falló, con el número de filas o el nombre del caso.
- **Las migraciones son solo hacia adelante y nunca se editan.** El arreglo va en una
  migración nueva; tocar `20260919121500_…` le rompe el checksum a las tres bases
  (`tubodega`, `tubodega_test`, `tubodega_docker`) y pide un `migrate reset`. El plan 8 ya
  pagó esto una vez.
- **Las mutaciones no se commitean** (método de [3b](2026-09-12-03b-bitacora-mutaciones.md)):
  lo que queda en el árbol es la bitácora y las pruebas, nunca el `ALTER` revertido.
- `pnpm db:check` tiene que salir **0**: cada `ALTER` de la migración lleva su
  `@db.Timestamptz(3)` gemelo en `schema.prisma`.
- Comentarios de código **en inglés**; descripciones de pruebas **en español**.
- Las seis puertas antes de cerrar: `pnpm lint`, `pnpm typecheck`, `pnpm db:check`,
  `pnpm test`, `pnpm test:e2e`, `pnpm blackbox`.
- La caja negra corre **contra un proceso propio recién compilado en un puerto libre**.
  Verificar contra un `nest --watch` colgado en `:3000` es comprar un falso verde.

---

## Decisión nueva (continúa en D-68)

| # | Qué decide | Por qué |
|---|---|---|
| **D-68** | **Toda columna `timestamptz` del esquema es `timestamptz(3)`**, y una prueba de convenciones (`test/schema/timestamp-precision.int-spec.ts`) lo exige contra `information_schema` sin lista de columnas. Exige además que **ninguna** columna de fecha sea `timestamp without time zone`. Cierra la clase de D-67, y de paso corrige su cuenta: las claves de cursor eran **cuatro**, no tres | Nombrar las columnas una a una fue lo que falló: la lista de D-67 estaba incompleta el día que se escribió (`movement.occurred_at`) y una lista blanca en la prueba tendría el mismo modo de fallo que el defecto —alguien tiene que acordarse de ampliarla el día que una tabla nueva gane `createdAt` en su `sortable`—. La propiedad es más simple que el censo y es cierta de verdad: un `Date` de JavaScript llega al milisegundo, así que una columna de microsegundos guarda algo que el sistema entero no puede leer de vuelta. La segunda aserción tapa el hueco gemelo: un `DateTime` de Prisma **sin** `@db.Timestamptz` cae en `timestamp(3)` —precisión correcta, zona perdida—, y pasaría la primera |

La fila **D-67** del maestro no se reescribe: es el registro de lo que el plan 8 decidió.
Gana una coletilla «revisada y ampliada en el 8b (D-68)», que es el molde con el que D-59
apunta a D-60.

---

## Mapa de archivos

```
libs/persistence/
  prisma/migrations/2026MMDDHHMMSS_all_timestamps_millisecond/migration.sql   (nuevo)
  prisma/schema.prisma                        32 × @db.Timestamptz → (3)      (M)
  src/dao/base/keyset.ts                      un comentario en toPart          (M)
  src/dao/movement.dao.ts                     un comentario en el cursor       (M)
  test/schema/timestamp-precision.int-spec.ts                                 (nuevo)
  test/repositories/inventory/
    movements.int-spec.ts                     la regresión de la cuarta clave  (M)
    nodes.int-spec.ts                         la regresión que faltaba         (M)
  test/repositories/process/
    instance.repository.int-spec.ts           nombrarla como lo que es         (M)

scripts/blackbox/20-catalogo.sh               mil filas y su segunda página    (M)

docs/superpowers/plans/2026-09-19-08b-…md     este documento                   (nuevo)
docs/superpowers/plans/2026-09-06-00-plan-maestro-mvp.md  D-68, fila 8b        (M)
README.md                                     la convención de precisión       (M)
```

---

## Tareas

### Task 1: La cuarta clave de cursor, y todas las marcas de tiempo

Los dos rojos de este plan que se ven **hoy**, sin mutar nada, y el arreglo que los apaga:
`movement.occurred_at` sigue siendo `timestamptz(6)` y acepta lo que le echen, y la prueba
de convenciones aún no existe. Van en una tarea porque son un solo ciclo rojo-verde: el
commit se hace en verde, al final.

**Files:** `libs/persistence/test/repositories/inventory/movements.int-spec.ts` (M);
`libs/persistence/test/schema/timestamp-precision.int-spec.ts` (nuevo);
`libs/persistence/prisma/migrations/2026MMDDHHMMSS_all_timestamps_millisecond/migration.sql`
(nuevo); `libs/persistence/prisma/schema.prisma` (M)

- [x] **Step 1: la regresión de la cuarta clave.** Dos casos, los dos sobre filas insertadas **por SQL crudo** con
      `occurred_at = now()` —el mecanismo exacto del defecto, y el único escritor posible:
      la tabla tiene `REVOKE UPDATE, DELETE`, así que el microsegundo hay que meterlo al
      insertar—. Reutilizar el sembrador de `libs/persistence/test/support/raw-rows.ts`
      para las columnas obligatorias y las FK.
      &nbsp;&nbsp;1. **`/v1/movements`** — 5 movimientos en una sentencia (un `now()` para todos),
         recorrer con `limit: 2` y `sort: {field:'occurredAt', dir:'desc'}` siguiendo
         `nextCursor`: ninguna página vacía, y los 5 ids al final sin huecos ni repetidos.
      &nbsp;&nbsp;2. **Las custodias** — el mismo recorrido por `MovementDao.openCustodies`, que lleva
         **su propio cursor a mano** (`movement.dao.ts:102,117`) y por tanto su propio
         truncamiento. Sin este caso, arreglar la columna no queda probado en el segundo
         sitio donde se usa.
      El assert que carga el peso es el de «esta página no viene vacía», con su comentario
      diciendo qué se veía sin el arreglo — molde de `catalog.int-spec.ts:301`.
- [x] **Step 2: Run** `pnpm test:e2e libs/persistence/test/repositories/inventory` →
      **FAIL**. Anotar los dos casos y con cuántas filas de 5 terminó cada recorrido.
- [x] **Step 3: la prueba de convenciones**, molde de `test/schema/rls.int-spec.ts` —que es
      el precedente de la casa para «afirmar una propiedad del DDL vivo»— con el arnés
      `createPersistenceHarness()` y el pool `system`. Dos casos, ninguno con lista de
      columnas:

      ```sql
      -- D-68: la aplicación solo sabe milisegundos.
      select table_name, column_name, datetime_precision
        from information_schema.columns
       where table_schema = 'public'
         and table_name <> '_prisma_migrations'      -- no es nuestra
         and data_type = 'timestamp with time zone'
         and datetime_precision <> 3
       order by table_name, column_name;
      ```
      → `expect(rows).toEqual([])`, y el mensaje de fallo nombra las columnas.
      El segundo caso, el mismo `select` con
      `data_type like 'timestamp without time zone'` → también vacío.
- [x] **Step 4: Run** → **FAIL** con **32** filas. Anotar la lista; es la que hay que
      escribir en la migración y sirve de comprobación cruzada.
- [x] **Step 5: la migración.** Fichero nuevo —**no** se toca
      `20260919121500_cursor_millisecond_precision`— con los 32
      `ALTER TABLE "x" ALTER COLUMN "y" TYPE timestamptz(3);` y una cabecera que explique
      D-68 en prosa, como hizo la de D-67. Las 32, por tabla:
      `organization` (created_at, updated_at) · `app_user` (created_at, updated_at) ·
      `refresh_token` (expires_at, revoked_at, created_at) ·
      `outbox_event` (occurred_at, published_at) · `idempotency_key` (created_at, expires_at) ·
      `product` (updated_at) · `product_code` (created_at) · `product_media` (created_at) ·
      `media_upload` (created_at, claimed_at) · `batch` (expires_at, created_at) ·
      `custom_field_definition` (created_at, updated_at) · `node` (updated_at) ·
      `movement` (occurred_at, recorded_at, due_at) · `stock_balance` (updated_at) ·
      `process_template` (created_at) · `process_instance` (updated_at) ·
      `step_completion` (completed_at) · `alert` (due_at, raised_at, resolved_at) ·
      `alert_rule` (updated_at).
      Dejar dicho en la cabecera que Postgres **redondea** al estrechar (no trunca), así que
      un valor ya guardado queda en el milisegundo más cercano y a partir de ahí es
      exactamente representable por un `Date` — que es la propiedad entera.
- [x] **Step 6: `schema.prisma`**, las mismas 32 líneas a `@db.Timestamptz(3)`. Mecánico, y
      `pnpm db:check` es quien dice si se escapó alguna.
- [x] **Step 7: Run** `pnpm db:migrate` sobre `tubodega` y `tubodega_test`, luego
      `pnpm db:check` → **0**, la prueba de convenciones → **PASS** con 0 filas, y los dos
      casos del Step 1 → **PASS**.
- [x] **Step 8: Commit** `fix(persistence): toda marca de tiempo a milisegundos (D-68)`

---

### Task 2: Las regresiones que sostienen las otras tres columnas

Estas tres ya eran `timestamptz(3)` antes de este plan, así que su rojo **solo** se ve
mutando: revertir su `ALTER` a mano sobre `tubodega_test`, correr, y volver a aplicarlo.

**Files:** `libs/persistence/test/repositories/inventory/nodes.int-spec.ts` (M);
`libs/persistence/test/repositories/process/instance.repository.int-spec.ts` (M)

- [x] **Step 1: `node.created_at`** — hoy no la sostiene nada. Caso nuevo con el molde de
      `catalog.int-spec.ts:268-309`: N nodos guardados **en una sola transacción** (un
      `now()` para todos), recorrer con `sort: {field:'createdAt'}` y `limit < N`, ninguna
      página vacía, el conjunto completo y ordenado al final.
- [x] **Step 2: `process_instance.created_at`** — el caso de
      `instance.repository.int-spec.ts:194` ya funciona como regresión, pero por accidente.
      Renombrarlo para que diga que sostiene D-67/D-68 y añadirle el comentario que explica
      que el `withRollback` es lo que hace que las tres filas compartan `now()`, y que
      sacar un `save` de ahí lo desarma. Si con tres filas y `limit: 2` el recorrido es
      demasiado corto para ser convincente, subirlo a 5 y `limit: 2`.
- [x] **Step 3: mutar, ver rojo, revertir.** Por cada una de las tres columnas
      (`product.created_at`, `node.created_at`, `process_instance.created_at`), sobre
      `tubodega_test`:
      `ALTER TABLE "x" ALTER COLUMN "y" TYPE timestamptz(6);` → correr su caso → **anotar
      qué falló y con cuántas filas terminó el recorrido** → `TYPE timestamptz(3)`.
      Tres mutaciones, tres rojos. **Ninguna se commitea.**
- [x] **Step 4: Run** `pnpm test:e2e` entero → PASS.
- [x] **Step 5: Commit** `test(persistence): las regresiones que sostienen las cuatro claves de cursor`

---

### Task 3: Los dos comentarios, y la caja negra por el socket

**Files:** `libs/persistence/src/dao/base/keyset.ts` (M);
`libs/persistence/src/dao/movement.dao.ts` (M); `scripts/blackbox/20-catalogo.sh` (M)

- [x] **Step 1: los dos comentarios** (en inglés, sin cambio de comportamiento), en los dos
      sitios donde un `Date` se convierte en parte de cursor: `toPart` de `keyset.ts:22-26`
      y el `encodeCursor` de `movement.dao.ts:117`. Que digan que el ISO de 3 decimales es
      seguro **porque D-68 obliga a la columna a ser `timestamptz(3)`**, y que quien quiera
      guardar microsegundos tiene que arreglar esto primero. Sin la nota, el siguiente
      lector ve una conversión que pierde precisión y la «arregla» por el otro lado.
- [x] **Step 2: la caja negra.** En `20-catalogo.sh`, la reproducción que nombraste, por el
      socket real y no por `inject`: `POST /v1/products/import` con un lote grande en una
      sola petición (todas las filas con el mismo `now()`), luego recorrer
      `GET /v1/products?sort=createdAt&limit=50` siguiendo `nextCursor` hasta agotarlo y
      comprobar que **ninguna página viene vacía** y que el total de SKUs distintos es el
      esperado. Es el par de endpoints exacto del defecto; que solo lo cubran los int-spec
      deja sin probar el camino que el cliente usa. Contar las comprobaciones nuevas para
      la bitácora.
- [x] **Step 3: Run** contra un binario recién compilado en puerto libre:
      `pnpm build && PORT=3100 node dist/apps/tubodega/main &`, `ss -ltnp | grep :3100`,
      `BASE=http://localhost:3100 pnpm blackbox` → **0 fallos**.
- [x] **Step 4: Commit** `test(blackbox): mil filas y su segunda página`

---

### Task 4: La bitácora

**Files:** este documento; el maestro; `README.md`

- [x] **Step 1:** cerrar este documento — lo ejecutado, los rojos vistos (los dos de la Task
      1, las 32 filas de la Task 2, las tres mutaciones de la Task 3), las desviaciones, y
      «lo que encontró cada capa de prueba».
- [x] **Step 2: el maestro:** **D-68** en la tabla de decisiones; la coletilla en la fila
      **D-67** («revisada y ampliada en el 8b: las claves de cursor eran cuatro»); y la fila
      **8b · hecho *(derivado)*** en la tabla de planes, entre el 8 y el 9.
- [x] **Step 3: `README.md`** — la convención de precisión junto a lo que ya documenta de
      `pnpm db:check`: toda `timestamptz` es `(3)` y hay una prueba que lo exige.
- [x] **Step 4:** las seis puertas.
- [x] **Step 5: Commit** `docs(plan): la bitácora del plan 8b`

---

## Bitácora

Ejecutado el 2026-09-19 en `plan/08b-marcas-de-tiempo-en-milisegundos`, cuatro tareas y
cinco commits. Al terminar, las **35** columnas de tiempo del esquema son `timestamptz(3)`
y hay una prueba que lo exige sin guardar una lista de cuáles.

### Los rojos que se vieron

| Qué | Cómo salió |
|---|---|
| `movement.occurred_at`, por `GET /v1/movements` | `expected 0 to be greater than 0` — la segunda página vacía |
| `movement.occurred_at`, por las custodias | lo mismo, y por su cuenta: `openCustodies` keysetea a mano |
| La prueba de convenciones | **32 filas**, `alert.due_at (6)` … `stock_balance.updated_at (6)` |
| `product.created_at` mutada a `(6)` | el caso del plan 8 cayó |
| `node.created_at` mutada a `(6)` | `expected [ …(20) ] to deeply equal [ …(5) ]` |
| `process_instance.created_at` mutada a `(6)` | `expected 0 to be greater than 0` |
| Las tres del blackbox, con la columna mutada en la base del servidor | y entre ellas «la segunda no viene vacía — dio 0» |

Las tres mutaciones se revirtieron; ninguna se commiteó.

### Lo que se encontró y no estaba previsto

**El defecto tiene dos síntomas, y la dirección decide cuál.** El plan —y la nota de
D-67, y el comentario de la prueba del plan 8— hablan de saltarse filas. Eso es lo que pasa
**descendente**: el cursor truncado cae por debajo del valor guardado y
`(created_at, id) < (cursor)` excluye el milisegundo entero. **Ascendente** el mismo
truncamiento hace lo contrario: `> (cursor)` vuelve a incluir lo ya visto, y el recorrido
**no termina**. Se vio mutando `node.created_at`, donde el caso nuevo devolvió 20 filas en
vez de 5 — y solo porque lleva tope de vueltas.

**La regresión del plan 8 moría de timeout, no de aserción.** Recorría con `while (cursor)`
y sin tope, y ordena ascendente: con la columna mutada tardaba **30 002 ms** en caer por el
límite de vitest en lugar de fallar donde tiene el `expect`. Con un tope de 10 vueltas falla
en **80 ms** y dice `['M-0','M-1','M-0','M-1',…]`, que nombra el síntoma. El comentario que
decía «el bucle terminaba con 2 de 5» describía el caso descendente y no el suyo; corregido.

**El plugin de camelCase alcanza también a la consulta cruda.** La primera versión de la
prueba de convenciones pedía `table_name` de `information_schema` y recibía 32 filas de
`undefined.undefined (undefined)`: `KyselyFactory` monta `CamelCasePlugin`, que mapea la
salida de cualquier consulta, `sql` incluida. El rojo era correcto y el mensaje inútil.

**`prisma migrate dev` no pidió reset.** Era el riesgo que el plan 8 pagó al editar una
migración ya aplicada; escribiéndola nueva, `tubodega` y `tubodega_test` avanzaron con las
32 columnas sin perder una fila.

**La caja negra cuenta 548 o 549 según el entorno, y no es una flakez.** La comprobación
del token caducado de `10-tenencia.sh` solo corre si `JWT_SECRET` está exportado en el
shell —es la grieta que la propia suite declara con un `skip`—, así que sourcear `.env`
antes de `pnpm blackbox` suma una. Es anterior a este plan; queda anotado porque cuesta
media hora averiguarlo cuando el total baila entre dos corridas.

### Desviaciones

| Qué dijo el plan | Qué se hizo, y por qué |
|---|---|
| Cinco tareas: la cuarta clave, las marcas de tiempo, las regresiones, los comentarios, la bitácora | **Cuatro.** Partir el ciclo rojo-verde entre dos tareas obligaba a un commit en rojo; la regresión de la cuarta clave y la migración son un solo ciclo y van en un commit |
| El comentario de `Product.createdAt` en `schema.prisma` no se nombraba | Decía que la precisión importa «porque esta columna es clave de cursor», que después de D-68 es la razón pequeña. Reescrito |
| La prueba del plan 8 no se tocaba | Ganó tope de vueltas y su comentario corregido: sin eso, su rojo son 30 s de timeout |
| «Contar las comprobaciones nuevas» | **Siete**, no las pocas previstas: el recorrido ascendente completo (tres asertos), el descendente de dos páginas (dos), y las dos de forma. Catálogo 132 → 139, total 541 → **548** |

### Lo que encontró cada capa de prueba

**La integración** encontró todo lo que este plan arregla. Las dos claves vivas salieron
rojas sin tocar nada, y las tres ya parcheadas solo hablaron al mutarlas — que es
exactamente el hueco que el plan venía a cerrar: una columna arreglada sin prueba es una
columna que el siguiente refactor devuelve al estado anterior en silencio.

**La caja negra** confirmó que el camino del cliente estaba cubierto y no solo el del
repositorio, y es la única capa que reprodujo el síntoma **tal como se reportó**: segunda
página vacía sobre el par `POST /v1/products/import` + `GET /v1/products?sort=createdAt`.

**La prueba de convenciones** es la que no encontró nada hoy y existe para mañana: lo que
falla en ella no es un defecto que ya pasó, sino una tabla nueva que aún no se ha escrito.

### Decisión nueva

**D-68**, en el maestro. Y con ella, la corrección del registro de D-67: las columnas
alcanzables como clave de cursor eran **cuatro**.

---

## Verificación de extremo a extremo

```bash
docker compose up -d db

pnpm db:migrate                     # tubodega y tubodega_test avanzan sin reset
pnpm lint && pnpm typecheck && pnpm db:check && pnpm test
pnpm test:e2e                       # incluye timestamp-precision y las cuatro regresiones
pnpm test:cov                       # los umbrales no se mueven: cero TypeScript de producción

git diff --exit-code apps/tubodega/openapi.json   # tras openapi:write: sin cambios

pnpm build
PORT=3100 node dist/apps/tubodega/main &
ss -ltnp | grep :3100               # que responda EL binario recién compilado
BASE=http://localhost:3100 pnpm blackbox
BASE=http://localhost:3100 pnpm seed
```

Y la comprobación que resume el plan entero, contra la base:

```sql
select count(*) from information_schema.columns
 where table_schema = 'public' and table_name <> '_prisma_migrations'
   and data_type like 'timestamp%' and datetime_precision <> 3;
--  antes: 32     después: 0
```

**El contenedor también.** `compose.yaml` levanta un init container con
`prisma migrate deploy` sobre `tubodega_docker`: un `docker compose up --build` sobre volumen
existente tiene que aplicar la migración nueva y arrancar sano, que es lo que el 3e dejó
prometido.

---

## Qué queda fuera

| Qué | Por qué |
|---|---|
| Llevar la precisión completa **al cursor** (parser de tipos de `pg` que devuelva la cadena de microsegundos en vez de un `Date`) | Sería cambiar cómo se lee **toda** fecha del sistema para ganar una precisión que nadie pide. El acuerdo barato es el contrario: que la base guarde lo que la aplicación sabe leer |
| `media_upload.created_at` y la purga de 24 h (`media-upload.dao.ts:103`) | Es la única comparación µs↔ms **viva** hoy, y es inocua: como mucho difiere una fila de borde a la purga siguiente. D-68 la cierra de paso, sin necesitar caso propio |
| Una regla de `oxlint`/dependency-cruiser sobre `schema.prisma` | No leen `.prisma` ni `.sql`. La prueba contra `information_schema` comprueba el DDL **vivo**, que es más fuerte que comprobar el fichero |
| Índices, `REVOKE`, o cualquier otra propiedad de esquema | Ya tienen sus pruebas en `test/schema/`. Este plan añade una hermana, no las revisa |
