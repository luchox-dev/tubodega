# 02 — Modelo de dominio

> El documento central. Fija el vocabulario que usan todos los demás specs y
> enumera las invariantes que el sistema no puede violar en ningún estado.
>
> Regla editorial: si un término del dominio aparece en cualquier otro spec, su
> definición canónica está **aquí**. Ningún otro documento redefine estos conceptos.

## 1. La idea central: partida doble

Todo movimiento de mercancía tiene **nodo de origen y nodo de destino**. Siempre.
No existe un movimiento que solo suma ni uno que solo resta.

De ahí sale la simplificación que sostiene el modelo entero: lo que en otros
sistemas son cinco tablas y cinco flujos —recepciones, salidas, traslados, ajustes,
préstamos— aquí es **una sola tabla de movimientos sobre un grafo de nodos tipados**.
Lo que distingue una operación de otra no es su estructura, sino qué tipo de nodo
hay a cada lado:

```
recepción    SOURCE:proveedor-acme  ──▶  INTERNAL:BOD-A/MUELLE
almacenaje   INTERNAL:BOD-A/MUELLE  ──▶  INTERNAL:BOD-A/Z1/E3/B2
traslado     INTERNAL:BOD-A/Z1/...  ──▶  INTERNAL:BOD-B/Z2/...
préstamo     INTERNAL:BOD-A/Z1/...  ──▶  CUSTODY:juan          dueAt: 2026-09-12
devolución   CUSTODY:juan           ──▶  INTERNAL:BOD-A/Z1/...
despacho     INTERNAL:BOD-A/Z1/...  ──▶  TERMINAL:venta
merma        INTERNAL:BOD-A/Z1/...  ──▶  TERMINAL:merma
ajuste (+)   SOURCE:ajuste          ──▶  INTERNAL:BOD-A/Z1/...
ajuste (−)   INTERNAL:BOD-A/Z1/...  ──▶  TERMINAL:ajuste
```

Tres consecuencias que se ganan gratis:

- **El sistema siempre cuadra.** Nada aparece ni desaparece sin un nodo al otro lado
  que lo justifique.
- **Las fronteras son auditables por sí solas.** *"¿Cuánto entró de este proveedor
  este mes?"* es una consulta sobre movimientos con origen en ese nodo, no un
  informe con lógica propia.
- **Añadir una operación no añade estructura.** Una devolución a proveedor es
  `INTERNAL ──▶ TERMINAL:devolucion-proveedor`. Cero tablas nuevas.

## 2. Vocabulario

| Término | Definición |
|---|---|
| **Organización** | El tenant. Frontera de aislamiento absoluta: ningún dato cruza entre organizaciones. |
| **Producto** | Una definición de artículo del catálogo. No tiene cantidad; la cantidad vive en las posiciones de stock. |
| **Lote** (`Batch`) | Una subdivisión identificable de un producto: un lote con vencimiento, o una unidad con número de serie. |
| **Nodo** | Cualquier lugar donde puede haber —o de donde puede venir, o hacia donde puede ir— mercancía. Ubicación física, persona, proveedor o sumidero. |
| **Movimiento** | Un asiento inmutable: tanta cantidad de tal producto pasó de tal nodo a tal otro, en tal momento, por obra de tal actor. |
| **Saldo** | La cantidad de un producto (y lote, si aplica) presente en un nodo. Derivado del ledger, materializado por rendimiento. |
| **Inventario propio** | La suma de saldos en nodos `INTERNAL` y `CUSTODY`. Es lo que el negocio posee. |
| **Compensación** | Un movimiento que revierte a otro, invirtiendo origen y destino. La única forma de corregir un error. |

## 3. Nodos

Un nodo es un vértice del grafo por el que circula la mercancía. Cuatro tipos, y el
tipo determina las reglas:

| Tipo | Qué representa | Jerárquico | Saldo negativo | Cuenta como inventario propio |
|---|---|---|---|---|
| `INTERNAL` | Ubicación física propia: bodega, zona, estante, bin | Sí | **No** | Sí |
| `CUSTODY` | Tenedor temporal: persona, vehículo, cliente en préstamo | No | **No** | Sí |
| `TERMINAL` | Sumidero: venta, consumo, merma, devolución a proveedor, ajuste negativo | No | Sí (acumula) | No |
| `SOURCE` | Fuente: proveedor, saldo inicial, ajuste positivo | No | Sí (acumula) | No |

