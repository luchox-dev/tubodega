# Bitácora de mutaciones — saldar la desviación 1 del plan 3

Las tareas 3 a 7 del [plan 3](2026-09-12-03-el-catalogo.md) no siguieron el ciclo
rojo-verde: la implementación se escribió antes que las pruebas, en el mismo commit.
Las pruebas pasaban, pero ninguna se había visto fallar, así que no estaba demostrado
que probaran lo que creen probar.

La forma de saldarlo es por mutación: romper a mano la invariante, comprobar que la
prueba que la cubre se pone roja, y revertir. **Las mutaciones nunca se commitean**; lo
que queda en el repositorio es esta bitácora y los dos arreglos que salieron de ella.

**Fecha:** 2026-09-12 · **Rama:** `plan/03b-saldar-la-deuda`

## Resumen

| | |
|---|---|
| Mutaciones probadas | **25** |
| Se pusieron rojas | **25** |
| Pruebas que no existían | **1** (la del filtro por clase de nodo, mutación 21) |
| Pruebas que se pusieron rojas sin probar nada | **1** (el aislamiento por clave primaria, mutación 24) |
| Mutaciones dejadas en el árbol | **0** |

Ninguna prueba existente dejó de ponerse roja. Los dos hallazgos son de otro tipo: una
invariante **sin ninguna prueba**, y una prueba que **pasaba con la invariante rota**
aunque su hermana la cubriera.

---

## Dominio y aplicación (1–17) · `pnpm test libs/catalog`

Línea base: 11 archivos, 152 pruebas, 483 ms.

| # | Qué se rompió | Caso que cayó | Y además |
|---|---|---|---|
| 1 | `custom-field.ts` · `build` deja de acumular `unknown-field` | `a key nobody defined is an error, not a silent extra` | 2 casos más |
| 2 | `custom-field.ts` · `NUMBER` acepta cadenas numéricas | `NUMBER takes a number, and "12" is a client bug, not a number` | 4 casos más |
| 3 | `custom-field.ts` · `build` no exige los `required` ausentes | `an absent required field is an error` | — |
| 4 | `batch.ts` · fuera la guarda de `QUANTITY` | `C-4 · a QUANTITY product has no batches at all` | el C-4 del caso de uso |
| 5 | `batch.ts` · `expiresWithin` de `<=` a `<` | `expiresWithin is true at the exact edge of the window` | — |
| 6 | `ids.ts` · `Sku.of` con `/^.{1,64}$/` | `rejects whitespace inside, which is how a bad paste announces itself` | 2 casos más |
| 7 | `update-product.ts` · sin `MovementCounter` ni `throw` | `C-8 · and not once it has, with the count in the detail` | — |
| 8 | `deactivate-product.ts` · sin `StockChecker` ni `throw` | `C-9 · one with stock is not, and the error says where it is` | — |
| 9 | `define-custom-field.ts` · sin `countEntitiesMissing` | `C-10 · a required field is refused while entities are missing it` | — |
| 10 | `update-custom-field.ts` · sin `countEntitiesWith` | `D-10 · and not once somebody does` | — |
| 11 | `import-products.ts` · una fila mala lanza en vez de acumularse | `one bad row does not abort the batch, and says which line it was` | 4 casos más |
| 12 | `import-products.ts` · sin el tope de `MAX_IMPORT_ROWS` | `D-11 · beyond a thousand rows it stops being an import` | — |
| 13 | `resolve-code.ts` · sin la rama de `findBySerial` | `resolves by serial, and hands back the product and the unit` | — |
| 14 | `create-product.ts` · sin `requireAction(MANAGE_CATALOG)` | `an OPERATOR does not define the catalogue` | — |
| 15 | `create-batch.ts` · `CREATE_BATCH` → `MANAGE_CATALOG` | `an OPERATOR creates the lot that arrives with the goods` | — |
| 16 | `attach-media.ts` · adjunta antes de comprobar las perdidas | `reports the lost keys before attaching anything, so nothing lands half-done` | — |
| 17 | `media-errors.ts` · `MAX_MEDIA_BYTES` a 100 MB | `ten megabytes is the limit` | `checks the type and the size of a direct upload too` |

Notas:

- **17** no se aplica donde decía el encargo: `MAX_MEDIA_BYTES` no vive en
  `stage-upload.ts` sino en `libs/catalog/src/domain/media-errors.ts`, y de ahí lo leen
  tanto `StageUpload` como `AttachMedia`. Cayeron los dos casos, uno por cada camino.
- **16** es la más fina del bloque, y es la que mejor sale parada: el caso no cayó por el
  `throw` —que sigue ocurriendo— sino por su último assert, `expect(list).toEqual([])`.
  El mensaje fue `expected [ { …(6) } ] to deeply equal []`: la foto válida sí se había
  adjuntado. Prueba el orden, que es exactamente lo que dice su título.
- **12** se rompió quitando el `throw`, no la constante: `MAX_IMPORT_ROWS` lo importa la
  propia prueba para construir las 1001 filas.

