# 12 — Inventory

> `libs/inventory` · Nodos, movimientos y saldos. **El núcleo del producto.**
>
> Todo lo que tubodega sabe sobre dónde está la mercancía y quién la movió vive
> aquí. Los demás módulos son catálogo, orquestación o presentación de esto.

## 1. Propósito y frontera

Tres responsabilidades:

1. **El grafo de nodos** — dónde puede haber mercancía y cómo se organiza
2. **El ledger** — el registro inmutable de todo movimiento
3. **Los saldos** — cuánto hay en cada posición, derivado del ledger

Queda fuera: qué es cada producto ([11](11-catalog.md)), qué secuencia de pasos
condujo a un movimiento ([13](13-process.md)), y qué fechas hay que vigilar
([14](14-alerts.md)).

**El límite que más importa:** `inventory` no sabe nada de recepciones, despachos ni
préstamos. Solo conoce movimientos entre nodos. Que un movimiento sea "una recepción"
es una interpretación que surge del tipo de los nodos implicados y de la plantilla de
proceso que lo originó — nunca una propiedad del movimiento mismo.

Es la abstracción que hace que añadir una operación nueva no cueste nada, y por eso
se defiende con firmeza: cualquier campo tipo `operationType` en `Movement` sería el
principio del final de esa propiedad.

## 2. Entidades y tipos del dominio

```ts
type NodeId     = Branded<string, 'NodeId'>;
type MovementId = Branded<string, 'MovementId'>;
type NodeCode   = Branded<string, 'NodeCode'>;   // único por organización, 1-64
type NodePath   = Branded<string, 'NodePath'>;   // "BOD-A/Z1/E3/B2"

// TrackingMode, ProductId y BatchId vienen de @app/catalog — ver [11 §2].
// ProcessInstanceId viene de @app/common — ver [01 §4]: `process` está por
// encima de `inventory`, así que el ledger solo conoce un id opaco.

// ─── Cantidad ──────────────────────────────────────────────────────────────
class Quantity {
  private constructor(private readonly raw: bigint);  // milésimas

  static of(value: string): Result<Quantity>;         // "12.500"
  static zero(): Quantity;

  plus(o: Quantity): Quantity;
  minus(o: Quantity): Quantity;
  isPositive(): boolean;
  isZero(): boolean;
  compare(o: Quantity): -1 | 0 | 1;
  toString(): string;                                 // "12.500"
}
```

`Quantity` guarda un entero de milésimas, no un `number`. Sumar 0.1 tres veces con
flotantes no da 0.3, y en un ledger ese error se acumula asiento a asiento hasta que
el saldo materializado deja de cuadrar con el histórico. El entero es exacto por
construcción y casa con el `numeric(18,3)` del esquema.

```ts
// ─── Nodo ──────────────────────────────────────────────────────────────────
enum NodeKind { INTERNAL, CUSTODY, TERMINAL, SOURCE }

class Node {
  readonly id: NodeId;
  readonly orgId: OrgId;
  readonly kind: NodeKind;
  readonly code: NodeCode;
  readonly name: string;
  readonly parentId?: NodeId;
  readonly path: NodePath;        // "BOD-A/Z1/E3/B2"
  readonly active: boolean;
  readonly customFields: CustomFieldValues;
  readonly version: number;

  isCustodial(): boolean;         // INTERNAL o CUSTODY
  isBoundary(): boolean;          // SOURCE o TERMINAL
  canReceiveMovements(): boolean; // active
  isDescendantOf(other: Node): boolean;
}
```

`isCustodial()` es el predicado central del módulo: separa lo que el negocio posee
—y cuyo saldo no puede ser negativo— de las fronteras del sistema. Aparece en la
invariante I-4, en el cálculo de inventario propio y en I-9.