`INTERNAL` y `CUSTODY` son **nodos custodiables**: representan mercancía que el
negocio tiene y de la que responde. Su saldo no puede ser negativo, porque no se
puede sacar de un estante lo que no está en el estante.

`SOURCE` y `TERMINAL` son **fronteras del sistema**. Su saldo acumula sin límite y
su signo carece de sentido físico: el saldo de `TERMINAL:venta` no es una
existencia, es un total histórico de lo despachado.

```
Node
  id            NodeId
  orgId         OrgId
  kind          INTERNAL | CUSTODY | TERMINAL | SOURCE
  code          único por organización
  name
  parentId?     solo INTERNAL; forma un árbol
  path          materializado: "BOD-A/Z1/E3/B2"
  active        un nodo inactivo no admite movimientos nuevos
  customFields  JSONB
```

### Por qué una sola tabla

Separar `Location`, `Person` y `Supplier` en tres tablas obligaría a que `Movement`
tuviera origen y destino polimórficos —dos columnas de tipo más dos de id, sin
integridad referencial posible— o a tres tablas de movimiento distintas. La
unificación es la que hace que la partida doble sea expresable con una clave foránea
normal. El precio es que un nodo `CUSTODY` no tiene teléfono ni cargo; esos datos,
si algún día hacen falta, van en una entidad de `tenancy` que referencia al nodo.

### El árbol

Solo los `INTERNAL` anidan, y forman un árbol estricto: un padre por nodo, sin
ciclos. `path` se mantiene materializado porque las consultas naturales del producto
—*"todo lo que hay bajo la zona 1"*— son de subárbol, y recorrer la jerarquía por
recursión en cada lectura no escala. Se recalcula al mover un nodo de padre, dentro
de la misma transacción.

Los nodos hoja son los únicos que deberían recibir stock en una operación normal,
pero **el modelo no lo impone**: durante una migración desde Excel es legítimo tener
todo en la raíz de la bodega e ir refinando. Es una recomendación de producto, no
una invariante.

## 4. Productos

```
Product
  id            ProductId
  orgId         OrgId
  sku           único por organización
  name
  description?
  trackingMode  QUANTITY | LOT | SERIAL
  uom           unidad de medida: UNIT, KG, L, M, ...
  active
  customFields  JSONB, validado contra CustomFieldDefinition
  createdAt, updatedAt

ProductCode      N códigos por producto
  id, orgId, productId
  value          único por organización
  kind           EAN | UPC | INTERNAL_QR | SUPPLIER_REF | OTHER

ProductMedia
  id, orgId, productId
  storageKey, contentType, byteSize, position
```

### `trackingMode`

Es la propiedad que más consecuencias tiene en todo el sistema:

| Modo | Significado | `batchId` en movimientos | Ejemplo |
|---|---|---|---|
| `QUANTITY` | Unidades indistinguibles | Siempre nulo | Tornillos, sacos de arroz |
| `LOT` | Agrupadas por lote, típicamente con vencimiento | Obligatorio | Medicamentos, alimentos |
| `SERIAL` | Cada unidad es identificable | Obligatorio | Herramientas, equipos |

Cambiar el `trackingMode` de un producto que ya tiene movimientos **no está
permitido**: invalidaría el histórico. Si el negocio necesita empezar a controlar
lotes de algo que no los controlaba, crea un producto nuevo y da de baja el
anterior. Es una fricción deliberada; la alternativa —migrar el ledger— rompe la
inmutabilidad, que es el cimiento del modelo.

### Múltiples códigos

Un producto tiene N códigos porque así es la realidad: el EAN del fabricante, el QR
que el negocio imprimió, y la referencia con la que el proveedor lo factura. El
escaneo resuelve cualquiera de ellos al mismo producto. El código es único por
organización, no por producto: dos productos no pueden compartir un código, o el
escaneo sería ambiguo.

## 5. Lotes

```
Batch
  id            BatchId
  orgId         OrgId
  productId
  lotCode?      obligatorio si el producto es LOT
  serial?       obligatorio si el producto es SERIAL
  expiresAt?    alimenta el motor de alertas
  customFields  JSONB
```

