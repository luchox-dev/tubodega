# 11 — Catalog

> `libs/catalog` · Productos, sus códigos, sus fotos, sus lotes y las definiciones
> de campos custom de la organización.
>
> Es el módulo que define **qué** se mueve. `inventory` define **dónde** está y
> **cuánto** hay.

## 1. Propósito y frontera

Mantiene el catálogo: la definición de cada artículo, las formas de identificarlo al
escanear, sus imágenes, sus lotes o números de serie, y los campos que cada
organización quiere añadirle.

Queda fuera, y es importante: **el catálogo no sabe cuánto hay de nada**. Un
`Product` no tiene cantidad, ni existencias, ni ubicación. Esas preguntas las
responde [12 — Inventory](12-inventory.md).

Esa separación es lo que permite que el catálogo se edite sin tocar el ledger, y que
el ledger crezca sin ensanchar el catálogo. Meterle un campo `stock` al producto
sería el atajo que rompe la invariante I-5 el primer día que dos personas reciben a
la vez.

También queda fuera: precios, costos, proveedores, categorías jerárquicas y
sustitutos. Ninguno hace falta para operar una bodega, y todos son fáciles de añadir
después sin romper nada.

## 2. Entidades y tipos del dominio

```ts
type ProductId = Branded<string, 'ProductId'>;
type BatchId   = Branded<string, 'BatchId'>;
type Sku       = Branded<string, 'Sku'>;        // 1-64, sin espacios
type FieldKey  = Branded<string, 'FieldKey'>;   // snake_case, 1-64

enum TrackingMode { QUANTITY, LOT, SERIAL }
enum CodeKind     { EAN, UPC, INTERNAL_QR, SUPPLIER_REF, OTHER }
enum CustomEntity { PRODUCT, NODE, BATCH }
enum CustomType   { TEXT, NUMBER, DATE, BOOLEAN, SELECT }
enum UnitOfMeasure { UNIT, KG, G, L, ML, M, CM, BOX, PACK }

class Product {
  readonly id: ProductId;
  readonly orgId: OrgId;
  readonly sku: Sku;                    // 1-64, sin espacios
  readonly name: string;
  readonly description?: string;
  readonly trackingMode: TrackingMode;  // QUANTITY | LOT | SERIAL
  readonly uom: UnitOfMeasure;
  readonly active: boolean;
  readonly customFields: CustomFieldValues;
  readonly version: number;

  requiresBatch(): boolean;             // trackingMode !== QUANTITY
  rename(name: string): Product;
  deactivate(): Product;
}

class ProductCode {
  readonly id, orgId, productId;
  readonly value: string;               // 1-128
  readonly kind: CodeKind;              // EAN | UPC | INTERNAL_QR
                                        // SUPPLIER_REF | OTHER
}

class Batch {
  readonly id: BatchId;
  readonly orgId, productId;
  readonly lotCode?: string;
  readonly serial?: string;
  readonly expiresAt?: Date;
  readonly customFields: CustomFieldValues;

  isExpired(at: Date): boolean;
  expiresWithin(days: number, at: Date): boolean;
}

class CustomFieldDefinition {
  readonly id, orgId;
  readonly entity: CustomEntity;        // PRODUCT | NODE | BATCH
  readonly key: FieldKey;               // snake_case, 1-64
  readonly label: string;
  readonly type: CustomType;            // TEXT | NUMBER | DATE | BOOLEAN | SELECT
  readonly options?: readonly string[]; // solo SELECT
  readonly required: boolean;
  readonly position: number;

  validate(value: unknown): Result<CustomFieldValue>;
}

type CustomFieldValue = string | number | Date | boolean;

class CustomFieldValues {
  static build(defs: CustomFieldDefinition[], raw: Record<string, unknown>)
    : Result<CustomFieldValues>;
  get(key: FieldKey): CustomFieldValue | undefined;
}
```

