# 14 — Alerts

> `libs/alerts` · El motor de reglas por fecha: vencimientos de lote y custodias que
> no han vuelto.
>
> Es el módulo más pequeño del sistema, y existe porque dos preguntas que parecían
> distintas resultaron ser la misma.

## 1. Propósito y frontera

Evalúa periódicamente qué fechas están venciendo y mantiene una lista de alertas
abiertas.

La observación que lo funda: **"este lote se vence el viernes" y "Juan debía devolver
el taladro el martes" son la misma pregunta** — *una fecha que vence sobre una
posición de stock*. Modelarlas como dos funciones separadas habría producido dos
evaluadores, dos tablas y dos endpoints para la misma forma de dato.

Queda fuera: la entrega de las alertas. Este módulo decide qué alertas existen; que
alguien reciba un correo, una notificación o un mensaje es responsabilidad de un
consumidor del evento `alert.raised`. Esa separación es lo que permite añadir canales
de notificación sin tocar la lógica de evaluación.

También queda fuera del MVP la alerta por stock mínimo, aunque el módulo esté
diseñado para acogerla — ver §11.

## 2. Entidades y tipos del dominio

```ts
type AlertId = Branded<string, 'AlertId'>;

// Unión de cadenas y no `enum` numérico: la columna es `alert_kind_enum`, de
// texto, y un `Record<AlertKind, number>` con enum numérico daría claves 0..3
// en el JSON de `GET /v1/alerts/summary`.
type AlertKind =
  | 'BATCH_EXPIRING'    // vence dentro del umbral, y todavía no venció
  | 'BATCH_EXPIRED'     // ya venció
  | 'CUSTODY_DUE'       // el retorno vence dentro del umbral, y todavía no venció
  | 'CUSTODY_OVERDUE';  // el retorno ya venció

class Alert {
  readonly id: AlertId;
  readonly orgId: OrgId;
  readonly kind: AlertKind;
  readonly subject: AlertSubject;      // BATCH:<id> | MOVEMENT:<id>
  readonly dueAt: Date;
  readonly raisedAt: Date;
  readonly resolvedAt?: Date;

  isOpen(): boolean;
  severity(at: Date): Severity;        // INFO | WARNING | CRITICAL
  daysUntilDue(at: Date): number;      // negativo si ya venció
}

interface AlertSubject {
  readonly type: 'BATCH' | 'MOVEMENT';
  readonly id: string;
}

type Severity = 'INFO' | 'WARNING' | 'CRITICAL';

/** Alerta enriquecida para presentar sin consultas adicionales — ver §5. */
interface AlertView {
  readonly alert: Alert;
  readonly severity: Severity;
  readonly daysUntilDue: number;
  readonly productName: string;
  readonly productSku: string;
  readonly lotCode?: string;
  readonly nodeName: string;              // ver «Qué enseña una alerta de lote», abajo
  readonly quantity: string;
}

/** Resultados de los puertos de consulta — ver §6. */
interface ExpiringBatch {
  readonly batchId: BatchId;
  readonly expiresAt: Date;
}

interface OverdueCustody {
  readonly movementId: MovementId;     // el check-out
  readonly dueAt: Date;
  readonly nodeId: NodeId;
  readonly productId: ProductId;
  readonly batchId?: BatchId;
  readonly pending: string;            // cantidad − Σ saldado; siempre > 0 aquí
}

class AlertRule {
  readonly kind: AlertKind;
  readonly thresholdDays: number;      // días de antelación
  readonly enabled: boolean;
}
```

`severity()` se **deriva** de la fecha en el momento de consultar, no se almacena.
Una alerta guardada con `severity: WARNING` sería incorrecta al día siguiente y
exigiría un proceso que reevaluara todas las alertas cada noche. Calcularla al leer
es exacto siempre y no cuesta nada.

### La regla de severidad

```
BATCH_EXPIRED, CUSTODY_OVERDUE   →  CRITICAL siempre
BATCH_EXPIRING, CUSTODY_DUE      →  WARNING  si daysUntilDue(at) <= umbral / 2
                                    INFO     en el resto
```

El umbral es el de **su propia regla** (`AlertRule.thresholdDays`), no un número
fijo, porque un lote a tres días con un umbral de 30 y un préstamo a tres días con
un umbral de 3 no son la misma urgencia: al primero le queda el 10 % de su ventana y
al segundo se le acabó. La división entera reparte la ventana en dos mitades, y con
el umbral por defecto de 30 días eso pone el salto a `WARNING` en los últimos 15.

