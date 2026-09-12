# 13 — Process

> `libs/process` · El motor de flujos operativos: plantillas versionadas, instancias
> en curso y los manejadores de paso.
>
> Es el módulo que convierte *"escanear, contar, ubicar y confirmar"* en una
> recepción, sin que la palabra "recepción" aparezca en ningún sitio del código.

## 1. Propósito y frontera

Ejecuta procesos operativos definidos como **secuencias de pasos tipados**. Un
proceso acumula intención mientras avanza y, al confirmarse, produce efectos —el
principal, movimientos en el ledger.

Queda fuera: el significado de negocio de cada proceso. El motor no sabe qué es una
recepción; sabe ejecutar la plantilla `RECEPCION`, que es una lista de pasos como
cualquier otra.

**El límite crítico:** el motor **no escribe en la base de datos por sí mismo, salvo
su propio estado**. Los manejadores devuelven efectos; el motor los aplica llamando a
los casos de uso de [12](12-inventory.md). Si el motor supiera insertar movimientos,
las reglas del ledger acabarían duplicadas en dos sitios y divergirían.

## 2. Entidades y tipos del dominio

```ts
// `ProcessInstanceId` vive en `libs/common` porque `inventory` lo referencia
// (`Movement.processInstanceId`, [01 §4](01-arquitectura.md)). Los otros dos no
// los nombra nadie fuera de este módulo, así que viven en `libs/process`.
type ProcessInstanceId = Branded<string, 'ProcessInstanceId'>;   // @app/common
type StepId            = Branded<string, 'StepId'>;              // libs/process
type TemplateCode      = Branded<string, 'TemplateCode'>;        // libs/process — RECEPCION, ...

enum StepType {
  SCAN_ITEM, CAPTURE_BATCH, CAPTURE_QTY, CAPTURE_PHOTO, SELECT_NODE,
  SET_DUE_DATE, CAPTURE_REASON, CONFIRM,
}

/** Lo que un manejador acepta. Cada tipo de paso refina esta unión — ver §5. */
type StepPayload =
  | { readonly code: string }                       // SCAN_ITEM
  | { readonly lotCode?: string; readonly serial?: string;
      readonly expiresAt?: Date }                   // CAPTURE_BATCH
  | { readonly quantity: string }                   // CAPTURE_QTY
  | { readonly storageKeys: readonly StorageKey[] } // CAPTURE_PHOTO
  | { readonly nodeId: NodeId }                     // SELECT_NODE
  | { readonly dueAt: Date }                        // SET_DUE_DATE
  | { readonly reason: string }                     // CAPTURE_REASON
  | Record<string, never>;                          // CONFIRM

/** Configuración de un paso dentro de una plantilla. La interpreta su manejador. */
type StepConfig = Record<string, unknown>;

// ─── Plantilla ─────────────────────────────────────────────────────────────
class ProcessTemplate {
  readonly id; readonly orgId;
  readonly code: TemplateCode;        // RECEPCION, TRASLADO, ...
  readonly version: number;
  readonly steps: readonly StepDefinition[];
  readonly active: boolean;

  firstStep(): StepDefinition;
  step(id: StepId): StepDefinition | null;
  transitionsFrom(id: StepId): readonly Transition[];
}

interface StepDefinition {
  readonly id: StepId;                // "scan", "qty", "bin", "confirm"
  readonly type: StepType;
  readonly required: boolean;
  readonly config: Record<string, unknown>;
  readonly transitions: readonly Transition[];
}

interface Transition {
  readonly to: StepId | null;         // null = fin del proceso
  // El día del workflow aparece aquí `when?: Condition`, donde Condition será un
  // lenguaje cerrado de comparaciones sobre el contexto — ver [90 §4]. Hoy no
  // existe, y la invariante P-8 obliga a que la lista tenga un solo elemento.
}
```

### Las tres decisiones que abren la puerta al workflow

Ninguna cuesta código hoy. Las tres serían carísimas de introducir después.

**1 · Los pasos se direccionan por `id`, no por índice.** Un `order: 1, 2, 3` no
tiene dónde apuntar una rama; un `id` sí. Además, reordenar una plantilla con
índices renumera los pasos y rompe el historial de instancias en curso.

**2 · Las transiciones son una lista, no un campo `next`.** Una rama es
simplemente un paso con más de una transición. El esquema ya lo admite; el
validador del MVP rechaza `transitions.length > 1` con un mensaje explícito. **Pasar
al workflow es retirar esa comprobación, no rediseñar el modelo.**

**3 · La plantilla se versiona y la instancia guarda su versión.** Una recepción de
marzo se audita con las reglas de marzo, aunque la plantilla haya cambiado tres
veces. Sin esto, editar una plantilla reescribiría retroactivamente el significado de
todo lo ya ejecutado.

```ts
// ─── Instancia ─────────────────────────────────────────────────────────────
enum ProcessState { OPEN, COMPLETED, CANCELLED }

class ProcessInstance {
  readonly id: ProcessInstanceId;
  readonly orgId: OrgId;
  readonly templateCode: TemplateCode;
  readonly templateVersion: number;    // snapshot
  readonly state: ProcessState;
  readonly currentStepId?: StepId;
  readonly context: ProcessContext;
  readonly actorId: UserId;
  readonly version: number;

  isOpen(): boolean;
  canComplete(stepId: StepId): boolean;
}

class ProcessContext {
  readonly values: ReadonlyMap<StepId, StepPayload>;
  readonly draft: MovementDraft;             // intención acumulada — una, ver §3
  readonly storageKeys: readonly StorageKey[];   // lo que dejó CAPTURE_PHOTO

  with(stepId: StepId, payload: StepPayload): ProcessContext;
  withDraft(patch: Partial<MovementDraft>): ProcessContext;   // funde, no añade
  withStorageKeys(keys: readonly StorageKey[]): ProcessContext;
}

interface MovementDraft {
  productId?; batchId?; fromNodeId?; toNodeId?;
  quantity?: Quantity; reason?: string; dueAt?: Date;
  newBatch?: BatchDraft;               // lote que aún no existe; CONFIRM lo crea antes de mover
}

interface BatchDraft {
  productId; lotCode?: string; serial?: string; expiresAt?: Date;
}
```