`CustomFieldValues` es un objeto de valor que **solo puede construirse validando**
contra las definiciones vigentes. Es lo que impide que un JSONB acabe siendo un saco
donde cabe cualquier cosa: la única forma de tener valores custom es haber pasado por
la validación, y eso se comprueba en el tipo, no en una revisión de código.

### `trackingMode`, otra vez

Definido en [02 §4](02-modelo-de-dominio.md); aquí importa por su consecuencia
operativa: **es inmutable una vez el producto tiene movimientos** (invariante I-15).

La razón es que el ledger desnormaliza `tracking_mode` en cada movimiento para poder
hacer cumplir I-8 con un `CHECK`. Cambiarlo desalinearía el histórico. La salida para
el usuario es crear un producto nuevo y desactivar el anterior — fricción deliberada,
frente a la alternativa de reescribir el pasado.

## 3. Invariantes

| # | Invariante | Mecanismo |
|---|---|---|
| **C-1** | El SKU es único por organización | `UNIQUE (org_id, sku)` |
| **C-2** | Un código resuelve a un solo producto | `UNIQUE (org_id, value)` sobre `product_code` |
| **C-3** | Un producto `LOT` tiene lotes con `lot_code`; uno `SERIAL`, con `serial` | Validación de dominio + `CHECK` en `batch` |
| **C-4** | Un producto `QUANTITY` no tiene lotes | Validación de dominio en la creación de lote |
| **C-5** | El número de serie es único por organización | `UNIQUE (org_id, serial)` parcial |
| **C-6** | El código de lote es único por producto | `UNIQUE (org_id, product_id, lot_code)` parcial |
| **C-7** | Los valores custom validan contra las definiciones vigentes | Constructor de `CustomFieldValues` |
| **C-8** | El `trackingMode` no cambia si hay movimientos (I-15) | Caso de uso, consultando el puerto `MovementCounter` |
| **C-9** | Un producto con existencias no puede desactivarse | Caso de uso, consultando `StockChecker` |
| **C-10** | Una definición de campo `required` no se crea si ya hay entidades sin ese valor | Caso de uso, con conteo previo |

**C-9** evita el estado incoherente de tener existencias de algo que el catálogo
declara retirado. El mensaje de error indica en qué nodos queda stock, para que el
usuario sepa qué hacer.

**C-10** evita el problema clásico de los campos obligatorios retroactivos: mil
productos que de golpe son inválidos. Un campo nuevo nace opcional; se vuelve
obligatorio cuando todos lo tienen.

## 4. Casos de uso

```ts
interface CreateProduct {             // MANAGE_CATALOG
  execute(ctx, input: {
    sku: string; name: string; description?: string;
    trackingMode: TrackingMode; uom: string;
    codes?: { value: string; kind: CodeKind }[];
    customFields?: Record<string, unknown>;
  }): Promise<Product>;
}

interface UpdateProduct     { /* MANAGE_CATALOG · If-Match · C-8 */ }
interface DeactivateProduct { /* MANAGE_CATALOG · C-9 */ }

interface AddProductCode    { /* MANAGE_CATALOG · C-2 */ }
interface RemoveProductCode { /* MANAGE_CATALOG */ }

interface ResolveCode {               // READ — el más usado del sistema
  execute(ctx, code: string): Promise<{ product: Product; batch?: Batch } | null>;
}

interface CreateBatch       { /* CREATE_BATCH · C-3 a C-6 */ }

interface StageUpload {               // RECORD_MOVEMENT — zona de espera de fotos
  execute(ctx, file: { bytes; contentType }): Promise<{ storageKey: StorageKey; expiresAt: Date }>;
}
interface AttachMedia       { /* MANAGE_CATALOG · desde multipart o desde claves en espera */ }
interface RemoveMedia       { /* MANAGE_CATALOG */ }

interface DefineCustomField { /* MANAGE_CATALOG · C-10 */ }
interface UpdateCustomField { /* MANAGE_CATALOG · no cambia el tipo si hay valores */ }

interface ImportProducts {            // MANAGE_CATALOG
  execute(ctx, rows: ProductRow[]):
    Promise<{ created: number; updated: number; errors: RowError[] }>;
}
```