```ts
// ─── Movimiento ────────────────────────────────────────────────────────────
class Movement {
  readonly id: MovementId;
  readonly orgId: OrgId;
  readonly productId: ProductId;
  readonly batchId?: BatchId;
  readonly fromNodeId: NodeId;
  readonly toNodeId: NodeId;
  readonly quantity: Quantity;
  readonly occurredAt: Date;
  readonly recordedAt: Date;
  readonly actorId: UserId;
  readonly reason?: string;
  readonly dueAt?: Date;
  readonly reversesId?: MovementId;
  readonly settlesId?: MovementId;      // I-17: obligatorio si fromNode es CUSTODY
  readonly processInstanceId?: ProcessInstanceId;
  readonly traceId: TraceId;
  readonly trackingMode: TrackingMode;  // desnormalizado
  readonly fromNodeKind: NodeKind;      // desnormalizado
  readonly toNodeKind: NodeKind;        // desnormalizado

  static create(input: CreateMovementInput): Result<Movement>;
  reverse(by: UserId, at: Date): Movement;
}

interface CreateMovementInput {
  readonly id?: MovementId;                 // UUIDv7 del cliente; se genera si falta
  readonly orgId: OrgId;
  readonly product: Product;                // resuelto, no solo su id: aporta trackingMode
  readonly batch?: Batch;
  readonly fromNode: Node;                  // resuelto: aporta kind para I-11
  readonly toNode: Node;
  readonly quantity: Quantity;
  readonly occurredAt: Date;
  readonly recordedAt: Date;
  readonly actorId: UserId;
  readonly reason?: string;
  readonly dueAt?: Date;
  readonly reversesId?: MovementId;
  readonly settles?: {                      // resuelto: aporta lo necesario para I-17 e I-18
    readonly movement: Movement;
    readonly pending: Quantity;             // cantidad − Σ saldado hasta ahora
  };
  readonly processInstanceId?: ProcessInstanceId;
  readonly traceId: TraceId;
}
```

No hay `idempotencyKey`: la idempotencia es de la petición, no del hecho, y la
resuelve el borde ([07 §5](07-composicion-y-contexto-de-ejecucion.md)).

`Movement` es **inmutable**: sin setters, sin métodos que devuelvan una copia
modificada. `reverse()` no cambia nada, produce un movimiento nuevo. La clase
refleja en el tipo la invariante I-3, de forma que ni siquiera se puede expresar la
operación prohibida.

```ts
// ─── Saldo ─────────────────────────────────────────────────────────────────
class StockPosition {
  readonly nodeId: NodeId;
  readonly productId: ProductId;
  readonly batchId?: BatchId;
  readonly nodeKind: NodeKind;
  readonly quantity: Quantity;
}
```

## 3. Invariantes

Las de [02 §9](02-modelo-de-dominio.md) que este módulo hace cumplir —I-1 a I-18 son
todas suyas salvo I-6 e I-7, que son del borde ([07](07-composicion-y-contexto-de-ejecucion.md))—
más tres propias del grafo:

| # | Invariante | Mecanismo |
|---|---|---|
| **N-1** | `path` refleja siempre la cadena real de padres | Recalculado en la misma transacción al reasignar padre |
| **N-2** | Reasignar padre actualiza el `path` de todo el subárbol | Actualización en bloque por prefijo de `path` |
| **N-3** | Un nodo con saldo distinto de cero no se desactiva | Caso de uso, consultando `StockBalanceRepository` |

### La invariante fundacional

Merece su propio apartado porque es la que sostiene todas las demás:

> **Conservación.** Para todo producto y lote, la suma de saldos sobre todos los
> nodos —custodiables y de frontera— es exactamente cero.

Se sigue de la partida doble: cada movimiento suma `q` en un nodo y resta `q` en
otro. Si alguna vez no se cumple, hay un movimiento que se escribió sin actualizar
ambos extremos, y todo el modelo deja de ser confiable.

Se comprueba con una prueba de propiedades sobre secuencias generadas, descrita en
[06 §7](06-pruebas-y-calidad.md).

## 4. Casos de uso

### 4.1 Nodos