**El borrador es uno y `withDraft` funde.** §3 dice que una instancia produce a lo
sumo un movimiento, así que un array con un `withDraft` en singular no dejaba claro
si añadía o reemplazaba. Cada paso aporta su campo —el escaneo el producto, la
cantidad la cantidad, la ubicación el destino— sobre el mismo borrador. El día de la
instancia multi-línea ([90 §12](90-extensiones-previstas.md)) esto vuelve a ser una
lista, y `CONFIRM` ya emite una lista de borradores.

**`occurredAt` no está en el borrador.** Lo pone el aplicador de efectos con el
puerto `Clock` al construir el `RecordMovementInput`, que sí lo exige: la hora del
asiento es el instante en que se confirma, no uno que el motor arrastre desde que se
abrió la instancia — y una instancia puede estar abierta desde ayer.

**Las claves de foto no van en el borrador**, van en su propio campo del contexto:
no son parte del movimiento, alimentan un efecto distinto (`ATTACH_MEDIA`) y sobre
un producto, no sobre una posición.

`MovementDraft` tiene todos los campos opcionales porque se rellena a lo largo del
proceso: el paso de escaneo pone el producto, el de cantidad la cantidad, el de
ubicación el destino. Solo en `CONFIRM` se comprueba que esté completo y se convierte
en un `Movement` real. Esa conversión es el único punto donde el motor toca el
inventario.

```ts
// ─── Completado de paso ────────────────────────────────────────────────────
class StepCompletion {          // append-only, igual que un movimiento
  readonly id; readonly orgId;
  readonly instanceId: ProcessInstanceId;
  readonly stepId: StepId;
  readonly actorId: UserId;
  readonly payload: StepPayload;
  readonly completedAt: Date;
}
```

## 3. Invariantes

| # | Invariante | Mecanismo |
|---|---|---|
| **P-1** | Una instancia referencia una versión de plantilla que existió | Clave foránea compuesta a `(org_id, code, version)` |
| **P-2** | Solo se puede completar el paso actual | Validación de dominio en `advance()` |
| **P-3** | Un paso se completa una sola vez por instancia | `UNIQUE (org_id, instance_id, step_id)` |
| **P-4** | Una instancia cerrada no admite cambios | Validación de dominio; `state != OPEN` rechaza |
| **P-5** | Un paso `required` no se puede omitir | Validación de dominio en `advance()` |
| **P-6** | Los efectos se aplican solo al completar el proceso | El motor solo materializa el borrador en `CONFIRM` |
| **P-7** | Completar un proceso es atómico | Una transacción para pasos, efectos, estado y eventos |
| **P-8** | En el MVP, todo paso tiene exactamente una transición | Validador de plantilla; se retira al llegar el workflow |
| **P-9** | Una plantilla con instancias no se modifica; se versiona | Caso de uso; crea versión nueva |

**P-6** es la que da la propiedad más visible para el usuario: *una recepción a
medias no ensucia el inventario*. El operario puede escanear, irse a comer y
volver, y hasta que no confirme, el stock no se ha movido.

**P-7** es su complemento: al confirmar, o entra todo lo que el proceso produjo
—movimiento, lote nuevo, fotos— o no entra nada. Se apoya en
`RecordMovementBatch` de [12 §4.2](12-inventory.md).

### Una línea por instancia

En el MVP **una instancia produce a lo sumo un movimiento**: un producto, un
lote, una cantidad, un origen y un destino. Recibir veinte productos son veinte
instancias de `RECEPCION`.

No es una limitación accidental: con transiciones lineales (P-8) y un solo
completado por paso (P-3), no hay forma de volver a `item`, y fingir lo
contrario en la narrativa habría llevado a implementar un bucle que el modelo no
admite. La repetición de pasos es una extensión con su propio diseño
([90 §12](90-extensiones-previstas.md)); cuando llegue, `CONFIRM` ya emite una
lista de borradores y `RecordMovementBatch` ya la recibe, así que la puerta
está abierta por el lado del inventario.

## 4. El motor

### 4.1 El runner

```ts
interface ProcessRunner {
  start(template: ProcessTemplate, actorId: UserId): ProcessInstance;
  advance(instance: ProcessInstance, template: ProcessTemplate,
          stepId: StepId, payload: StepPayload): Result<AdvanceOutcome>;
}

interface AdvanceOutcome {
  readonly instance: ProcessInstance;
  readonly effects: readonly Effect[];   // no vacío solo al completar
}

class LinearRunner implements ProcessRunner {
  // La única transición del paso actual decide el siguiente.
  // to === null → el proceso queda COMPLETED.
}
```

`GraphRunner` —el que evaluará condiciones para elegir entre varias transiciones—
implementará esta misma interfaz, leerá las mismas tablas y producirá los mismos
efectos. **Cambiar de motor será registrar otra implementación en el módulo raíz.**
Ni el dominio, ni el esquema, ni los manejadores se enteran.

### 4.2 Manejadores de paso

```ts
interface StepHandler<P extends StepPayload = StepPayload> {
  readonly type: StepType;

  parse(raw: unknown, config: StepConfig): Result<P>;
  validate(payload: P, ctx: ProcessContext, deps: HandlerDeps,
           config: StepConfig): Promise<Result<P>>;
  apply(payload: P, ctx: ProcessContext, config: StepConfig): ProcessContext;
}

/**
 * Solo lectura, y construido por `application/` a partir de los repositorios de
 * `catalog` e `inventory` — no hay puertos puente (ver §8).
 */
interface HandlerDeps {
  readonly resolveCode:      (orgId, raw: string) => Promise<ResolvedCode | null>;
  readonly findNode:         (orgId, id: NodeId) => Promise<Node | null>;
  readonly findNodeByCode:   (orgId, code: string) => Promise<Node | null>;
  readonly findProduct:      (orgId, id: ProductId) => Promise<Product | null>;
  readonly findBatchByLot:   (orgId, productId: ProductId, lotCode: string) => Promise<Batch | null>;
  readonly findBatchBySerial:(orgId, serial: string) => Promise<Batch | null>;
  readonly clock:            Clock;
}
```