### `ResolveCode`

Es la operación más frecuente del producto: cada escaneo pasa por ella. Busca en
`product_code`; si no encuentra, en `batch.serial`; y si tampoco, en
`product.sku` — así el operario puede escanear la etiqueta del producto, la de
una unidad concreta, o teclear el SKU de una hoja de cálculo, y el sistema hace
lo correcto sin preguntarle qué escribió. El código de lote **no** se resuelve
aquí: es único por producto, no por organización, y sin producto es ambiguo.

Devuelve `null` en vez de lanzar: no encontrar un código es un resultado normal,
no una excepción, y el cliente necesita distinguirlo para ofrecer "crear producto".

### `StageUpload` y la zona de espera

Un proceso captura fotos **antes** de saber si va a confirmarse
([13 §5](13-process.md), `CAPTURE_PHOTO`), y el operario que las toma no tiene
`MANAGE_CATALOG`. `POST /v1/uploads` recibe la imagen, la guarda en
`MediaStorage`, registra la clave en `media_upload` ([04 §3.2](04-persistencia.md))
y la devuelve. Nada más: la foto no pertenece a ningún producto todavía.

`AttachMedia` **reclama** la clave —marca `claimed_at` y crea `product_media`—
cuando el proceso confirma. Una clave sin reclamar a las 24 horas se purga junto
con su archivo ([07 §6](07-composicion-y-contexto-de-ejecucion.md)); es lo que
evita que una instancia cancelada deje imágenes huérfanas para siempre.

### `CreateBatch` y el operario

`CreateBatch` exige `CREATE_BATCH`, que el `OPERATOR` tiene
([10 §2](10-tenancy.md)). Es la única escritura de catálogo abierta a ese rol, y
lo está porque un lote nuevo llega con la mercancía: exigir un administrador para
identificar la remesa detendría cada recepción de perecederos en el muelle.
Definir el producto sigue siendo `MANAGE_CATALOG`.

### `ImportProducts`

**Es el onboarding.** El usuario objetivo llega con una hoja de cálculo, y la
evidencia de la industria es que normalizar SKUs entre hojas es donde mueren los
proyectos de WMS.

Reglas: coincidencia por SKU, `upsert` fila a fila, y **una fila con error no aborta
el lote** — se acumula en `errors` con número de línea y motivo. Un import de 500
productos que falla entero por la fila 347 es inservible; uno que importa 499 y
señala la mala es un producto que se puede usar.

## 5. Puertos de salida

```ts
interface ProductFilter {
  readonly active?: boolean;
  readonly trackingMode?: TrackingMode;
  readonly q?: string;                    // coincidencia sobre sku y name
}

/** Una fila del import. Las columnas ausentes no modifican el producto existente. */
interface ProductRow {
  readonly sku: string;
  readonly name?: string;
  readonly trackingMode?: TrackingMode;
  readonly uom?: string;
  readonly codes?: readonly string[];
  readonly customFields?: Record<string, unknown>;
}

interface RowError {
  readonly line: number;                  // 1-indexado, como lo ve el usuario
  readonly sku?: string;
  readonly type: string;                  // el mismo `type` de problem+json
  readonly detail: string;
}

interface ProductRepository {
  findById(orgId, id): Promise<Product | null>;
  findBySku(orgId, sku): Promise<Product | null>;
  findManyBySkus(orgId, skus: string[]): Promise<Map<string, Product>>;  // import
  list(orgId, filter: ProductFilter, page: Cursor): Promise<Page<Product>>;
  save(product: Product): Promise<void>;
  saveMany(products: Product[]): Promise<void>;
}

interface ProductCodeRepository {
  findByValue(orgId, value): Promise<ProductCode | null>;
  listByProduct(orgId, productId): Promise<ProductCode[]>;
  save(code): Promise<void>;
  delete(orgId, id): Promise<void>;
}

interface BatchRepository {
  findById(orgId, id): Promise<Batch | null>;
  findBySerial(orgId, serial): Promise<Batch | null>;
  findByLotCode(orgId, productId, lotCode): Promise<Batch | null>;
  listExpiringBefore(orgId, date): Promise<Batch[]>;      // usado por alerts
  save(batch): Promise<void>;
}

interface CustomFieldDefinitionRepository {
  listByEntity(orgId, entity): Promise<CustomFieldDefinition[]>;
  countEntitiesMissing(orgId, entity, key): Promise<number>;   // C-10
  save(def): Promise<void>;
}

interface MediaStorage {
  put(orgId, bytes, contentType): Promise<StorageKey>;
  signedUrl(key, ttl): Promise<string>;
  delete(key): Promise<void>;
}

interface MediaUploadRepository {
  stage(upload): Promise<void>;
  claim(orgId, keys: StorageKey[]): Promise<StorageKey[]>;   // devuelve las que no existían o ya estaban reclamadas
  listUnclaimedBefore(date): Promise<StorageKey[]>;         // purga; contexto de sistema
}

// Implementados por inventory. Evitan que catalog dependa de él (regla R-2).
interface MovementCounter { countByProduct(orgId, productId): Promise<number>; }
interface StockChecker    { hasStock(orgId, productId): Promise<boolean>; }
```