```ts
interface CreateNode {                                   // MANAGE_NODES
  execute(ctx, input: {
    kind: NodeKind; code: string; name: string;
    parentId?: NodeId;
    customFields?: Record<string, unknown>;
  }): Promise<Node>;
}
```
Precondiciones: `code` libre en la organización; si hay `parentId`, el padre existe,
es `INTERNAL` y el hijo también lo es (I-10). El `path` se calcula concatenando el
del padre con el `code`.

```ts
interface UpdateNode  { /* MANAGE_NODES · If-Match · no cambia kind */ }
interface MoveNode    { /* MANAGE_NODES · N-1, N-2, sin ciclos */ }
interface DeactivateNode { /* MANAGE_NODES · N-3 */ }

interface ListNodes {                                    // READ
  execute(ctx, filter: {
    kind?: NodeKind; active?: boolean;
    under?: NodeId;              // subárbol, por prefijo de path
  }, page: Cursor): Promise<Page<Node>>;
}
```

`MoveNode` no cambia el `kind`: convertir un estante en una persona no tiene
significado, y el `kind` está desnormalizado en `movement.to_node_kind`, así que
cambiarlo desalinearía el histórico — el mismo razonamiento que bloquea el
`trackingMode` en I-15.

Detección de ciclos: el nodo destino no puede ser descendiente del que se mueve. Se
comprueba con el `path` actual, que ya contiene la cadena completa, sin recursión.

### 4.2 Movimientos

```ts
interface RecordMovement {                               // RECORD_MOVEMENT
  execute(ctx, input: {
    id?: MovementId;                    // UUIDv7 del cliente
    productId: ProductId;
    batchId?: BatchId;
    fromNodeId: NodeId;
    toNodeId: NodeId;
    quantity: string;
    occurredAt: Date;
    reason?: string;
    dueAt?: Date;
    settlesId?: MovementId;             // obligatorio si fromNodeId es CUSTODY
    processInstanceId?: ProcessInstanceId;
  }): Promise<{ movement: Movement; balances: StockPosition[] }>;
}

type RecordMovementInput = Parameters<RecordMovement['execute']>[1];
```

**Es la operación central del sistema.** Su secuencia, dentro de la transacción
que el borde ya abrió ([07 §3](07-composicion-y-contexto-de-ejecucion.md)):

```
 1. Resolver producto ─────────── existe, activo
 2. Resolver ambos nodos ──────── existen, activos, misma organización
 3. Validar el lote ───────────── I-8: obligatorio si el modo lo exige,
                                  prohibido si es QUANTITY; pertenece al producto
 4. Resolver settles ──────────── si el origen es CUSTODY: existe, su destino es este
                                  origen, mismo producto y lote (I-17); pendiente ≥ q (I-18)
 5. Construir Movement ────────── I-1, I-2, I-11, I-14, I-17, I-18 en el constructor
 6. INSERT movement ───────────── el id de cliente choca contra la PK si se repite
 7. uow.run(() => ──────────────┐ SAVEPOINT
      UPSERT saldo origen  −q   │ ordenados por clave natural
      UPSERT saldo destino +q   │ el CHECK impone I-4 y revierte solo el savepoint
    )                          ─┘
 8. INSERT outbox_event ───────── stock.moved, y balance_changed si un nodo
                                  custodiable cruza cero
```

Los pasos 6 y 7 se emiten **ordenados por clave natural** `(node_id, product_id,
batch_id)`, no por rol. Dos
transacciones que muevan stock entre los mismos dos nodos en sentidos opuestos se
bloquearían mutuamente si cada una tomara sus filas en su propio orden; con un orden
total común, una espera y la otra avanza.

**La verificación de existencias no es un `SELECT` previo.** Se intenta el upsert y
se deja que el `CHECK` decida. Un `SELECT` seguido de un `INSERT` tiene una ventana
entre ambos en la que otra transacción puede consumir el stock, y el resultado es un
saldo negativo bajo concurrencia — el defecto clásico de este tipo de sistemas. El
constraint no tiene ventana.

