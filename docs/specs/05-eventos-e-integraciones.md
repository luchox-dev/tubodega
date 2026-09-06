# 05 — Eventos e integraciones

> Cómo el sistema cuenta lo que le pasa, y por qué esa costura es lo único que hace
> falta hoy para que las integraciones de mañana no sean un rediseño.

## 1. El problema que resuelve

Un WMS no vive solo. Antes o después tiene que avisarle a un ERP que llegó
mercancía, a un e-commerce que el stock cambió, o a WhatsApp que un lote se vence.

La forma barata de hacerlo —llamar al webhook desde el caso de uso— es una trampa
con tres puertas. Si la llamada falla, ¿se deshace el movimiento? Si el movimiento
se deshace después de la llamada, ¿cómo se retracta el aviso? Y cuando haya
veinte integraciones, ¿cada caso de uso conoce a las veinte?

La respuesta es no llamar a nadie. **El caso de uso escribe un hecho en una tabla,
dentro de su propia transacción. Quién lo lea y qué haga con él es problema de otro.**

## 2. El patrón outbox

```
┌─────────────────── una transacción ────────────────────┐
│  INSERT movement                                        │
│  UPSERT stock_balance  ×2                               │
│  UPDATE process_instance                                │
│  INSERT outbox_event                                    │
└─────────────────────────────────────────────────────────┘
                          │
                          │  (después, fuera de la transacción)
                          ▼
                    despachador
                          │
        ┌─────────────────┼─────────────────┐
        ▼                 ▼                 ▼
      log             webhooks          integraciones
    (el MVP)          (futuro)           (futuro)
```

La propiedad que se compra: **el evento existe si y solo si el hecho ocurrió.** No
hay estado posible donde el stock cambió y nadie se enteró, ni donde se avisó de
algo que se deshizo. Sin outbox, esa garantía exige transacciones distribuidas.

En el MVP el despachador marca los eventos como publicados y los escribe en el log.
Eso parece poco, y lo es a propósito: lo que importa es que **el productor ya está
en su sitio definitivo**. Añadir webhooks es escribir un consumidor nuevo, sin tocar
una sola línea de ningún caso de uso.

## 3. El despachador

Un job dentro del mismo proceso, cada segundo, en contexto de sistema
([07 §6](07-composicion-y-contexto-de-ejecucion.md)) — lee eventos de todas las
organizaciones, y con el rol de tenant no vería ninguno:

```sql
SELECT * FROM outbox_event
WHERE published_at IS NULL
ORDER BY occurred_at
LIMIT 100
FOR UPDATE SKIP LOCKED;
```

`FOR UPDATE SKIP LOCKED` permite que varias instancias de la aplicación consuman en
paralelo sin coordinarse ni procesar lo mismo dos veces. Es la razón por la que este
diseño no necesita una cola de mensajes: Postgres ya la tiene.

**Garantía: al menos una vez.** Si el proceso muere entre publicar y marcar, el
evento se reenvía. Los consumidores deben ser idempotentes, y el `id` del evento es
lo que se lo permite. Exactamente-una-vez requeriría coordinación con el destino y
no vale su precio.

**Orden: por organización y por agregado, no global.** Los eventos de un mismo
producto llegan en orden; los de dos productos distintos pueden cruzarse. Prometer
orden total obligaría a un consumidor secuencial y convertiría el despachador en
cuello de botella.

Los eventos publicados se retienen **30 días** y luego se purgan. Son una costura de
integración, no el histórico: el histórico es el ledger, y ese es permanente.

## 4. Catálogo de eventos

Sobre este catálogo se apoyan [12](12-inventory.md), [13](13-process.md) y
[14](14-alerts.md). Nombre en pasado, porque un evento describe algo que ya ocurrió
y no se puede rechazar.

### Inventario

| Tipo | Cuándo | Carga |
|---|---|---|
| `stock.moved` | Se registra un movimiento | movimiento completo, más los saldos resultantes en origen y destino |
| `stock.reversed` | Se registra una compensación | el movimiento compensador y el `id` del original |
| `stock.balance_changed` | El saldo de un par (nodo, producto) **en un nodo custodiable** cruza cero en cualquier dirección | posición, cantidad anterior y nueva |

`stock.balance_changed` está separado de `stock.moved` porque responde a otra
pregunta. Un e-commerce no quiere enterarse de cada traslado interno; quiere saber
cuándo algo pasó a estar agotado o volvió a haber. Emitirlo solo al cruzar cero
evita inundar al consumidor con ruido que no le sirve. Se limita a nodos
custodiables porque los de frontera cruzan cero por diseño —`SOURCE:ajuste`
empieza en cero y baja para siempre— y su "agotado" no significa nada.

### Custodia

| Tipo | Cuándo |
|---|---|
| `custody.checked_out` | Movimiento hacia un nodo `CUSTODY` |
| `custody.checked_in` | Movimiento desde un nodo `CUSTODY`; lleva `settlesId` y el pendiente que le queda al préstamo |