`MovementCounter` y `StockChecker` son la aplicación del mismo patrón que
`OrgProvisioner` en [10](10-tenancy.md): el módulo de arriba declara qué necesita
saber, el de abajo lo implementa, y la dirección de la dependencia se mantiene.

`MediaStorage` es un puerto porque el almacenamiento de fotos cambiará: disco local
al principio, S3 después. Ningún caso de uso debe enterarse.

## 6. Persistencia

Tablas `product`, `product_code`, `product_media`, `media_upload`, `batch` y
`custom_field_definition`, con sus índices, en [04 §3.2](04-persistencia.md).

## 7. Endpoints

| Método | Ruta | Acción |
|---|---|---|
| `GET` | `/v1/products` | `READ` — filtros: `active`, `trackingMode`, `q`; orden por `name`, `sku`, `createdAt` |
| `POST` | `/v1/products` | `MANAGE_CATALOG` |
| `GET` | `/v1/products/{id}` | `READ` |
| `PATCH` | `/v1/products/{id}` | `MANAGE_CATALOG` — `If-Match` |
| `DELETE` | `/v1/products/{id}` | `MANAGE_CATALOG` — desactiva |
| `POST` | `/v1/products/import` | `MANAGE_CATALOG` |
| `GET` | `/v1/products/{id}/codes` | `READ` |
| `POST` | `/v1/products/{id}/codes` | `MANAGE_CATALOG` |
| `DELETE` | `/v1/products/{id}/codes/{codeId}` | `MANAGE_CATALOG` |
| `GET` | `/v1/codes/{value}/resolve` | `READ` — el endpoint del escaneo |
| `GET` | `/v1/products/{id}/batches` | `READ` |
| `POST` | `/v1/products/{id}/batches` | `CREATE_BATCH` |
| `POST` | `/v1/uploads` | `RECORD_MOVEMENT` — multipart; devuelve `storageKey` |
| `POST` | `/v1/products/{id}/media` | `MANAGE_CATALOG` — multipart, o `{ storageKeys[] }` de la zona de espera |
| `DELETE` | `/v1/products/{id}/media/{mediaId}` | `MANAGE_CATALOG` |
| `GET` | `/v1/custom-fields` | `READ` — filtro por `entity` |
| `POST` | `/v1/custom-fields` | `MANAGE_CATALOG` |
| `PATCH` | `/v1/custom-fields/{id}` | `MANAGE_CATALOG` — `If-Match` |

`/v1/codes/{value}/resolve` está fuera de `/products` a propósito: el cliente que
escanea no sabe todavía si el código es de producto o de lote, y ese
desconocimiento es justo lo que el endpoint resuelve.

