# 03 — Contrato de API

> Convenciones que toda la superficie HTTP cumple. Los specs de módulo definen sus
> endpoints; este documento define cómo se comportan todos ellos.
>
> En el MVP la API **es** el producto: no hay interfaz gráfica, así que este
> contrato es el entregable visible y lo que las pruebas e2e ejercitan.

## 1. Forma general

| | |
|---|---|
| Estilo | REST sobre HTTP/1.1 y HTTP/2 |
| Prefijo | `/v1` — versión en la ruta, no en cabecera |
| Formato | `application/json` en peticiones y respuestas correctas |
| Errores | `application/problem+json` (RFC 9457) |
| Codificación | UTF-8 |
| Fechas | ISO 8601 con zona, siempre en UTC: `2026-09-06T14:32:00Z` |
| Decimales | Cadena, no número: `"12.500"` |
| Identificadores | UUIDv7 en formato canónico |

**Los decimales viajan como cadena.** Un `number` de JSON es un flotante de doble
precisión y no representa exactamente todos los decimales; una cantidad de
inventario que se redondea sola es un defecto que aparece meses después y es
imposible de rastrear. La cadena preserva el valor exacto hasta el tipo `numeric`
de Postgres.

## 2. Autenticación y contexto

`Authorization: Bearer <jwt>` en toda petición salvo las de autenticación misma.

El token porta `sub` (usuario), `org` (organización) y `roles`. Un guard verifica
la firma sin tocar la base; un interceptor abre la transacción de la petición y
**fija dentro de ella la variable de sesión de Postgres que activa RLS**, antes
de que ningún caso de uso se ejecute. Ese orden es obligatorio y está detallado
en [07 §3](07-composicion-y-contexto-de-ejecucion.md): `SET LOCAL` fuera de una
transacción no hace nada, y si el caso de uso corre antes de que la sesión esté
marcada, RLS no protege nada.

La organización **nunca** se acepta desde el cuerpo, la ruta ni la query. Viene solo
del token. Un endpoint que reciba `orgId` como parámetro es un defecto de seguridad,
no una comodidad.

## 3. Idempotencia

**Toda escritura no idempotente por naturaleza exige la cabecera
`Idempotency-Key`.** Es decir: obligatoria en `POST`; innecesaria en `PUT`, `PATCH`
y `DELETE`, que ya lo son por definición del método. Los únicos `POST` exentos
son los cuatro que corren antes de que exista organización —registro, login,
refresh, logout— enumerados en [07 §5](07-composicion-y-contexto-de-ejecucion.md).

```http
POST /v1/movements
Idempotency-Key: 018f3a2b-7c4d-7000-8000-a1b2c3d4e5f6
```

Comportamiento:

| Situación | Respuesta |
|---|---|
| Clave nueva | Se procesa, se guarda la respuesta junto a la clave |
| Clave repetida, mismo cuerpo | Se devuelve la respuesta guardada, con `Idempotency-Replayed: true` |
| Clave repetida, cuerpo distinto | `409 Conflict`, tipo `idempotency-key-reuse` |
| Clave ausente en un `POST` | `400 Bad Request`, tipo `missing-idempotency-key` |
| Petición original aún en curso | `409 Conflict`, tipo `idempotency-key-in-flight` |

Una petición "en curso" durante más de 5 minutos se considera abandonada y la
clave se libera. La secuencia de reserva y confirmación —y por qué es el único
mecanismo de idempotencia del sistema— está en
[07 §5](07-composicion-y-contexto-de-ejecucion.md).

La clave es única por organización y se conserva **7 días**. Ese plazo cubre con
holgura cualquier reintento de un cliente con conectividad intermitente, y es la
ventana que un cliente offline necesitará el día que exista.

Esta cabecera es la que convierte *"resiliencia a cortes"* de una promesa en una
garantía: un cliente que pierde la respuesta puede reintentar sin miedo a duplicar
un movimiento de inventario.

## 4. Identificadores generados por el cliente

Los recursos que representan hechos —movimientos, completados de paso— aceptan su
`id` en el cuerpo. El cliente genera un **UUIDv7** y el servidor lo respeta.

```jsonc
POST /v1/movements
{
  "id": "018f3a2b-7c4d-7000-8000-a1b2c3d4e5f6",   // opcional; se genera si falta
  "productId": "...",
  "quantity": "12.500"
}
```

UUIDv7 y no v4 porque incorpora marca de tiempo: los índices no se fragmentan al
insertar y el orden de clave primaria se aproxima al orden temporal, que es como se
consultan los movimientos.

Junto con la idempotencia, esto es la mitad del trabajo de un cliente offline: poder
nombrar un hecho antes de que el servidor lo conozca.

## 5. Errores

`application/problem+json` según RFC 9457:

```jsonc
{
  "type": "https://tubodega.app/errors/insufficient-stock",
  "title": "Existencias insuficientes",
  "status": 422,
  "detail": "El nodo BOD-A/Z1/E3/B2 tiene 3 unidades de SKU-001; se pidieron 10.",
  "instance": "/v1/movements",
  "traceId": "018f3a2b-7c4d-7000-8000-a1b2c3d4e5f6",
  "errors": [
    { "pointer": "/quantity", "code": "insufficient-stock",
      "available": "3.000", "requested": "10.000" }
  ]
}
```