Lo vencido es `CRITICAL` y no depende de cuánto haga que venció: una vez pasada la
fecha ya no hay ventana que graduar, y una escala que siguiera bajando convertiría lo
más viejo en lo más grave, que es al revés de como se vacía una bandeja.

Con `at` como único argumento, **la misma alerta cambia de severidad con los días sin
que nadie la toque** — que es exactamente lo que A-5 exige demostrar.

### Umbrales por defecto

| Regla | Umbral | Cuándo se levanta |
|---|---|---|
| `BATCH_EXPIRING` | 30 días | El lote vence dentro de 30 días **y** hay saldo en nodos custodiables |
| `BATCH_EXPIRED` | 0 | Ya venció y aún hay saldo |
| `CUSTODY_DUE` | 3 días | El retorno vence en 3 días y el préstamo tiene pendiente > 0 |
| `CUSTODY_OVERDUE` | 0 | La fecha pasó y el préstamo tiene pendiente > 0 |

**La condición de saldo es esencial en las cuatro.** Un lote vencido del que ya no
queda nada no es un problema; una custodia cuyo artículo ya volvió, tampoco. Para
la custodia, el saldo que cuenta es **el del préstamo** —`cantidad − Σ saldado`,
[02 §6](02-modelo-de-dominio.md)— y no el del nodo: si Juan sacó dos martillos en
días distintos y devolvió el primero, solo el segundo debe alertar, y el saldo
del nodo `CUSTODY:juan` no sabe distinguirlos.
Levantar alertas sin comprobar el saldo produce ruido, y una bandeja de alertas
ruidosa se ignora entera — que es el modo en que este tipo de funcionalidad fracasa.

## 3. Invariantes

| # | Invariante | Mecanismo |
|---|---|---|
| **A-1** | Una alerta abierta por combinación de tipo y sujeto | `UNIQUE (org_id, kind, subject_type, subject_id) WHERE resolved_at IS NULL` |
| **A-2** | El evaluador es idempotente | A-1 más `ON CONFLICT DO NOTHING` |
| **A-3** | Una alerta se resuelve sola cuando su condición deja de cumplirse | El evaluador cierra lo que ya no aplica |
| **A-4** | No se levantan alertas sobre posiciones sin saldo | Consulta de saldo en la evaluación |
| **A-5** | La severidad se deriva, no se almacena | No hay columna de severidad |

**A-2** es la que permite ejecutar el evaluador cada minuto sin efectos acumulativos.
Un evaluador que duplicara alertas al reejecutarse obligaría a coordinar su
ejecución, y eso es infraestructura que este diseño no necesita.

**A-3** cierra el ciclo: cuando el operario devuelve el taladro, el saldo en custodia
desaparece y la siguiente pasada del evaluador resuelve la alerta. Nadie tiene que
acordarse de cerrarla a mano, que es exactamente lo que nadie hace.

## 4. El evaluador

Un job periódico —cada 5 minutos por defecto— que ejecuta cuatro consultas y
reconcilia el resultado contra las alertas abiertas. Corre en contexto de
sistema, con **una transacción por organización** y `app.current_org` fijado en
cada una ([07 §6](07-composicion-y-contexto-de-ejecucion.md)); una organización
que falle no impide evaluar las demás.

```
para cada organización activa:
  deseadas  ← evaluar las cuatro reglas
  abiertas  ← alertas sin resolver en la base

  a levantar  = deseadas − abiertas    → INSERT ... ON CONFLICT DO NOTHING
  a resolver  = abiertas − deseadas    → UPDATE resolved_at = now()

  emitir alert.raised / alert.resolved por cada cambio
```

**Reconciliación y no acumulación.** El evaluador calcula el estado que *debería*
existir y lo compara con el que hay. Un evaluador incremental —que solo añadiera al
detectar un vencimiento— acumularía alertas obsoletas cada vez que fallara una
ejecución, y no habría forma de recuperarse salvo limpiando a mano.

Cinco minutos es holgado a propósito: se trata de fechas con umbrales de días, no de
eventos en tiempo real. Un retraso de cinco minutos en avisar de algo que vence en
tres días no tiene consecuencias, y la frecuencia baja mantiene el costo en cero.