Un `Batch` no tiene cantidad. La cantidad de un lote en un lugar concreto es un
saldo, igual que la de un producto sin lote. Esto mantiene una sola forma de
responder *"¿cuánto hay?"*.

Para productos `SERIAL`, un `Batch` es una unidad individual: su cantidad total en
todo el sistema, sumada sobre nodos custodiables, es 0 o 1. Nunca más.

## 6. Movimientos

El corazón. Append-only, sin excepciones.

```
Movement
  id                 MovementId — UUIDv7 generado por el cliente
  orgId              OrgId
  productId
  batchId?           según trackingMode del producto
  fromNodeId         ─┐ los dos, siempre
  toNodeId           ─┘
  quantity           decimal, siempre > 0
  occurredAt         reloj del dispositivo que originó la operación
  recordedAt         reloj del servidor al persistir
  actorId            usuario responsable
  reason?            texto libre; obligatorio en ajustes
  dueAt?             retorno esperado; solo si toNode es CUSTODY
  reversesId?        el movimiento que este compensa
  settlesId?         el check-out que este check-in salda; obligatorio si fromNode es CUSTODY
  processInstanceId? la operación que lo originó (id opaco de `common`; el ledger no conoce a `process`)
```

No hay clave de idempotencia en el movimiento. La idempotencia es una propiedad
de la petición HTTP, no del hecho, y vive en la capa que recibe peticiones
([07 §5](07-composicion-y-contexto-de-ejecucion.md)). El `id` generado por el
cliente basta para que un reintento que se cuele choque contra la clave primaria.

### Dos relojes, no uno

`occurredAt` es cuándo pasó según el dispositivo; `recordedAt`, cuándo se persistió.
Hoy difieren en milisegundos. El día que el cliente pueda encolar operaciones sin
red, pueden diferir en horas — y el informe *"qué se movió el martes"* debe usar
`occurredAt`, mientras que la auditoría *"qué sabíamos el martes"* debe usar
`recordedAt`. Separarlos ahora cuesta una columna; unirlos después costaría
reinterpretar todo el histórico.

### La cantidad no lleva signo

`quantity` es siempre positiva. La dirección la da el par origen-destino. Un modelo
con cantidades negativas necesitaría, en cada consulta, saber si el signo se refiere
al origen o al destino; con partida doble esa ambigüedad no existe.

### Devolver es saldar

Un movimiento que sale de un nodo `CUSTODY` —un check-in— lleva `settlesId`
apuntando al check-out que cierra. Sin ese enlace, la custodia de productos por
cantidad no tiene respuesta por préstamo: si Juan sacó dos martillos en días
distintos y devolvió uno, el saldo agregado dice *"tiene uno"*, pero no dice
**cuál** debe todavía — y la fecha de retorno, que es lo que el producto vigila,
es de cada préstamo, no del agregado.

```
mov-1   B2 ──2──▶ CUSTODY:juan     dueAt: lunes
mov-2   B2 ──1──▶ CUSTODY:juan     dueAt: viernes
mov-3   CUSTODY:juan ──2──▶ B2     settlesId=mov-1   (el lunes queda saldado)
```

Un check-in puede saldar parcialmente (devolver 1 de 2), y un check-out puede
recibir varios check-ins, pero la suma de lo saldado nunca supera lo prestado
(I-18). El pendiente de un préstamo es `cantidad − Σ saldado`, y es sobre ese
pendiente —no sobre el saldo del nodo— que se levanta la alerta de custodia
vencida ([14 §4](14-alerts.md)). Un check-out compensado cuenta como saldado.

Para productos `SERIAL` el enlace es redundante —la unidad es una y solo puede
estar en un sitio— pero se exige igual: una sola regla para todos los modos es
más fácil de cumplir que una regla con excepción.

### Corregir es compensar

Si alguien registra 100 unidades donde había 10, el asiento equivocado **se queda**.
La corrección es un movimiento nuevo con `reversesId` apuntando al original,
origen y destino invertidos, y la misma cantidad. Luego se registra el correcto.

```
mov-1   MUELLE ──100──▶ B2                     (error)
mov-2   B2 ──100──▶ MUELLE    reversesId=mov-1 (compensación)
mov-3   MUELLE ──10───▶ B2                     (correcto)
```