### Tenencia

| Tipo | Cuándo |
|---|---|
| `organization.created` | Tras el aprovisionamiento completo |
| `user.created` · `user.roles_changed` · `user.deactivated` | |

### Catálogo

| Tipo | Cuándo |
|---|---|
| `product.created` · `product.updated` · `product.deactivated` | |
| `batch.created` | También cuando lo crea un proceso vía `CREATE_BATCH` |
| `custom_field.defined` | |
| `node.created` · `node.updated` · `node.moved` · `node.deactivated` | `node.moved` es cambio de padre |

### Proceso

| Tipo | Cuándo |
|---|---|
| `process.started` | Se abre una instancia |
| `process.step_completed` | Se completa un paso |
| `process.completed` | La instancia llega al final |
| `process.cancelled` | Se abandona |

### Alertas

| Tipo | Cuándo |
|---|---|
| `alert.raised` | El evaluador levanta una alerta |
| `alert.resolved` | La condición deja de cumplirse |

## 5. Forma del evento

```jsonc
{
  "id": "018f3a2b-7c4d-7000-8000-a1b2c3d4e5f6",
  "type": "stock.moved",
  "occurredAt": "2026-09-06T14:32:00Z",
  "orgId": "018f3a2b-...",
  "traceId": "018f3a2b-...",
  "data": {
    "movementId": "018f3a2b-...",
    "productId": "018f3a2b-...",
    "batchId": null,
    "fromNodeId": "018f3a2b-...",
    "toNodeId": "018f3a2b-...",
    "quantity": "12.500",
    "actorId": "018f3a2b-...",
    "balances": [
      { "nodeId": "018f...", "productId": "018f...", "quantity": "87.500" },
      { "nodeId": "018f...", "productId": "018f...", "quantity": "12.500" }
    ]
  }
}
```

La envoltura —`id`, `type`, `occurredAt`, `orgId`, `traceId`— es idéntica en todos.
Lo específico vive en `data`. Un consumidor puede enrutar sin conocer el tipo
concreto, y `traceId` conecta el evento con la petición HTTP que lo originó, que es
lo que hace depurable una integración.

**Los eventos llevan datos, no solo identificadores.** Un evento que dijera solo
`{"movementId": "..."}` obligaría al consumidor a llamar de vuelta por cada evento,
convirtiendo cada integración en una tormenta de peticiones. El costo es que el
evento puede quedar desactualizado respecto al estado presente — aceptable, porque
describe un momento pasado, no el ahora.

## 6. Compatibilidad

Los eventos son un contrato público desde el momento en que exista el primer
consumidor. Las reglas:

- **Añadir un campo opcional a `data` es compatible.** Se puede hacer siempre.
- **Quitar o renombrar un campo no lo es.** Exige un tipo nuevo.
- **Cambiar el significado de un campo no lo es**, aunque el nombre y el tipo se
  mantengan. Es la ruptura más peligrosa porque no falla: produce datos incorrectos
  en silencio.
- Un tipo nuevo convive con el anterior hasta que ningún consumidor lo use.

Los tipos se versionan en el nombre solo si llega a hacer falta: `stock.moved.v2`.
No se versiona por adelantado.

## 7. Webhooks (futuro, no en el MVP)

Se documenta aquí para dejar constancia de que el diseño actual lo soporta sin
cambios en el productor.

```
webhook_subscription
  id, org_id
  url, secret
  event_types    text[]
  active
  created_at

webhook_delivery
  id, org_id, subscription_id, event_id
  attempt, status_code, error
  delivered_at, next_retry_at
```

Firma `HMAC-SHA256` del cuerpo en la cabecera `X-Tubodega-Signature`, con la marca
de tiempo incluida en la firma para impedir reenvíos maliciosos. Reintentos con
retroceso exponencial: 1s, 10s, 1m, 10m, 1h, 6h — y después, suspensión de la
suscripción con aviso.

**Lo único que cambia respecto al MVP es el consumidor del outbox.** Ni los casos de
uso, ni las tablas de negocio, ni el catálogo de eventos.

## 8. Integración entrante (futuro)

La dirección contraria —que un sistema externo escriba en tubodega— no necesita
mecanismo propio: **es la API pública**. Un ERP que quiera registrar una recepción
llama a `POST /v1/movements` con su `Idempotency-Key`, igual que cualquier cliente.

Es la ventaja de haber hecho el MVP solo-API: el contrato de integración y el
contrato de la aplicación son el mismo, así que no hay una segunda superficie que
mantener ni que documentar aparte.

## 9. Documentos relacionados

- [01 — Arquitectura](01-arquitectura.md) — la transacción de request
- [03 — Contrato de API](03-contrato-api.md) — idempotencia y `traceId`
- [04 — Persistencia](04-persistencia.md) — tabla `outbox_event`
- [07 — Composición y contexto de ejecución](07-composicion-y-contexto-de-ejecucion.md) — el despachador como job de sistema
- [90 — Extensiones previstas](90-extensiones-previstas.md)