### Las cuatro consultas

```sql
-- BATCH_EXPIRING / BATCH_EXPIRED
SELECT b.id, b.expires_at
FROM batch b
WHERE b.org_id = $1
  AND b.expires_at IS NOT NULL
  AND b.expires_at <= now() + ($2 || ' days')::interval
  AND EXISTS (
    SELECT 1 FROM stock_balance sb
    WHERE sb.org_id = b.org_id AND sb.batch_id = b.id
      AND sb.node_kind IN ('INTERNAL','CUSTODY')
      AND sb.quantity > 0
  );

-- CUSTODY_DUE / CUSTODY_OVERDUE: por préstamo, no por saldo del nodo
SELECT m.id, m.due_at, m.to_node_id, m.product_id, m.batch_id,
       m.quantity - COALESCE(SUM(s.quantity), 0) AS pending
FROM movement m
LEFT JOIN movement s ON s.org_id = m.org_id AND s.settles_id = m.id
  AND NOT EXISTS (                          -- un check-in compensado no salda
    SELECT 1 FROM movement r
    WHERE r.org_id = s.org_id AND r.reverses_id = s.id
  )
WHERE m.org_id = $1
  AND m.due_at IS NOT NULL
  AND m.due_at <= now() + ($2 || ' days')::interval
  AND NOT EXISTS (                          -- un check-out compensado está saldado
    SELECT 1 FROM movement r
    WHERE r.org_id = m.org_id AND r.reverses_id = m.id
  )
GROUP BY m.id
HAVING m.quantity - COALESCE(SUM(s.quantity), 0) > 0;
```

Ambas se apoyan en índices ya definidos en [04](04-persistencia.md): el parcial sobre
`batch (org_id, expires_at)`, el parcial sobre `movement (org_id, to_node_id, due_at)`
y el parcial sobre `movement (org_id, settles_id)`. El `EXISTS` de la primera y el
`HAVING` de la segunda son los que implementan A-4.

### Son dos consultas, no cuatro: una por sujeto, partida por `at`

Cada consulta se ejecuta **una sola vez**, con `$2` = el **mayor** de los umbrales de
sus dos reglas **habilitadas**, y el evaluador parte el resultado en memoria:

```
expires_at <= at   →  BATCH_EXPIRED      (umbral 0)
expires_at >  at   →  BATCH_EXPIRING     (umbral de su regla)
due_at     <= at   →  CUSTODY_OVERDUE
due_at     >  at   →  CUSTODY_DUE
```

Dos vueltas a la misma tabla con dos horizontes darían exactamente las mismas filas,
porque el horizonte menor está contenido en el mayor. Y el umbral sale de las reglas
**habilitadas** porque `AlertRule.enabled` puede apagar una de las dos: con
`BATCH_EXPIRING` desactivada, el horizonte que queda es el 0 de `BATCH_EXPIRED`, y
seguir barriendo 30 días sería traer lote por gusto.

### `EXPIRING` y `OVERDUE` se excluyen

Las dos reglas de cada par son **mutuamente excluyentes**, y por eso el corte de
arriba es `<=` / `>` y no dos condiciones independientes. La unique de A-1 lleva el
`kind` dentro, así que sin esta regla un lote ya vencido —que satisface también
`expires_at <= at + 30 días`— tendría **las dos alertas abiertas a la vez** sobre el
mismo sujeto, y la bandeja contaría doble el mismo problema.

Con la exclusión, el día que un lote vence el evaluador hace en una sola pasada lo
que tiene que hacer: `BATCH_EXPIRING` deja de estar entre las deseadas y se resuelve
por A-3, y `BATCH_EXPIRED` se levanta. Es un relevo, no una acumulación — y es lo
que ya espera el caso 2 de la suite e2e de la WAVE 5.

La consulta de custodia no mira `stock_balance`. Con el saldo del nodo, un
préstamo devuelto seguiría alertando mientras el tenedor tuviera *cualquier*
unidad del mismo producto — el check-out del año pasado reaparecería como
vencido cada cinco minutos. Es el defecto que `settles_id` (I-17) existe para
eliminar.

## 5. Casos de uso