**Las tres firmas reciben el `config` del paso**, y no solo `parse`. `SELECT_NODE`
lee `config.allowedKinds` al validar y `config.role` al aplicar, para saber si el
nodo va al lado origen o al destino; `CONFIRM` resuelve `config.defaults.fromNodeCode`
al validar. Sin el `config` ahí, los tres manejadores que dependen de él no podrían
hacer su trabajo, y §5 lo da por hecho.

**`HandlerDeps` lleva seis lecturas y un reloj**, no tres lecturas. `CAPTURE_BATCH`
tiene que decidir entre un lote que existe y uno por crear, y eso son dos búsquedas
—por `(producto, lotCode)` y por `serial`—; `CONFIRM` resuelve sus `defaults` por
**código** de nodo y no por id; y `SET_DUE_DATE` valida «futura», que es una pregunta
sobre el ahora y por tanto sobre el puerto `Clock`
([06 §4](06-pruebas-y-calidad.md): ninguna regla llama a `new Date()`).

Tres reglas que definen el motor entero:

- **Un manejador nunca escribe.** `apply` devuelve un `ProcessContext` nuevo; no
  toca la base de datos. Sus dependencias son de solo lectura por tipo.
- **Un manejador no conoce a los demás.** Se comunican a través del contexto.
- **Los manejadores viven en un registro, no en un `switch`.**

```ts
class StepHandlerRegistry {
  register(handler: StepHandler): void;
  get(type: StepType): StepHandler | null;
}
```

Añadir `INSPECCION_CALIDAD` es escribir una clase y registrarla. **El motor no se
edita nunca** — ni al añadir un paso, ni al añadir un proceso, ni al pasar a
workflow. Es la propiedad que este módulo existe para garantizar.

### Omitir un paso opcional

Un paso con `required: false` se omite completándolo con payload `null`. El
motor registra el `step_completion` con `payload: null`, **no invoca al
manejador**, y avanza. Un paso `required: true` con payload `null` es
`required-step-skipped` (P-5). Así el cliente genérico tiene una sola forma de
avanzar —completar el paso actual— y no necesita un endpoint de "saltar".

Un manejador puede, además, **exigir que se le omita o que no se le omita**
según el contexto: `CAPTURE_BATCH` rechaza un payload no nulo si el producto es
`QUANTITY`, y rechaza el `null` si es `LOT` o `SERIAL` y el escaneo no aportó
lote. El paso es opcional en la plantilla porque la plantilla no sabe qué
producto va a pasar por ella; el manejador sí.

### 4.3 Efectos

```ts
type Effect =
  | { kind: 'CREATE_BATCH';   draft: BatchDraft; feeds: number }
  | { kind: 'EMIT_MOVEMENTS'; drafts: readonly MovementDraft[] }
  | { kind: 'ATTACH_MEDIA';   productId: ProductId; storageKeys: readonly StorageKey[] };
```

El motor produce efectos; **el aplicador de efectos** —en `application/`— los ejecuta
llamando a los casos de uso de los otros módulos, todo dentro de la transacción de la
petición, **en este orden**: `CREATE_BATCH` primero (el movimiento necesita el
`batchId`), `EMIT_MOVEMENTS` después, `ATTACH_MEDIA` al final.

**`feeds` dice a qué borrador alimenta el lote nuevo**: es el índice dentro de
`EMIT_MOVEMENTS.drafts`, y el aplicador escribe el `id` del `Batch` recién creado en
el `batchId` de ese borrador antes de emitir nada. Sin ese enlace el orden de los dos
efectos no sirve de nada —el `batchId` no tendría dónde aterrizar—. Hoy siempre vale
`0`, porque la instancia produce una línea (§3); el día multi-línea el campo ya está
y el aplicador no cambia.

Los tres efectos los aplican los casos de uso públicos de los otros módulos, con sus
invariantes intactas: `CreateBatch` de [11 §4](11-catalog.md), `RecordMovementBatch`
de [12 §4.2](12-inventory.md) y `AttachMedia` de [11 §4](11-catalog.md) **en su forma
de `storageKeys`**, que es la que exige `RECORD_MOVEMENT` y no `MANAGE_CATALOG`: quien
confirma una recepción es el operario, y esa es exactamente la regla que lo permite.

No hay efecto de alerta. Las alertas se levantan por reconciliación
([14 §4](14-alerts.md)): una que un proceso insertara sin que la respalde una de
las consultas del evaluador sería resuelta en la pasada siguiente. Y `process`
no depende de `alerts` ([01 §5](01-arquitectura.md)); un efecto que
transportara un tipo de `alerts` sería un ciclo.

Esta indirección es la que hace que el motor sea probable sin base de datos: se le da
una plantilla y una secuencia de payloads, y se comprueba qué efectos produce. Sin
Postgres, sin HTTP, sin contenedor. Es la mitad de la cobertura del 100 % que
[06 §9](06-pruebas-y-calidad.md) exige a este módulo.

## 5. Los ocho manejadores del MVP

| Tipo | Payload | Valida | Aporta al contexto |
|---|---|---|---|
| `SCAN_ITEM` | `{ code }` | El código resuelve a producto activo | `productId`, `batchId` si el código era una serie existente |
| `CAPTURE_BATCH` | `{ lotCode?, serial?, expiresAt? }` o `null` | Según `trackingMode` del producto en contexto — ver abajo | `batchId` si el lote existe; `newBatch` si no |
| `CAPTURE_QTY` | `{ quantity }` | Positiva; entera si la unidad no admite decimales (`UNIT`, `BOX`, `PACK`) | `quantity` |
| `CAPTURE_PHOTO` | `{ storageKeys[] }` | Entre 1 y 5 imágenes, todas en la zona de espera y sin reclamar | `storageKeys` (el efecto lo emite `CONFIRM`) |
| `SELECT_NODE` | `{ nodeId }` | Existe, activo, y del `kind` que exija `config.allowedKinds` | `fromNodeId` o `toNodeId`, según `config.role` |
| `SET_DUE_DATE` | `{ dueAt }` | Futura; el destino es `CUSTODY` | `dueAt` |
| `CAPTURE_REASON` | `{ reason }` | Entre 3 y 500 caracteres | `reason` |
| `CONFIRM` | `{}` | El borrador está completo y es coherente | Los efectos de §4.3; cierra la instancia |