**Por eso los upserts van dentro de un `SAVEPOINT`** (el `uow.run()` anidado de
[07 §4](07-composicion-y-contexto-de-ejecucion.md)). Tras una violación de `CHECK`,
Postgres deja la transacción abortada y no admite ni un `SELECT`; sin savepoint,
el caso de uso no podría leer cuánto había para construir `insufficient-stock`
con `available` y `requested`. Con él, revierte solo los upserts, lee el saldo,
construye el error, y la transacción entera se deshace en el borde.

```ts
interface ReverseMovement {                              // REVERSE_MOVEMENT
  execute(ctx, input: { movementId: MovementId; reason: string })
    : Promise<{ reversal: Movement; balances: StockPosition[] }>;
}
```
Precondiciones: el movimiento existe en la organización y **no ha sido compensado
antes** (I-13). El compensador invierte origen y destino y conserva producto, lote y
cantidad (I-12). `reason` es obligatorio: una corrección sin explicación no sirve
para nada a quien audite después.

Una compensación puede dejar un saldo insuficiente —si el stock ya se movió a otro
sitio— y en ese caso falla igual que cualquier movimiento. La salida correcta es
traer el stock de vuelta primero. El sistema no inventa existencias para cuadrar una
corrección.

Y falla también por **I-9**, que es menos evidente: deshacer un despacho es un
asiento que *entra* desde la frontera hacia un nodo custodiable, exactamente igual
que una recepción. Si entre el despacho y la compensación la misma serie volvió a
entrar por otro sitio —cosa legítima: el sistema no puede saber que es la misma
pieza hasta que la ve—, la compensación la pondría en dos estanterías a la vez, y se
rechaza con `serial-already-placed`. La guarda es la misma que usa `RecordMovement`
y la consultan los dos (D-41 del plan 6).

```ts
interface RecordMovementBatch {                          // RECORD_MOVEMENT
  execute(ctx, input: { movements: RecordMovementInput[] })   // máx. 500
    : Promise<{ movements: Movement[]; balances: StockPosition[] }>;
}
```
**Todo o nada, en una transacción.** Es lo que usa la carga de saldo inicial
desde una hoja de cálculo, y lo que usa el `CONFIRM` de [13](13-process.md) —que
en el MVP emite un solo movimiento por instancia, pero pasa por aquí para que el
día que un proceso emita varios no haya que cambiar la puerta.

### 4.3 Consultas

```ts
interface GetStock {                                     // READ
  execute(ctx, query: {
    productId?: ProductId;
    nodeId?: NodeId;
    under?: NodeId;              // agregado por subárbol
    batchId?: BatchId;
    custodialOnly?: boolean;     // excluye SOURCE y TERMINAL
    nonZeroOnly?: boolean;       // por defecto true
  }, page: Cursor): Promise<Page<StockPosition>>;
}

interface GetMovementHistory {                           // READ
  execute(ctx, query: {
    productId?: ProductId;
    nodeId?: NodeId;             // como origen o destino
    batchId?: BatchId;
    actorId?: UserId;
    from?: Date; to?: Date;      // sobre occurredAt
  }, page: Cursor): Promise<Page<Movement>>;
}

interface OpenCustody {
  readonly checkOut: Movement;       // el préstamo
  readonly pending: Quantity;        // cantidad − Σ saldado
  readonly overdue: boolean;         // dueAt < ahora
}

interface GetOpenCustodies {                             // READ
  execute(ctx, query: { nodeId?: NodeId; overdueOnly?: boolean }, page)
    : Promise<Page<OpenCustody>>;
}
```

`custodialOnly` por defecto en `false` pero es lo que los clientes querrán casi
siempre: sin él, la respuesta incluye los totales acumulados de `TERMINAL:venta`,
que no son existencias. El contrato lo expone explícitamente en lugar de decidirlo
por el cliente, porque la consulta sobre fronteras también es legítima —*"¿cuánto he
vendido de esto?"*— y ocultarla obligaría a un endpoint aparte.