`type` es el identificador estable —lo que un cliente compara— y es el único campo
que no cambia entre versiones. `title` y `detail` son para humanos y pueden
traducirse o reescribirse. `errors` acompaña a los fallos de validación, con
`pointer` en formato JSON Pointer.

### Códigos de estado

| Código | Cuándo |
|---|---|
| `200` | Lectura, o escritura que no crea recurso |
| `201` | Recurso creado; `Location` apunta a él |
| `204` | Borrado o acción sin cuerpo de respuesta |
| `400` | Petición malformada: JSON inválido, cabecera obligatoria ausente |
| `401` | Sin credenciales o token inválido |
| `403` | Autenticado, pero sin permiso para esta acción |
| `404` | No existe, **o existe en otra organización** |
| `409` | Conflicto de estado: idempotencia, versión, código duplicado |
| `422` | Sintaxis correcta, regla de dominio violada |
| `429` | Límite de tasa superado |
| `500` | Error no previsto; nunca expone detalles internos |

**`404` y no `403` para recursos de otra organización.** Un `403` confirmaría que el
recurso existe, que ya es una filtración. Desde fuera de una organización, sus datos
son indistinguibles de datos inexistentes.

La distinción entre `400` y `422` es firme: `400` es *"no entiendo tu petición"*;
`422` es *"la entiendo perfectamente y el dominio la rechaza"*. Despachar 10 de algo
que tiene 3 es `422`, no `400`.

## 6. Paginación

Cursor, nunca offset:

```http
GET /v1/products?limit=50&cursor=eyJpZCI6IjAxOGYzYTJi...
```

```jsonc
{
  "data": [ /* ... */ ],
  "page": { "nextCursor": "eyJpZCI6...", "hasMore": true }
}
```

`limit` por defecto 50, máximo 200. El cursor es opaco —base64 de la última clave de
orden— y el cliente no debe interpretarlo.

Cursor y no offset porque el ledger crece mientras se pagina: con `OFFSET`, insertar
filas durante el recorrido hace que el cliente salte o repita registros. Además
`OFFSET` degrada linealmente, y estas colecciones no tienen techo.

## 7. Convenciones de nombres

- Colecciones en plural y en kebab-case: `/v1/products`, `/v1/stock-balances`
- Campos JSON en camelCase: `productId`, `occurredAt`
- Sin verbos en la ruta. Las acciones que no son CRUD son subrecursos:
  `POST /v1/process-instances/{id}/steps/{stepId}/complete`
- Los enum viajan en `SCREAMING_SNAKE_CASE`: `"INTERNAL"`, `"QUANTITY"`

## 8. Filtrado y orden

Parámetros de query planos, sin lenguaje de consulta propio:

```http
GET /v1/movements?productId=...&nodeId=...&from=2026-09-01T00:00:00Z&sort=-occurredAt
```

`sort` acepta un campo con `-` opcional para descendente. Cada spec de módulo
declara **qué campos admite filtrar y ordenar**; lo no declarado se rechaza con
`400`. Aceptar filtros arbitrarios abre la puerta a consultas sin índice que tumban
la base de datos, y hace imposible razonar sobre el rendimiento.

## 9. Concurrencia

Los recursos mutables —producto, nodo, definición de campo, usuario— llevan
`version` entero. Las actualizaciones exigen `If-Match` con esa versión:

```http
PATCH /v1/products/{id}
If-Match: "3"
```

Versión distinta, `409 Conflict` con tipo `stale-version`.

Los movimientos no necesitan nada de esto: son inmutables, así que no hay
actualización perdida posible.

## 10. OpenAPI

El documento se genera desde el código con `@nestjs/swagger` y se sirve en
`/v1/openapi.json`. Requisitos:

- Todo endpoint declara sus respuestas de error, no solo la exitosa
- Todo esquema lleva ejemplo
- El documento generado se versiona en el repositorio y **un cambio no intencionado
  rompe CI**, para que ninguna modificación del contrato pase inadvertida

## 11. Límites de tasa

Por organización, con ventana deslizante. Cabeceras `RateLimit-Limit`,
`RateLimit-Remaining` y `RateLimit-Reset` en toda respuesta. Al superarse, `429`
con `Retry-After`.

Los límites concretos no se fijan aquí: dependen del plan comercial, que aún no
existe. La infraestructura sí entra en el MVP, con un límite generoso por defecto.

## 12. Observabilidad

Toda petición lleva `traceId`: se toma de la cabecera `X-Request-Id` **si es un
UUID válido**, o se genera un UUIDv7. La respuesta siempre devuelve
`X-Request-Id` con el valor usado. Aparece en la respuesta de error, en todo
registro de log de esa petición, y en los eventos de outbox que la petición
origine. Es lo que permite reconstruir qué pasó a partir de un reporte de
usuario. La validación existe porque `trace_id` se persiste como `uuid`
([04 §3.4](04-persistencia.md)) y un valor libre rompería la escritura.

## 13. Documentos relacionados

- [01 — Arquitectura](01-arquitectura.md) — la capa de composición HTTP
- [04 — Persistencia](04-persistencia.md) — tabla de claves de idempotencia
- [05 — Eventos e integraciones](05-eventos-e-integraciones.md)
- [07 — Composición y contexto de ejecución](07-composicion-y-contexto-de-ejecucion.md) — el orden del borde, la idempotencia en detalle
- [10 — Tenancy](10-tenancy.md) — autenticación y resolución de contexto