**Ningún manejador produce efectos, ni siquiera `CAPTURE_PHOTO`.** `apply` devuelve
un `ProcessContext`, y su firma no tiene por dónde devolver otra cosa; y P-6 dice que
los efectos se aplican **solo al completar**. Las claves de foto se acumulan en
`ProcessContext.storageKeys` y es `CONFIRM` quien, al cerrar, emite los tres efectos
que correspondan: `CREATE_BATCH` si el borrador trae `newBatch`, `EMIT_MOVEMENTS`
siempre, y `ATTACH_MEDIA` si hay claves. Un proceso abandonado a mitad no adjunta
nada — que es la mitad no evidente de P-6: no ensucia el inventario **ni el catálogo**.

`SELECT_NODE` es un solo manejador parametrizado y no dos —origen y destino— porque
la lógica de validar un nodo es idéntica; lo que cambia es dónde deja el resultado.
Su `config` lo dice:

```jsonc
{ "role": "TO", "allowedKinds": ["INTERNAL"] }
```

Es el patrón que evita la proliferación de manejadores casi iguales, y el que hace
que las seis plantillas se armen con ocho piezas.

### `CAPTURE_BATCH`

Existe porque el usuario objetivo maneja perecederos y herramienta, y **un lote
nuevo no existe antes de la recepción que lo trae**. `SCAN_ITEM` solo puede
resolver lo que ya está en el catálogo; el lote de leche que llegó hoy, o el
taladro con serie que se compró ayer, no están. Sin este paso, `CONFIRM` llegaría
sin `batchId` para un producto `LOT` y `Movement.create` fallaría I-8: las
plantillas de fábrica no servirían para la mitad del catálogo que el producto
dice atender.

| `trackingMode` del producto | Payload `null` | Payload con datos |
|---|---|---|
| `QUANTITY` | Correcto: se omite | `batch-step-not-allowed` |
| `LOT` | `batch-step-required`, salvo que `SCAN_ITEM` ya aportara lote | `lotCode` obligatorio; si existe para ese producto → `batchId`; si no → `newBatch` con `expiresAt` opcional |
| `SERIAL` | `batch-step-required`, salvo que `SCAN_ITEM` ya aportara lote | `serial` obligatorio; si existe → `batchId` (I-9 se comprueba al confirmar); si no → `newBatch` |

Un `newBatch` en el borrador se convierte en efecto `CREATE_BATCH` al confirmar,
y el lote se crea **en la misma transacción** que el movimiento que lo usa: no
existe estado en el que haya un lote sin su recepción ni una recepción sin su
lote. Crear el lote exige la acción `CREATE_BATCH` ([10 §2](10-tenancy.md)), que
el `OPERATOR` tiene.

### `CONFIRM` con lados fijos

`CONFIRM` admite en su `config` un lado fijo, resuelto por código de nodo al
validar:

```jsonc
{ "defaults": { "fromNodeCode": "adjustment-in" } }
```

Es lo que permite que un ajuste positivo no pida al operario que "elija" el
nodo `SOURCE:adjustment-in`, que es el único posible. Cualquier lado que el
borrador ya traiga tiene prioridad sobre el `default`.

El código se resuelve con `findNodeByCode` de `HandlerDeps` (§4.2) y no con una lista
de uuids: los ocho nodos de frontera los siembra `SeedBoundaryNodes` por `code`
([04 §6](04-persistencia.md)), y son distintos en cada organización. Un `default` que
nombrara un id sería una plantilla de fábrica que solo vale para una empresa.

## 6. Las seis plantillas de fábrica

Se siembran al crear una organización, en versión 1.

```jsonc
// RECEPCION — de un proveedor a una ubicación interna
{ "code": "RECEPCION", "version": 1, "steps": [
  { "id": "origen",  "type": "SELECT_NODE",   "required": true,
    "config": { "role": "FROM", "allowedKinds": ["SOURCE"] },
    "transitions": [{ "to": "item" }] },
  { "id": "item",    "type": "SCAN_ITEM",     "required": true,
    "transitions": [{ "to": "lote" }] },
  { "id": "lote",    "type": "CAPTURE_BATCH", "required": false,
    "transitions": [{ "to": "cantidad" }] },
  { "id": "cantidad","type": "CAPTURE_QTY",   "required": true,
    "transitions": [{ "to": "foto" }] },
  { "id": "foto",    "type": "CAPTURE_PHOTO", "required": false,
    "transitions": [{ "to": "destino" }] },
  { "id": "destino", "type": "SELECT_NODE",   "required": true,
    "config": { "role": "TO", "allowedKinds": ["INTERNAL"] },
    "transitions": [{ "to": "confirmar" }] },
  { "id": "confirmar","type": "CONFIRM",      "required": true,
    "transitions": [{ "to": null }] }
]}
```

```
TRASLADO        origen(INTERNAL) → item → lote → cantidad → destino(INTERNAL) → confirmar
SALIDA          origen(INTERNAL) → item → lote → cantidad → destino(TERMINAL) → confirmar
AJUSTE_ENTRADA  item → lote → cantidad → motivo → destino(INTERNAL)
                                       → confirmar { defaults: { fromNodeCode: "adjustment-in" } }
AJUSTE_SALIDA   origen(INTERNAL) → item → lote → cantidad → motivo
                                       → confirmar { defaults: { toNodeCode: "adjustment-out" } }
CUSTODIA        origen(INTERNAL) → item → lote → cantidad → tenedor(CUSTODY)
                                       → vencimiento → confirmar
```

Las cinco, escritas: son la constante `FACTORY_TEMPLATES` del dominio, y el esquema
de arriba no basta para sembrarlas —no dice ni un `id` de paso, ni un `required`, ni
una transición—. **Solo `RECEPCION` lleva el paso `foto`**; es la única operación en
la que hay algo que fotografiar que el catálogo no tenga ya.