`GetOpenCustodies` responde *"¿qué está prestado y no ha vuelto?"* **por préstamo**,
no por saldo: cada check-out con pendiente mayor que cero es una fila, con su
propio `dueAt`. Es la consulta que `settlesId` (I-17) existe para hacer posible;
sobre el saldo agregado del nodo `CUSTODY` no habría forma de decir cuál de dos
préstamos del mismo producto sigue abierto.

## 5. Puertos de salida

```ts
interface NodeRepository {
  findById(orgId, id): Promise<Node | null>;
  findByCode(orgId, code): Promise<Node | null>;
  findManyByIds(orgId, ids: NodeId[]): Promise<Map<NodeId, Node>>;
  listUnder(orgId, path: NodePath): Promise<Node[]>;
  list(orgId, filter, page): Promise<Page<Node>>;
  save(node): Promise<void>;
  updateSubtreePaths(orgId, oldPrefix, newPrefix): Promise<void>;   // N-2
}

interface MovementRepository {
  findById(orgId, id): Promise<Movement | null>;
  existsReversalOf(orgId, id): Promise<boolean>;                    // I-13
  settledQuantity(orgId, checkOutId): Promise<Quantity>;            // Σ settles no compensados, para I-18
  listOpenCustodies(orgId, filter, page): Promise<Page<OpenCustody>>;
  countByProduct(orgId, productId): Promise<number>;                // sirve a C-8
  list(orgId, filter, page): Promise<Page<Movement>>;
  append(movement): Promise<void>;
  appendMany(movements: Movement[]): Promise<void>;
  // Sin update. Sin delete. Deliberadamente.
}

interface BalanceDelta {
  readonly nodeId: NodeId;
  readonly productId: ProductId;
  readonly batchId?: BatchId;
  readonly nodeKind: NodeKind;
  readonly delta: Quantity;      // con signo: negativo en el origen
}

interface StockBalanceRepository {
  find(orgId, nodeId, productId, batchId?): Promise<StockPosition | null>;
  query(orgId, filter, page): Promise<Page<StockPosition>>;
  sumUnder(orgId, path, productId?): Promise<StockPosition[]>;
  hasAnyStock(orgId, { productId?, nodeId? }): Promise<boolean>;    // C-9, N-3
  applyDelta(deltas: BalanceDelta[]): Promise<StockPosition[]>;     // upserts ordenados
}

interface Clock       { now(): Date; }
interface IdGenerator { next(): string; }   // UUIDv7
interface EventPublisher { publish(events: DomainEvent[]): Promise<void>; }
```

**`MovementRepository` no expone actualización ni borrado.** No es un descuido: es la
invariante I-3 expresada en el tipo. Un programador que quiera modificar un
movimiento no encuentra el método, y ese es el momento en que lee este documento y
entiende que debe compensar.

`applyDelta` recibe todos los cambios de saldo de una transacción y los aplica en
orden de clave natural `(node_id, product_id, batch_id)`. Que el orden sea responsabilidad del repositorio y no de
quien lo llama es lo que hace que ningún caso de uso pueda provocar un interbloqueo
por descuido.

## 6. Persistencia

Tablas `node`, `movement`, `stock_balance`, definidas en
[04 §3.3, §3.4, §3.5](04-persistencia.md).

Puntos de este módulo que conviene no perder de vista al implementarlo:

- `stock_balance` usa `NULLS NOT DISTINCT` en el índice único de su clave
  natural, escrito a mano en la migración ([04 §5.1](04-persistencia.md)). Sin eso, cada
  movimiento de un producto `QUANTITY` crea una fila de saldo nueva en lugar de
  actualizar la existente, y el saldo deja de existir como concepto.
- Las columnas `tracking_mode`, `from_node_kind` y `to_node_kind` de `movement`
  son copias, no la fuente de verdad. Se rellenan al construir el movimiento y su
  única razón de ser es hacer cumplibles los `CHECK` de I-8, I-11 e I-17.
- El rol de aplicación tiene `UPDATE` y `DELETE` revocados sobre `movement`. Es la
  tercera capa de I-3, y hay una prueba que comprueba que el revoke sigue puesto.