```ts
/** Contexto de sistema: lo invoca el job, sin token. No comprueba permisos. */
interface EvaluateAlerts {
  execute(orgId: OrgId, at: Date): Promise<{ raised: Alert[]; resolved: Alert[] }>;
}

/** La misma evaluación, pedida por una persona. Aquí sí hay token y hay permiso. */
interface RequestAlertEvaluation {           // MANAGE_ORG
  execute(ctx, input: { at?: Date }): Promise<{ raised: Alert[]; resolved: Alert[] }>;
}

/** Contexto de sistema, como el sembrador de nodos de frontera. */
interface SeedAlertRules {
  execute(orgId: OrgId): Promise<void>;      // los cuatro umbrales por defecto de §2
}

interface ListAlerts {                       // READ
  execute(ctx, filter: {
    kind?: AlertKind;
    openOnly?: boolean;                      // por defecto true
    dueBefore?: Date;
  }, page: Cursor): Promise<Page<AlertView>>;
}

interface GetAlertSummary {                  // READ
  execute(ctx): Promise<Record<AlertKind, number>>;
}

interface UpdateAlertRules {                 // MANAGE_ORG
  execute(ctx, rules: AlertRule[]): Promise<AlertRule[]>;
}
```

`AlertView` es la alerta enriquecida con lo que hace falta para mostrarla sin más
consultas: nombre y SKU del producto, código de lote, nombre del nodo o del tenedor,
cantidad afectada y días restantes. Un cliente que recibiera solo identificadores
tendría que hacer N peticiones para pintar una lista de N alertas.

`GetAlertSummary` existe para el contador de la bandeja: pedir la lista completa solo
para saber cuántas hay es desperdicio, y es la consulta que más se repite.

### Por qué son dos casos de uso y no uno

`EvaluateAlerts` corre **sin `RequestContext`**, como `SeedBoundaryNodes`
([04 §6](04-persistencia.md)): cuando el job lo llama no hay token, ni usuario, ni
roles que comprobar, y un contexto con roles inventados sería una autorización que no
puede fallar. `RequestAlertEvaluation` es la puerta de la persona: hace
`requireAction(ctx, MANAGE_ORG)`, rechaza el `at` fuera de `NODE_ENV=test`, toma el
`orgId` del propio contexto y delega.

Con una sola firma sin `ctx`, la autorización del endpoint habría tenido que vivir en
el controlador — y en esta arquitectura **la autorización es la primera línea de cada
`execute`**, nunca del borde ([10 §10](10-tenancy.md)). La firma es la salvaguarda: un
caso de uso que empieza por `OrgId` no se ata a un controlador por descuido.

`EvaluateAlerts` lo invoca el job cada cinco minutos, y `RequestAlertEvaluation`
responde a `POST /v1/alerts/evaluate` para la organización del token. El endpoint
existe por dos razones: el administrador que acaba de cambiar un umbral quiere ver el
efecto ahora, y el criterio de éxito 5 de [00](00-vision-y-alcance.md) —*el
sistema la marca como vencida al pasar la fecha*— tiene que poder demostrarse
desde la API pública sin esperar al job ni tocar la base
([06 §6](06-pruebas-y-calidad.md)). El parámetro `at` solo se acepta con
`NODE_ENV=test`; en cualquier otro entorno es `400`.

**No hay un caso de uso para resolver una alerta a mano.** Es intencional: las
alertas se resuelven arreglando lo que las causó —devolver el artículo, dar salida al
lote vencido—, no descartándolas. Un botón de "descartar" convierte la bandeja en
algo que se vacía por costumbre, y la señal se pierde.

## 6. Puertos de salida

```ts
interface AlertRepository {
  listOpen(orgId): Promise<Alert[]>;
  list(orgId, filter, page): Promise<Page<Alert>>;
  countByKind(orgId): Promise<Record<AlertKind, number>>;
  raiseMany(alerts: Alert[]): Promise<Alert[]>;      // ON CONFLICT DO NOTHING
  resolveMany(ids: AlertId[], at: Date): Promise<Alert[]>;
  purgeResolvedBefore(date: Date): Promise<number>;  // §7, retención de 90 días
}

interface AlertRuleRepository {
  listByOrg(orgId): Promise<AlertRule[]>;
  save(orgId, rules: AlertRule[]): Promise<void>;
}

// Provistos por catalog e inventory
interface ExpiringBatchQuery {
  find(orgId, before: Date): Promise<ExpiringBatch[]>;     // con saldo > 0
}
interface OverdueCustodyQuery {
  find(orgId, before: Date): Promise<OverdueCustody[]>;    // con saldo > 0
}
interface AlertEnricher {
  enrich(orgId, alerts: Alert[]): Promise<AlertView[]>;
}

interface OrgIterator { listActive(): Promise<OrgId[]>; }
```