```jsonc
// TRASLADO — de una ubicación interna a otra
{ "code": "TRASLADO", "version": 1, "steps": [
  { "id": "origen",   "type": "SELECT_NODE",   "required": true,
    "config": { "role": "FROM", "allowedKinds": ["INTERNAL"] },
    "transitions": [{ "to": "item" }] },
  { "id": "item",     "type": "SCAN_ITEM",     "required": true,
    "transitions": [{ "to": "lote" }] },
  { "id": "lote",     "type": "CAPTURE_BATCH", "required": false,
    "transitions": [{ "to": "cantidad" }] },
  { "id": "cantidad", "type": "CAPTURE_QTY",   "required": true,
    "transitions": [{ "to": "destino" }] },
  { "id": "destino",  "type": "SELECT_NODE",   "required": true,
    "config": { "role": "TO", "allowedKinds": ["INTERNAL"] },
    "transitions": [{ "to": "confirmar" }] },
  { "id": "confirmar","type": "CONFIRM",       "required": true,
    "transitions": [{ "to": null }] }
]}

// SALIDA — venta, consumo o devolución al proveedor
{ "code": "SALIDA", "version": 1, "steps": [
  { "id": "origen",   "type": "SELECT_NODE",   "required": true,
    "config": { "role": "FROM", "allowedKinds": ["INTERNAL"] },
    "transitions": [{ "to": "item" }] },
  { "id": "item",     "type": "SCAN_ITEM",     "required": true,
    "transitions": [{ "to": "lote" }] },
  { "id": "lote",     "type": "CAPTURE_BATCH", "required": false,
    "transitions": [{ "to": "cantidad" }] },
  { "id": "cantidad", "type": "CAPTURE_QTY",   "required": true,
    "transitions": [{ "to": "destino" }] },
  { "id": "destino",  "type": "SELECT_NODE",   "required": true,
    "config": { "role": "TO", "allowedKinds": ["TERMINAL"] },
    "transitions": [{ "to": "confirmar" }] },
  { "id": "confirmar","type": "CONFIRM",       "required": true,
    "transitions": [{ "to": null }] }
]}

// AJUSTE_ENTRADA — aparece stock que no estaba contado. Sin paso `origen`: lo fija CONFIRM
{ "code": "AJUSTE_ENTRADA", "version": 1, "steps": [
  { "id": "item",     "type": "SCAN_ITEM",     "required": true,
    "transitions": [{ "to": "lote" }] },
  { "id": "lote",     "type": "CAPTURE_BATCH", "required": false,
    "transitions": [{ "to": "cantidad" }] },
  { "id": "cantidad", "type": "CAPTURE_QTY",   "required": true,
    "transitions": [{ "to": "motivo" }] },
  { "id": "motivo",   "type": "CAPTURE_REASON","required": true,
    "transitions": [{ "to": "destino" }] },
  { "id": "destino",  "type": "SELECT_NODE",   "required": true,
    "config": { "role": "TO", "allowedKinds": ["INTERNAL"] },
    "transitions": [{ "to": "confirmar" }] },
  { "id": "confirmar","type": "CONFIRM",       "required": true,
    "config": { "defaults": { "fromNodeCode": "adjustment-in" } },
    "transitions": [{ "to": null }] }
]}

// AJUSTE_SALIDA — falta stock que estaba contado. Sin paso `destino`: lo fija CONFIRM
{ "code": "AJUSTE_SALIDA", "version": 1, "steps": [
  { "id": "origen",   "type": "SELECT_NODE",   "required": true,
    "config": { "role": "FROM", "allowedKinds": ["INTERNAL"] },
    "transitions": [{ "to": "item" }] },
  { "id": "item",     "type": "SCAN_ITEM",     "required": true,
    "transitions": [{ "to": "lote" }] },
  { "id": "lote",     "type": "CAPTURE_BATCH", "required": false,
    "transitions": [{ "to": "cantidad" }] },
  { "id": "cantidad", "type": "CAPTURE_QTY",   "required": true,
    "transitions": [{ "to": "motivo" }] },
  { "id": "motivo",   "type": "CAPTURE_REASON","required": true,
    "transitions": [{ "to": "confirmar" }] },
  { "id": "confirmar","type": "CONFIRM",       "required": true,
    "config": { "defaults": { "toNodeCode": "adjustment-out" } },
    "transitions": [{ "to": null }] }
]}

// CUSTODIA — préstamo a un tenedor, con fecha de devolución
{ "code": "CUSTODIA", "version": 1, "steps": [
  { "id": "origen",      "type": "SELECT_NODE",   "required": true,
    "config": { "role": "FROM", "allowedKinds": ["INTERNAL"] },
    "transitions": [{ "to": "item" }] },
  { "id": "item",        "type": "SCAN_ITEM",     "required": true,
    "transitions": [{ "to": "lote" }] },
  { "id": "lote",        "type": "CAPTURE_BATCH", "required": false,
    "transitions": [{ "to": "cantidad" }] },
  { "id": "cantidad",    "type": "CAPTURE_QTY",   "required": true,
    "transitions": [{ "to": "tenedor" }] },
  { "id": "tenedor",     "type": "SELECT_NODE",   "required": true,
    "config": { "role": "TO", "allowedKinds": ["CUSTODY"] },
    "transitions": [{ "to": "vencimiento" }] },
  { "id": "vencimiento", "type": "SET_DUE_DATE",  "required": true,
    "transitions": [{ "to": "confirmar" }] },
  { "id": "confirmar",   "type": "CONFIRM",       "required": true,
    "transitions": [{ "to": null }] }
]}
```

`motivo` es `required: true` en las dos de ajuste, y no por gusto del diseño: un
asiento cuyo extremo sea `adjustment-in`, `adjustment-out` o `shrinkage` exige
`reason` en el dominio ([02 §10](02-modelo-de-dominio.md), `reason-required`).
Un `motivo` opcional daría una plantilla que llega a `CONFIRM` y falla siempre.