## 7. Endpoints

### Nodos

| Método | Ruta | Acción |
|---|---|---|
| `GET` | `/v1/nodes` | `READ` — filtros `kind`, `active`, `under` |
| `POST` | `/v1/nodes` | `MANAGE_NODES` |
| `GET` | `/v1/nodes/{id}` | `READ` |
| `PATCH` | `/v1/nodes/{id}` | `MANAGE_NODES` — `If-Match` |
| `POST` | `/v1/nodes/{id}/move` | `MANAGE_NODES` — nuevo `parentId` |
| `DELETE` | `/v1/nodes/{id}` | `MANAGE_NODES` — desactiva |
| `GET` | `/v1/nodes/{id}/tree` | `READ` — subárbol completo |

### Movimientos

| Método | Ruta | Acción |
|---|---|---|
| `POST` | `/v1/movements` | `RECORD_MOVEMENT` — `Idempotency-Key` |
| `POST` | `/v1/movements/batch` | `RECORD_MOVEMENT` — `Idempotency-Key` |
| `GET` | `/v1/movements` | `READ` — filtros de `GetMovementHistory` |
| `GET` | `/v1/movements/{id}` | `READ` |
| `POST` | `/v1/movements/{id}/reverse` | `REVERSE_MOVEMENT` — `Idempotency-Key` |

No hay `PUT`, `PATCH` ni `DELETE` sobre movimientos. La ausencia es el contrato.

### Existencias

| Método | Ruta | Acción |
|---|---|---|
| `GET` | `/v1/stock` | `READ` — filtros de `GetStock` |
| `GET` | `/v1/stock/custodies` | `READ` — préstamos con pendiente > 0, con `overdueOnly` |

## 8. Eventos emitidos

| Tipo | Cuándo |
|---|---|
| `stock.moved` | Cada movimiento registrado |
| `stock.reversed` | Cada compensación |
| `stock.balance_changed` | Un saldo **en nodo custodiable** cruza cero, en cualquier dirección |
| `custody.checked_out` | El destino es un nodo `CUSTODY` |
| `custody.checked_in` | El origen es un nodo `CUSTODY`; la carga incluye `settlesId` y el pendiente restante |
| `node.created` · `node.updated` · `node.moved` · `node.deactivated` | |

Todos con la forma de [05 §5](05-eventos-e-integraciones.md), escritos en la misma
transacción que el hecho que describen.

## 9. Errores

| `type` | Estado | Cuándo |
|---|---|---|
| `insufficient-stock` | 422 | I-4; detalle con disponible y solicitado |
| `same-node` | 422 | I-1 |
| `non-positive-quantity` | 422 | I-2 |
| `batch-required` | 422 | I-8, producto `LOT` o `SERIAL` sin lote |
| `batch-not-allowed` | 422 | I-8, producto `QUANTITY` con lote |
| `batch-product-mismatch` | 422 | El lote no pertenece al producto |
| `due-date-not-allowed` | 422 | I-11, `dueAt` con destino no `CUSTODY` |
| `future-occurrence` | 422 | I-14, más de 5 minutos por delante |
| `node-inactive` | 422 | I-16 |
| `already-reversed` | 409 | I-13 |
| `settles-required` | 422 | I-17, origen `CUSTODY` sin `settlesId` |
| `settles-mismatch` | 422 | I-17, el check-out referenciado no va a este origen, o cambia producto o lote |
| `settles-exceeded` | 422 | I-18; el detalle indica el pendiente real |
| `node-has-stock` | 422 | N-3; detalle con las posiciones |
| `node-cycle` | 422 | El destino es descendiente del nodo movido |
| `parent-not-internal` | 422 | I-10 |
| `node-code-taken` | 409 | |
| `batch-too-large` | 422 | Más de 500 movimientos en un lote |

`insufficient-stock` es el error más frecuente de la operación diaria. Su `detail`
nombra el nodo por su `path` legible —no por su UUID— e incluye disponible y
solicitado, porque de ahí sale directamente el mensaje que ve el operario.