El histórico muestra los tres. Que el error sea visible no es un defecto de la
interfaz: es la propiedad que hace que el registro sea prueba de lo que ocurrió, y
la que permitirá replicar el ledger a un cliente offline sin miedo a que el pasado
cambie bajo sus pies.

## 7. Saldos

```
StockBalance
  id                                   ← surrogate; lo exige Prisma, el dominio no lo usa
  orgId, nodeId, productId, batchId    ← clave natural, única
  nodeKind                             ← desnormalizado desde Node
  quantity
  updatedAt
```

Se actualiza en la **misma transacción** que inserta el movimiento. No hay proceso
asíncrono, ni recálculo nocturno, ni ventana en la que el saldo esté desfasado.

**Materializado y no calculado**, por dos razones. La primera es rendimiento: la
consulta más frecuente del producto es *"¿cuánto hay aquí?"*, y responderla con un
`SUM` sobre un ledger que crece sin límite degrada con el tiempo. La segunda importa
más: un saldo materializado admite un `CHECK` de no-negatividad, y ese constraint
convierte *"no se puede despachar lo que no existe"* de una validación de aplicación
—que se puede olvidar en un camino nuevo— en una imposibilidad de la base de datos.

`nodeKind` está desnormalizado porque un `CHECK` no puede consultar otra tabla. Es
la única desnormalización del modelo y existe exclusivamente para hacer cumplible la
invariante I-4.

Que el saldo pueda reconstruirse sumando el ledger sigue siendo cierto, y es una
prueba de reconciliación permanente, no un mecanismo de lectura.

## 8. Campos custom

```
CustomFieldDefinition
  id, orgId
  entity        PRODUCT | NODE | BATCH
  key           único por (orgId, entity)
  label
  type          TEXT | NUMBER | DATE | BOOLEAN | SELECT
  options?      para SELECT
  required
  position
```

Los valores viven en la columna `customFields` (JSONB) de la entidad. La validación
contra las definiciones ocurre en el dominio, al construir o modificar la entidad.

**Por qué JSONB y no una tabla de valores.** Una tabla `(entityId, fieldId, value)`
obligaría a un join por campo y a guardar todo como texto, perdiendo el tipo.
JSONB conserva el tipo nativo, se lee en la misma fila, y Postgres lo indexa con
GIN si algún filtro lo necesita. El costo es que la integridad referencial entre
valor y definición no la impone la base de datos, sino el dominio — un intercambio
razonable para datos que solo esa organización interpreta.

## 9. Invariantes

Cada una con el mecanismo que la garantiza. El mecanismo importa tanto como la
regla: una invariante cuya única garantía es *"el código tiene cuidado"* se rompe.

| # | Invariante | Mecanismo |
|---|---|---|
| **I-1** | Todo movimiento tiene origen y destino, y son distintos | `CHECK (from_node_id <> to_node_id)` |
| **I-2** | La cantidad de un movimiento es estrictamente positiva | `CHECK (quantity > 0)` |
| **I-3** | Los movimientos no se actualizan ni se borran jamás | Sin `UPDATE`/`DELETE` en el repositorio; privilegios revocados en el rol de aplicación |
| **I-4** | El saldo en nodos custodiables nunca es negativo | `CHECK (quantity >= 0 OR node_kind IN ('SOURCE','TERMINAL'))` sobre `stock_balance` |
| **I-5** | El saldo materializado coincide con la suma del ledger | Misma transacción + prueba de reconciliación en CI |
| **I-6** | Ninguna fila es accesible desde otra organización | `org_id` en toda tabla + RLS de Postgres |
| **I-7** | Reintentar una escritura no la duplica | Tabla `idempotency_key` con reserva y confirmación ([07 §5](07-composicion-y-contexto-de-ejecucion.md)) + `id` de cliente como clave primaria |
| **I-8** | `batchId` es nulo si y solo si el producto es `QUANTITY` | Validación de dominio + `CHECK` con `tracking_mode` desnormalizado en el movimiento |
| **I-9** | Un producto `SERIAL` tiene a lo sumo una unidad en nodos custodiables | Validación de dominio en **todo** asiento que entra desde la frontera —recepción y compensación de despacho por igual— + prueba de invariante |
| **I-10** | La jerarquía de nodos es un árbol: solo `INTERNAL`, sin ciclos | `CHECK (parent_id IS NULL OR kind = 'INTERNAL')` + detección de ciclo al asignar padre |
| **I-11** | `dueAt` solo existe en movimientos hacia un nodo `CUSTODY` | Validación de dominio + `CHECK` con `to_node_kind` desnormalizado |
| **I-12** | Una compensación invierte exactamente al movimiento que referencia | Validación de dominio: mismo producto, mismo lote, misma cantidad, nodos invertidos |
| **I-13** | Un movimiento no puede compensarse dos veces | `UNIQUE (org_id, reverses_id)` parcial, donde `reverses_id IS NOT NULL` |
| **I-14** | `occurredAt` no es posterior a `recordedAt` más la tolerancia de reloj | Validación en el borde; tolerancia de 5 minutos por desfase de dispositivo |
| **I-15** | El `trackingMode` de un producto con movimientos no cambia | Validación de dominio en el caso de uso de actualización |
| **I-16** | Un nodo inactivo no admite movimientos nuevos | Validación de dominio; los movimientos históricos siguen siendo válidos |
| **I-17** | Todo movimiento desde un nodo `CUSTODY` salda un check-out o compensa uno | `CHECK` con `from_node_kind` desnormalizado + validación de dominio: el saldado tiene como destino el origen de este, mismo producto y lote |
| **I-18** | Lo saldado de un check-out nunca supera su cantidad | Validación de dominio con el pendiente vigente + prueba de propiedades |