`vencimiento` también es `required: true`: sin `dueAt` no hay nada que vencer, y una
custodia que nadie tiene que devolver no genera las alertas de [14](14-alerts.md), que
es la mitad de por qué existe el préstamo.

Seis procesos, ocho manejadores, un motor. **La diferencia entre una recepción y un
traslado es qué `allowedKinds` lleva un paso.** Ese es el indicador de que la
abstracción está al nivel correcto.

`AJUSTE` son dos plantillas y no una con "signo" porque el motor lineal no tiene
dónde poner la decisión: P-8 prohíbe la rama, e I-2 prohíbe la cantidad negativa
que la habría disparado. Dos plantillas cuestan cero manejadores nuevos. El día
del `GraphRunner`, unificarlas será una condición en una transición — y es justo
el caso que demuestra por qué se dejó la puerta abierta.

**La devolución de una custodia no tiene plantilla en el MVP.** Un check-in
exige `settlesId` ([02 §6](02-modelo-de-dominio.md)) —qué préstamo salda— y
capturarlo requeriría un paso `SELECT_CUSTODY` que liste los préstamos
pendientes del tenedor. Se registra con `POST /v1/movements` directamente; el
paso está anotado en §14.

## 7. Casos de uso

```ts
interface StartProcess {                                 // RECORD_MOVEMENT
  execute(ctx, input: { templateCode: TemplateCode; id?: ProcessInstanceId })
    : Promise<{ instance: ProcessInstance; nextStep: StepDefinition }>;
}

interface CompleteStep {                                 // RECORD_MOVEMENT
  execute(ctx, input: {
    instanceId: ProcessInstanceId; stepId: StepId;
    payload: unknown;                  // null = omitir, si el paso lo admite
  }): Promise<{
    instance: ProcessInstance;
    nextStep?: StepDefinition;
    movements?: Movement[];        // presente solo al completar
  }>;
}

interface CancelProcess { /* RECORD_MOVEMENT · sin efectos, P-6 */ }

interface GetProcessInstance { /* READ */ }
interface ListProcessInstances { /* READ · filtros: state, templateCode, actorId */ }

interface ListTemplates     { /* READ */ }
interface GetActiveTemplate { /* READ · 404 template-not-found */ }
interface CreateTemplateVersion { /* MANAGE_CATALOG · P-8, P-9 */ }

/** Contexto de sistema: corre dentro de CreateOrganization, cuando no hay token. */
interface SeedFactoryTemplates {
  execute(orgId: OrgId): Promise<void>;     // idempotente por (code, version)
}
```

**Ninguna acción nueva.** Los ocho endpoints de §10 se reparten entre
`RECORD_MOVEMENT`, `MANAGE_CATALOG` y `READ`, que ya existen en la matriz de
[10 §2](10-tenancy.md): el `OPERATOR` opera procesos y no versiona plantillas, que es
exactamente el reparto que el producto quiere.

`SeedFactoryTemplates` **no recibe `RequestContext` y no llama a `requireAction`**,
por lo mismo que `SeedBoundaryNodes`: cuando corre no hay organización ni token
([07 §2](07-composicion-y-contexto-de-ejecucion.md)), y un contexto con roles
inventados sería una autorización que no puede fallar. Tampoco publica eventos:
`organization.created` ya cuenta el hecho.

Secuencia de `CompleteStep`, dentro de una transacción:

```
 1. Cargar instancia ────────── existe, OPEN (P-4)
 2. Cargar la plantilla ─────── en la versión que la instancia registró (P-1)
 3. Verificar el paso ───────── es el actual (P-2), no completado antes (P-3)
 4. Manejador: parse ────────── forma del payload
 5. Manejador: validate ─────── contra el mundo, en solo lectura
 6. Manejador: apply ────────── contexto nuevo
 7. Runner: advance ─────────── siguiente paso, o COMPLETED
 8. INSERT step_completion ──── append-only
 9. UPDATE process_instance ─── estado y contexto
10. Si hay efectos ──────────── CREATE_BATCH, EMIT_MOVEMENTS, ATTACH_MEDIA, en ese
                               orden, vía los casos de uso de catalog e inventory (P-7)
11. INSERT outbox_event
12. COMMIT
```

Los pasos 4-6 son puro dominio y no tocan la base. El 10 es el único que sale del
módulo, y lo hace por la puerta principal: los casos de uso públicos de
[12](12-inventory.md), con sus invariantes intactas.

`CreateTemplateVersion` **nunca modifica una versión existente** (P-9): crea la
siguiente y desactiva la anterior. Las instancias en curso siguen apuntando a la
versión con la que empezaron, y terminan con las reglas con las que nacieron.

## 8. Puertos de salida

```ts
interface ProcessTemplateRepository {
  findActive(orgId, code): Promise<ProcessTemplate | null>;
  findVersion(orgId, code, version): Promise<ProcessTemplate | null>;
  listActive(orgId): Promise<ProcessTemplate[]>;
  hasInstances(orgId, code, version): Promise<boolean>;     // P-9
  save(template): Promise<void>;
}

interface ProcessInstanceRepository {
  findById(orgId, id): Promise<ProcessInstance | null>;
  list(orgId, filter, page): Promise<Page<ProcessInstance>>;
  save(instance): Promise<void>;
}

interface StepCompletionRepository {
  listByInstance(orgId, instanceId): Promise<StepCompletion[]>;
  append(completion): Promise<void>;        // sin update, sin delete
}

// Lo que devuelve la resolución de un código, en `HandlerDeps` (§4.2)
interface ResolvedCode {
  readonly product: Product;
  readonly batch?: Batch;                 // presente si el código era una serie
}
```

### No hay puertos puente hacia catalog ni inventory

`process` depende de `tenancy`, `catalog` e `inventory` ([01 §5](01-arquitectura.md)),
así que **inyecta sus repositorios y sus casos de uso directamente**, sin declarar un
puerto propio ni escribir un adaptador que lo reexporte:

| Lo que el motor necesita | De dónde sale, tal cual |
|---|---|
| Resolver un código | `ResolveCode` de [11 §4](11-catalog.md) — devuelve `null`, no lanza |
| Nodo por id / por código | `NodeRepository.findById` · `.findByCode` de [12 §5](12-inventory.md) |
| Producto por id | `ProductRepository.findById` de [11 §5](11-catalog.md) |
| Lote por `(producto, lotCode)` / por serie | `BatchRepository.findByLotCode` · `.findBySerial` |
| Crear el lote nuevo | `CreateBatch` de [11 §4](11-catalog.md) — exige `CREATE_BATCH` |
| Asentar el movimiento | `RecordMovementBatch` de [12 §4.2](12-inventory.md) |
| Adjuntar las fotos | `AttachMedia` de [11 §4](11-catalog.md), forma `storageKeys` |

Es la misma decisión que tomó `RecordMovement` con `PRODUCT_REPOSITORY` y
`BATCH_REPOSITORY`, y antes `CreateNode` con `CUSTOM_FIELD_REPOSITORY`: las firmas
ya son exactamente las que hacen falta, y un puerto que las reexporte es un fichero
que envejece aparte del que copia. La `application/` del motor construye con ellas el
`HandlerDeps` de §4.2, que sigue siendo de solo lectura por tipo.

**`RecordMovementBatch` y no `RecordMovement`**, aunque hoy la instancia produzca una
sola línea (§3): es la puerta que el día multi-línea ya recibe una lista, y la que
hace cierta la promesa de todo-o-nada de P-7 con un solo `applyDelta`. No lleva clave
de idempotencia: la petición que completa el paso ya la tiene, y todo lo que ocurre
dentro de ella está cubierto ([07 §5](07-composicion-y-contexto-de-ejecucion.md)).

Los adaptadores cruzados de [07 §7](07-composicion-y-contexto-de-ejecucion.md) que
este módulo sí necesita se reducen a **uno**: el sembrador de las plantillas de
fábrica, que `CreateOrganization` invoca vía `OrgProvisioner` ([10 §5](10-tenancy.md)).

## 9. Persistencia

Tablas `process_template`, `process_instance`, `step_completion`, en
[04 §3.6](04-persistencia.md).

`steps` se guarda como JSONB y no como tabla relacional porque una plantilla se lee
siempre entera, nunca por paso suelto, y **su forma va a cambiar**: cuando las
transiciones lleven condiciones, el JSONB lo absorbe sin migración estructural,
mientras que una tabla `template_step` con columna `order` obligaría a migrar cada
fila.

La clave foránea compuesta `(org_id, template_code, template_version)` es la que
convierte P-1 en una garantía de la base de datos.

**Un paso omitido guarda el literal JSON `null`, no un `NULL` de SQL.**
`step_completion.payload` es `jsonb NOT NULL`, así que omitir un paso (§4.2) escribe
`'null'::jsonb`. Distinguirlos importa: un `NULL` de SQL no cabe en la columna, y la
diferencia entre «este paso se omitió» y «este paso no existe» es precisamente la
fila.

**`process_instance.version` es bloqueo optimista interno, no contrato.** Ningún
endpoint de §10 pide `If-Match`, y no debe pedirlo: quien avanza un proceso es un
cliente que sigue lo que el servidor le indica paso a paso, y el `409 wrong-step` de
P-2 ya le dice que llegó tarde con un mensaje que sabe leer. La columna existe para
que dos `complete` simultáneos no se pisen el contexto; el que pierda verá el
`step-already-completed` de P-3.

**`step_completion` es append-only y necesita las dos capas**, como `movement`
([04 §3.4](04-persistencia.md)): el tipo del DAO —que no tiene `update` ni `delete`—
y un `REVOKE UPDATE, DELETE ON step_completion FROM tubodega_app, tubodega_system`.
La migración `full_schema` solo revoca sobre `movement`; la segunda capa de esta
tabla llega con el módulo.

## 10. Endpoints

| Método | Ruta | Acción |
|---|---|---|
| `GET` | `/v1/process-templates` | `READ` |
| `GET` | `/v1/process-templates/{code}` | `READ` — versión activa |
| `POST` | `/v1/process-templates/{code}/versions` | `MANAGE_CATALOG` |
| `POST` | `/v1/process-instances` | `RECORD_MOVEMENT` — `Idempotency-Key` |
| `GET` | `/v1/process-instances` | `READ` — filtros `state`, `templateCode`, `actorId` |
| `GET` | `/v1/process-instances/{id}` | `READ` — incluye pasos completados |
| `POST` | `/v1/process-instances/{id}/steps/{stepId}/complete` | `RECORD_MOVEMENT` — `Idempotency-Key` |
| `POST` | `/v1/process-instances/{id}/cancel` | `RECORD_MOVEMENT` — `Idempotency-Key` |

La respuesta de `complete` incluye **la definición del paso siguiente**, no solo su
identificador. Así el cliente sabe qué pedir a continuación sin volver a consultar la
plantilla, que es lo que permite que un cliente sea genérico: no necesita conocer los
procesos, solo seguir lo que el servidor le va indicando.

## 11. Eventos emitidos

| Tipo | Cuándo |
|---|---|
| `process.started` | Se abre una instancia |
| `process.step_completed` | Se completa un paso |
| `process.completed` | La instancia llega al final; los movimientos ya están asentados |
| `process.cancelled` | |

## 12. Errores

| `type` | Estado | Cuándo |
|---|---|---|
| `template-not-found` | 404 | El código no existe o no tiene versión activa |
| `process-instance-not-found` | 404 | La instancia no existe, o es de otra organización (I-6: nunca `403`) |
| `process-instance-id-taken` | 409 | `StartProcess` con un `id` de cliente ya usado, con otra `Idempotency-Key` |
| `instance-closed` | 409 | P-4 |
| `wrong-step` | 409 | P-2; el detalle nombra el paso actual |
| `step-already-completed` | 409 | P-3 |
| `required-step-skipped` | 422 | P-5 |
| `invalid-step-payload` | 422 | Falla `parse` o `validate`; `errors[]` con `pointer` |
| `incomplete-draft` | 422 | `CONFIRM` con borrador incompleto; el detalle lista lo que falta |
| `batch-step-required` | 422 | `CAPTURE_BATCH` omitido con producto `LOT`/`SERIAL` sin lote en contexto |
| `batch-step-not-allowed` | 422 | `CAPTURE_BATCH` con datos sobre producto `QUANTITY` |
| `upload-not-found` | 422 | `CAPTURE_PHOTO` con una clave que no está en la zona de espera o ya fue reclamada |
| `unknown-step-type` | 422 | La plantilla usa un tipo sin manejador registrado |
| `branching-not-supported` | 422 | P-8; una plantilla con más de una transición por paso |
| `invalid-template` | 422 | Una transición apunta a un `id` de paso que no existe, un paso es inalcanzable desde el primero, o ninguno cierra con `to: null` |
| `template-has-instances` | 409 | P-9 |