## 10. Pruebas

**Dominio (100 % líneas y ramas)** — la aritmética completa de `Quantity`, con
énfasis en que no haya deriva al acumular; `Movement.create` rechazando cada
invariante por separado —I-17 e I-18 incluidas—, con una prueba nombrada por su
número; `reverse()` produciendo el inverso exacto; `isDescendantOf` sobre `path`.

**Aplicación** — `RecordMovement` con repositorios en memoria, cubriendo cada
precondición; `ReverseMovement` sobre un movimiento ya compensado; `MoveNode`
detectando ciclos a tres niveles de profundidad; **N-3**, desactivación rechazada
sobre un nodo con saldo.

**Integración** — **N-1** y **N-2**: reasignar el padre de un nodo intermedio
recalcula su `path` y el de todo su subárbol en la misma transacción. Cada `CHECK`
del esquema con un caso que lo viola; el saldo negativo abortando la transacción
entera y no dejando el movimiento insertado;
`UPDATE` y `DELETE` sobre `movement` fallando por permisos con ambos roles; el
`SAVEPOINT` de `applyDelta` dejando la transacción usable tras un fallo de I-4, y
`insufficient-stock` saliendo con `available` correcto; dos transacciones moviendo
entre los mismos nodos en sentidos opuestos sin interbloqueo. (La concurrencia
sobre la clave de idempotencia se prueba en el borde: [07 §5](07-composicion-y-contexto-de-ejecucion.md).)

**Invariantes (propiedades)** — conservación tras cualquier secuencia válida;
reconciliación de `stock_balance` contra la suma del ledger (I-5); un producto
`SERIAL` nunca en dos nodos custodiables a la vez (I-9); el pendiente de todo
check-out entre cero y su cantidad tras cualquier secuencia de check-ins (I-18).

**e2e** — los criterios de éxito 2 a 8 de [00](00-vision-y-alcance.md): árbol de tres
niveles, recepción localizada, traslado que cuadra, préstamo con fecha, despacho que
reduce el inventario propio, y corrección por compensación con ambos asientos
visibles en el histórico.

## 11. Ganchos de extensión

| Extensión | Qué ya lo permite | Qué falta |
|---|---|---|
| **Reservas** (para picking) | `stock_balance` es la tabla natural donde vive | Columna `reserved` y `CHECK (quantity >= reserved)`. **El ledger no cambia.** |
| **Conteo cíclico** | La diferencia de un conteo es un ajuste, y el ajuste ya existe | Entidad de tarea de conteo en un módulo aparte |
| **Costeo** | El movimiento ya tiene la granularidad necesaria | Columnas de costo y un saldo valorizado paralelo |
| **Traslados en tránsito** | Un nodo `INTERNAL` llamado "en tránsito" lo resuelve sin código nuevo | Nada, si basta con eso; una entidad de envío si se quiere seguimiento |
| **Devoluciones de cliente** | `SOURCE:devolucion-cliente` y ya está | Nada |
| **Offline-first** | Id de cliente, idempotencia, append-only, dos relojes | Réplica local y protocolo de sincronización, del lado del cliente |
| **Particionado del ledger** | Los índices ya empiezan por `org_id` | Partición por rango de `occurred_at`, cuando las métricas lo pidan |

Que **reservas** entre sin tocar el ledger es la prueba de que la frontera del módulo
está bien puesta: una reserva no es un movimiento —la mercancía no se ha ido a
ninguna parte— sino una anotación sobre un saldo. Modelarla como movimiento a un nodo
"reservado" habría sido el error tentador, y habría inflado el histórico con asientos
que no describen ningún hecho físico.

## 12. Documentos relacionados

- [02 — Modelo de dominio](02-modelo-de-dominio.md) — la fuente de las invariantes
- [04 §3.3-3.5, §7](04-persistencia.md) · [05](05-eventos-e-integraciones.md) · [07](07-composicion-y-contexto-de-ejecucion.md) · [13](13-process.md) · [90](90-extensiones-previstas.md)