## 8. Eventos emitidos

| Tipo | Cuándo |
|---|---|
| `product.created` · `product.updated` · `product.deactivated` | |
| `batch.created` | |
| `custom_field.defined` | |

## 9. Errores

| `type` | Estado | Cuándo |
|---|---|---|
| `sku-taken` | 409 | C-1 |
| `code-taken` | 409 | C-2; el detalle nombra el producto que ya lo usa |
| `serial-taken` | 409 | C-5 |
| `lot-code-taken` | 409 | C-6 |
| `batch-not-allowed` | 422 | Lote sobre producto `QUANTITY` (C-4) |
| `batch-required` | 422 | Lote sin `lotCode`/`serial` según el modo (C-3) |
| `tracking-mode-locked` | 422 | C-8; el detalle indica cuántos movimientos lo bloquean |
| `product-has-stock` | 422 | C-9; el detalle lista los nodos con existencias |
| `invalid-custom-field` | 422 | C-7; `errors[]` con un `pointer` por campo |
| `required-field-would-invalidate` | 422 | C-10; el detalle indica cuántas entidades quedarían inválidas |
| `unsupported-media-type` | 415 | Solo `image/jpeg`, `image/png`, `image/webp` |
| `media-too-large` | 413 | Máximo 10 MB por imagen |
| `upload-not-found` | 422 | Clave que no está en la zona de espera o ya fue reclamada |

Los detalles de `tracking-mode-locked`, `product-has-stock` y
`required-field-would-invalidate` incluyen la información necesaria para actuar. Un
error que solo dice que no se puede obliga al usuario a adivinar.

## 10. Pruebas

**Dominio** — **C-7**: validación de cada tipo de campo custom, incluidos casos
límite (número como cadena, fecha inválida, opción fuera de lista). **C-3** y
**C-4**: `requiresBatch()` en los tres modos, y construcción de lote rechazada sobre
un producto `QUANTITY`. Normalización de SKU y de código.

**Aplicación** — import con filas mixtas: creadas, actualizadas y erróneas en el
mismo lote, verificando que el conteo cuadra; `ResolveCode` resolviendo por código de
producto y por serie de lote; **C-8**, **C-9** y **C-10** con puertos dobles, este
último comprobando que un campo `required` se rechaza si hay entidades sin valor.

**Integración** — C-1, C-2, C-5, C-6 bajo concurrencia: dos transacciones simultáneas
con el mismo SKU y solo una gana; el índice GIN se usa en el filtro por campo custom
(`EXPLAIN`).

**e2e** — importar 500 productos con códigos, fotos y un campo custom, que es el
criterio de éxito 1 de [00](00-vision-y-alcance.md); escanear un código y recibir el
producto; escanear una serie y recibir producto más lote.

## 11. Ganchos de extensión

| Extensión | Qué ya lo permite | Qué falta |
|---|---|---|
| Categorías | `customFields` puede sostener una categoría plana desde hoy | Entidad jerárquica, si se quiere árbol |
| Precios y costos | Entidad aparte que referencia `productId` | Decisiones contables por país |
| Proveedores | Ya existen como nodos `SOURCE` en `inventory` | Relación producto-proveedor y referencia cruzada |
| Variantes | `Product` es la unidad de stock; una variante es un producto | Entidad padre de agrupación, sin tocar el ledger |
| Búsqueda de texto completo | El filtro `q` ya existe en el contrato | Columna `tsvector` e índice GIN |
| Kits y ensamblados | — | Entidad de composición y una plantilla de proceso que emita los movimientos de consumo y producción. **El ledger no cambia.** |

## 12. Documentos relacionados

- [02 §4, §5, §8](02-modelo-de-dominio.md) · [04 §3.2](04-persistencia.md) · [07](07-composicion-y-contexto-de-ejecucion.md) · [12 — Inventory](12-inventory.md) · [13 — Process](13-process.md) · [14 — Alerts](14-alerts.md)