`branching-not-supported` merece un mensaje explícito y no un fallo genérico: es la
señal de que alguien ha llegado al límite del MVP, y el mensaje debe decirle que la
capacidad está prevista y qué falta para habilitarla.

`invalid-template` es su hermano aburrido y hace falta igual: `unknown-step-type`
cubre el tipo que nadie sabe ejecutar y `branching-not-supported` la rama, pero una
plantilla cuyo `confirmar` transite a un paso mal escrito pasa las dos y **se siembra
rota**. El fallo aparecería mucho después, en la instancia de alguien, como un 500.

**Una clave de foto que no está en la zona de espera, o que ya fue reclamada, es
`upload-not-found` (422)** y no `invalid-step-payload`: es el mismo `type` que ya
devuelve `POST /v1/products/{id}/media` en [11 §9](11-catalog.md) para la misma
condición, y el cliente que reintenta una subida no debería tener que aprenderse dos
nombres para el mismo problema. `invalid-step-payload` queda para lo que la palabra
dice: una forma de payload que el manejador no sabe leer.

`process-instance-id-taken` es el molde de `movement-id-taken` ([12 §9](12-inventory.md)):
`StartProcess` acepta un `id` del cliente, así que puede chocar contra la clave
primaria con una `Idempotency-Key` distinta, y un choque de PK sin `type` propio
saldría como un 500.

## 13. Pruebas

**Dominio (100 % líneas y ramas)** — `LinearRunner` recorriendo cada plantilla de
fábrica de principio a fin, **tres veces: con un producto `QUANTITY`, uno `LOT`
y uno `SERIAL`**, y llegando a `CONFIRM` con un borrador que `Movement.create`
acepta; cada invariante P-1 a P-9 con una prueba nombrada por su número; cada
manejador con payload válido, inválido y `null`; `CAPTURE_BATCH` en las seis
celdas de su tabla; `ProcessContext` acumulando correctamente a lo largo de una
secuencia.

**Aplicación** — `CompleteStep` con puertos dobles: intentar el paso equivocado,
repetir uno ya hecho, confirmar con borrador incompleto; verificación de que **no se
emite ningún efecto antes de `CONFIRM`** (P-6).

**Integración** — P-1 con la clave foránea compuesta; P-3 bajo concurrencia: dos
peticiones simultáneas al mismo paso y solo una gana; atomicidad de P-7, provocando
un fallo en el paso 10 y comprobando que ni la instancia avanzó ni los movimientos
entraron.

**e2e** — la recepción completa del criterio de éxito 3 de
[00](00-vision-y-alcance.md), paso a paso por HTTP, con un lote nuevo creado en
el mismo `CONFIRM`; el préstamo con fecha del criterio 5; una instancia
abandonada a la mitad que no deja rastro en el inventario ni en el catálogo.

## 14. Ganchos de extensión

| Extensión | Qué ya lo permite | Qué falta |
|---|---|---|
| **Flujos con ramas** | Transiciones como lista, pasos por `id`, versionado, `ProcessRunner` como interfaz | `GraphRunner`, un evaluador de condiciones, y retirar P-8 |
| **Plantillas por tenant** | La tabla ya es por organización y versionada; `POST /v1/process-templates/{code}/versions` ya existe, con su validador (§10, P-8, P-9) | Editar una plantilla **sembrada** sin versionarla, y una interfaz para escribirlas: hoy hay que mandar los pasos en JSON |
| **Pasos nuevos** | El registro de manejadores | Una clase por paso. Nada más. |
| **Conteo cíclico** | Es una plantilla más: `SELECT_NODE → SCAN_ITEM → CAPTURE_QTY → CONFIRM`, con `CONFIRM` emitiendo la diferencia como ajuste | Entidad de tarea de conteo y selección de qué contar |
| **Picking** | Una plantilla que recorre líneas de un pedido | Entidad de pedido y reservas en `inventory` |
| **Aprobaciones** | Un manejador `APPROVAL` que deja la instancia esperando | Notificaciones y resolución asíncrona; empuja hacia `GraphRunner` |
| **Procesos multi-línea** | `CONFIRM` ya emite una lista; `RecordMovementBatch` ya la recibe | Un grupo de pasos repetible con índice de iteración; cambia P-3 y `step_completion`. Diseño en [90 §12](90-extensiones-previstas.md). |
| **Devolución guiada** | El check-in ya existe como movimiento con `settlesId` | Un paso `SELECT_CUSTODY` que liste los préstamos pendientes del tenedor, y una plantilla `DEVOLUCION` |
| **Confirmación por línea** | El motor ya distingue borrador de efectos | Un `CONFIRM_LINE` que emita movimientos parciales. Cambia la garantía de P-6, y debe ser una decisión explícita de producto, no un descuido. |

Que **conteo cíclico** y **picking** —dos de las tres funciones que quedaron fuera
del MVP— sean plantillas y no código nuevo del motor es la prueba de que esta
frontera está bien puesta.

## 15. Documentos relacionados

- [02 — Modelo de dominio](02-modelo-de-dominio.md) · [04 §3.6](04-persistencia.md) · [07](07-composicion-y-contexto-de-ejecucion.md) · [11 — Catalog](11-catalog.md) · [12 — Inventory](12-inventory.md) · [90 — Extensiones previstas](90-extensiones-previstas.md)