## Persistencia (18–20) · `pnpm test:e2e libs/persistence/test/repositories/catalog`

| # | Qué se rompió | Casos que cayeron |
|---|---|---|
| 18 | `product.repository.ts` · `translate` deja pasar el `UniqueViolationError` | `C-1 · a repeated SKU is sku-taken, not a raw 23505` y `C-1 · and under real concurrency exactly one of the two wins` |
| 19 | `product-code.repository.ts` · sin el `uow.run(...)` que envuelve el `INSERT` | `C-2 · a repeated code names the product that already holds it, and the transaction survives` |
| 20 | `batch.repository.ts` · nombres de constraint de `serial` y `lot_code` intercambiados | `C-5 · the serial is unique across the organization` y `C-6 · the lot code is unique per product, and only per product` |

La **19** falló exactamente por donde tenía que fallar. El mensaje:

```
AssertionError: expected error: current transaction is aborted, co… to match object { type: 'code-taken' }
+   "code": "25P02",
```

Sin el savepoint, el `23505` aborta la transacción y la consulta que lee **qué producto**
ya usa el código muere con `25P02` antes de poder nombrarlo. Es el motivo por el que el
savepoint bajó al repositorio (desviación 5 del plan 3), y ahora está demostrado.

## El filtro por clase de nodo (21) — **la prueba no existía**

`StockBalanceDao.positionsOfProduct` no se ejecutaba en ninguna prueba del repositorio.
Ni el filtro `nodeKind in ('INTERNAL','CUSTODY')`, ni el descarte de los saldos en cero,
ni el `innerJoin` a `node` que devuelve el `path` legible. La tabla `stock_balance` solo
se tocaba por SQL crudo, en las suites de esquema.

Tampoco lo cubre ningún constraint: `stock_balance_i4_non_negative` permite
**expresamente** que un `SOURCE` o un `TERMINAL` vayan en negativo, porque son la
frontera del sistema y su saldo es un acumulado, no existencias en un estante.

Se escribió `libs/persistence/test/dao/stock-balance.int-spec.ts` con tres casos, y
entonces sí se mutó: quitando la línea del filtro, cae
`un saldo en la frontera del sistema no es existencia: SOURCE y TERMINAL no cuentan`.

## Esquema (22–25) · sobre `tubodega_test`

No se muta código: se muta la base y se restaura después.

| # | Qué se rompió | Casos que cayeron |
|---|---|---|
| 22 | `DROP CONSTRAINT movement_i2_positive_quantity` | `I-2 · a movement of zero moves nothing` |
| 23 | `GRANT UPDATE, DELETE ON movement` a los dos roles | los cinco de la suite |
| 24 | `DROP POLICY org_isolation ON product` | `product: a tenant transaction for B sees only B, even without a WHERE` y `the tenant pool without app.current_org cannot read at all` |
| 25 | Índice único de `stock_balance` sin `NULLS NOT DISTINCT` | `two upserts with batch_id NULL leave one row, with the quantities added` |

En la **23** cayeron los cinco casos y no cuatro: el `DELETE` que la mutación permitió
vació el ledger, así que el caso que comprueba que `INSERT` y `SELECT` siguen
funcionando —y que esperaba encontrar filas— también se puso rojo. Es el `REVOKE`
demostrando por qué existe.

### Restaurar no fue automático

Dos mutaciones dejaron datos que la propia invariante prohíbe, y volver a crear el objeto
fallaba mientras esos datos siguieran ahí:

- **22**: con el `CHECK` fuera, la prueba insertó el movimiento de cantidad cero que
  esperaba ver rechazado. `ADD CONSTRAINT` → `check constraint … is violated by some row`.
  Se borró esa fila y se restauró.
- **25**: con el índice debilitado, los dos upserts dejaron dos filas en vez de una.
  `CREATE UNIQUE INDEX … NULLS NOT DISTINCT` → `Duplicate keys exist`. Se borró la
  duplicada y se restauró.

No hizo falta recrear `tubodega_test`. El estado final se verificó contra el catálogo de
Postgres —`pg_constraint`, `role_table_grants`, `pg_policy`, `pg_index.indnullsnotdistinct`—
y coincide con lo que dejó `20260912162952_full_schema`.

## El hallazgo de la 24

La mutación 24 se puso roja, pero **no por el caso que debía atraparla**. El caso
`nor can it reach into A by primary key on a catalogue table` afirmaba una sola cosa: que
la consulta devuelve cero filas. Con `FORCE ROW LEVEL SECURITY` y sin política no se ve
absolutamente nada, así que pasaba igual con la invariante rota. Cero filas significa
aislamiento y también ceguera, y el caso no distinguía una de otra.

Lo salvó su hermano, el que exige ver las filas propias. Pero un caso que pasa con la
invariante rota no prueba nada por sí solo, y ése era justo el riesgo que el ciclo
rojo-verde habría destapado en su momento.

Arreglado en `9799aaa`: la misma consulta se hace dos veces, contra el producto ajeno y
contra el propio, y solo pasa si la primera no devuelve nada y la segunda sí. Repetida la
mutación, ahora también cae.