Las dos consultas están declaradas como puertos y no ejecutadas aquí porque las
tablas `batch`, `movement` y `stock_balance` pertenecen a otros módulos. `alerts`
declara qué necesita saber; `catalog` e `inventory` lo responden. Es el mismo patrón
que en [10](10-tenancy.md) y [11](11-catalog.md), y lo que mantiene el grafo de
dependencias acíclico.

**Estos tres puertos sí hacen falta, y `process` no tiene ninguno** ([13 §8](13-process.md)):
la diferencia es que las consultas de §4 **cruzan catálogo e inventario en la misma
sentencia** —lote y saldo, movimiento y saldo—, y ninguna librería puede hacer eso.
`catalog` no ve `inventory` ([01 §5](01-arquitectura.md)), así que un método de
`BatchRepository` no tiene forma de escribir el `EXISTS` sobre `stock_balance` que
implementa A-4; y el enriquecimiento de `AlertView` necesita producto, lote, nodo y
saldo a la vez. Los implementa la aplicación, que es la única capa que ve a los tres,
igual que `StockChecker` y `MovementCounter` de [11 §5](11-catalog.md).

`OrgIterator` corre en contexto de sistema: recorre `organization` —la única tabla sin
`org_id` y por tanto sin RLS— filtrando por `active`.

## 7. Persistencia

Tablas `alert` y `alert_rule`, en [04 §3.7](04-persistencia.md). Las reglas viven
en una tabla propia, no en `custom_field_definition`: son configuración del
sistema, no datos que la organización defina libremente.

`alert_rule` se siembra con los umbrales por defecto de §2 al crear la
organización, junto con los nodos de frontera y las plantillas de proceso
([10 §4](10-tenancy.md)).

Las alertas resueltas se conservan **90 días** y luego se purgan. Son una señal
operativa, no un registro histórico: el histórico es el ledger. La purga es un job
([07 §6](07-composicion-y-contexto-de-ejecucion.md)) y se apoya en
`AlertRepository.purgeResolvedBefore` (§6).

**`alert` y `alert_rule` no tienen clave foránea a `organization`**: lo único que las
aísla es la política de RLS por `org_id`, como a las demás. Es deliberado —el sujeto
de una alerta es un `batch` o un `movement` y ese sí queda colgado del ledger— pero
conviene saberlo antes de escribir una prueba que espere un `23503` que no va a
llegar.

### Qué enseña una alerta de lote

`AlertView.nodeName` y `quantity` son directos para las de custodia: el nodo es el
tenedor y la cantidad es el pendiente del préstamo. Para las de lote no, porque un
lote puede tener saldo en varios sitios a la vez. Se fija así:

- `quantity` — la **suma** del saldo del lote en nodos custodiables. Es el número que
  responde a la pregunta que hace quien mira la bandeja: cuánto se va a perder.
- `nodeName` — el `path` del nodo con **más** saldo de ese lote; con empate, el
  primero por `path`. Es por dónde empezar a buscar, no un inventario de dónde está;
  el desglose completo ya lo da `GET /v1/stock?batchId=…`.

## 8. Endpoints

| Método | Ruta | Acción |
|---|---|---|
| `GET` | `/v1/alerts` | `READ` — filtros `kind`, `openOnly`, `dueBefore`; orden por `dueAt` |
| `GET` | `/v1/alerts/summary` | `READ` — conteo por tipo |
| `POST` | `/v1/alerts/evaluate` | `MANAGE_ORG` — `Idempotency-Key`; evalúa ahora; `at` solo en `test` |
| `GET` | `/v1/alert-rules` | `READ` |
| `PUT` | `/v1/alert-rules` | `MANAGE_ORG` — reemplaza el conjunto completo |

`PUT` con el conjunto completo y no `PATCH` por regla: son cuatro reglas, siempre las
mismas, y reemplazarlas de una vez evita el estado intermedio de haber actualizado
dos y fallado en la tercera.

## 9. Eventos emitidos

| Tipo | Cuándo |
|---|---|
| `alert.raised` | El evaluador levanta una alerta nueva |
| `alert.resolved` | La condición dejó de cumplirse |