Las tres innegociables son **I-3** (inmutabilidad), **I-4** (no-negatividad) e
**I-6** (aislamiento). Si alguna se rompe, el producto deja de ser confiable en un
sentido que ninguna funcionalidad compensa.

## 10. Operaciones canónicas

Todas se expresan sobre el mismo ledger. Ninguna necesita estructura propia.

| Operación | Origen | Destino | Notas |
|---|---|---|---|
| Recepción | `SOURCE` proveedor | `INTERNAL` | Ciega en el MVP: sin orden de compra previa |
| Almacenaje | `INTERNAL` | `INTERNAL` | Un traslado; la distinción es de proceso, no de dominio |
| Traslado | `INTERNAL` | `INTERNAL` | Entre bins, zonas o bodegas |
| Check-out | `INTERNAL` | `CUSTODY` | Admite `dueAt` |
| Check-in | `CUSTODY` | `INTERNAL` | `settlesId` obligatorio; puede ser parcial |
| Despacho | `INTERNAL` | `TERMINAL` venta | |
| Merma | `INTERNAL` | `TERMINAL` merma | `reason` obligatorio |
| Ajuste positivo | `SOURCE` ajuste | `INTERNAL` | `reason` obligatorio |
| Ajuste negativo | `INTERNAL` | `TERMINAL` ajuste | `reason` obligatorio |
| Compensación | invertidos | invertidos | `reversesId` obligatorio |

Que almacenaje y traslado sean la misma operación de dominio, distinguidas solo por
la plantilla de proceso que las origina, es un buen indicador de que la abstracción
está en el nivel correcto.

## 11. Lo que el modelo deja preparado

| Extensión | Cómo encaja sin cambiar el modelo |
|---|---|
| **Conteo cíclico** | El conteo produce una diferencia; la diferencia es un ajuste; el ajuste ya existe. Solo hace falta la entidad de la tarea de conteo. |
| **Órdenes de compra** | Una entidad de `catalog` o de un contexto nuevo, que la recepción referencia. El movimiento no cambia. |
| **Picking** | Requiere **reserva**: saldo comprometido pero no movido. Se añade como columna `reserved` en `StockBalance` con su propio constraint, sin tocar el ledger. |
| **Costeo** | Columnas de costo en el movimiento y un saldo valorizado paralelo. El ledger ya tiene la granularidad necesaria. |
| **Offline-first** | Ya está: id de cliente, idempotencia, append-only y dos relojes son exactamente lo que exige una réplica local. |
| **Multi-empresa** | La organización ya es la frontera. Un grupo de organizaciones sería una entidad por encima, sin tocar nada de aquí. |

## 12. Documentos relacionados

- [01 — Arquitectura](01-arquitectura.md) — dónde vive cada pieza
- [04 — Persistencia](04-persistencia.md) — cómo se traduce esto a tablas
- [12 — Inventory](12-inventory.md) — el módulo que implementa este núcleo
- [90 — Extensiones previstas](90-extensiones-previstas.md)