Estos dos eventos son el punto de enganche de todo canal de notificación futuro
—correo, WhatsApp, push— sin que este módulo cambie.

## 10. Errores

| `type` | Estado | Cuándo |
|---|---|---|
| `evaluate-at-not-allowed` | 400 | `POST /v1/alerts/evaluate` con `at` fuera de `NODE_ENV=test` |
| `invalid-threshold` | 422 | Umbral negativo o mayor que 365 |
| `unknown-alert-kind` | 422 | Tipo no reconocido en `PUT /v1/alert-rules` |

La superficie de error es mínima porque el módulo casi no acepta escrituras: su
trabajo es leer fechas y saldos, y decidir.

`evaluate-at-not-allowed` es `400` y no `422`: `at` es una entrada que en producción
**no existe**, no una que se entienda y se rechace por una regla de negocio.

**El `CHECK` de la base solo cubre la mitad de `invalid-threshold`.**
`alert_rule_threshold_non_negative` garantiza el suelo (`>= 0`); el tope de 365 es de
aplicación y la base aceptaría 10 000 sin quejarse. Quien escriba una prueba de
integración esperando un `23514` por pasarse de largo la verá fallar: ese caso lo
tiene que parar `UpdateAlertRules`.

## 11. Pruebas

**Dominio** — `severity()` en cada umbral y en sus fronteras exactas, incluida
**A-5**: la misma alerta consultada en dos momentos distintos devuelve severidades
distintas sin que nada se haya escrito. `daysUntilDue()` cruzando el cero;
validación de reglas.

**Aplicación** — el evaluador con puertos dobles y `FixedClock`: levanta lo que falta,
resuelve lo que sobra, y **no hace nada en la segunda pasada sobre el mismo estado**
(A-2); una custodia devuelta que resuelve su alerta sola (A-3); un lote vencido sin
saldo que no genera nada (A-4); y el **relevo** de §4 —el lote que cruza su fecha
resuelve `BATCH_EXPIRING` y levanta `BATCH_EXPIRED` en la misma pasada, y nunca
quedan las dos abiertas—.

**Integración** — A-1 bajo concurrencia: dos evaluadores simultáneos sobre la misma
organización producen una sola alerta; una alerta resuelta y vuelta a cumplir se
re-levanta (índice parcial); las dos consultas usan sus índices parciales
(`EXPLAIN`); dos préstamos del mismo producto `QUANTITY` al mismo tenedor, el
primero devuelto con `settlesId`: solo el segundo alerta.

**e2e** — el criterio de éxito 5 de [00](00-vision-y-alcance.md), solo por la API:
prestar con fecha, `POST /v1/alerts/evaluate` con `at` posterior a la fecha, y ver
la custodia en `GET /v1/alerts` como `CUSTODY_OVERDUE`; devolverla con
`settlesId`, evaluar de nuevo, y ver la alerta resuelta.

## 12. Ganchos de extensión

| Extensión | Qué ya lo permite | Qué falta |
|---|---|---|
| **Stock bajo mínimo** | Es una regla más: misma tabla, mismo evaluador, mismo endpoint | `minQuantity` por producto o por posición, y un `AlertKind` nuevo |
| **Sin movimiento en N días** | Igual: una consulta sobre `movement.occurred_at` | Una regla y su consulta |
| **Notificaciones** | `alert.raised` y `alert.resolved` ya se emiten al outbox | Un consumidor por canal, y preferencias por usuario |
| **Umbrales por producto** | Las reglas ya son filas por organización | Ampliar la clave con un ámbito opcional |
| **FEFO en picking** | `Batch.expiresAt` ya está y ya se consulta | Ordenación por vencimiento en la selección de lote, en `inventory` |
| **Silenciar una alerta** | — | Requiere decidir si silenciar corrompe la señal. Ver §5. |

**Stock bajo mínimo entra como una quinta regla y nada más.** Que la funcionalidad
más pedida de cualquier sistema de inventario quepa sin cambiar el modelo es la
justificación de haber unificado vencimiento y custodia en un solo motor.

## 13. Documentos relacionados

- [02 §5, §6](02-modelo-de-dominio.md) · [04 §3.7](04-persistencia.md) · [05](05-eventos-e-integraciones.md) · [07 §6](07-composicion-y-contexto-de-ejecucion.md) · [11](11-catalog.md) · [12](12-inventory.md)
