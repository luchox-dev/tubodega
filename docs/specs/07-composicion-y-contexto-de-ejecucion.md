# 07 — Composición y contexto de ejecución

> Cómo se arma una petición de principio a fin, y bajo qué contexto corre lo que
> no es una petición. Reúne en un solo sitio lo que [01](01-arquitectura.md),
> [03](03-contrato-api.md), [04](04-persistencia.md) y [05](05-eventos-e-integraciones.md)
> mencionaban de pasada — porque al juntarlo aparecían contradicciones.

## 1. Por qué existe este documento

Tres de las propiedades innegociables del sistema no viven en ningún módulo de
dominio: viven en el borde.

- **I-6** (aislamiento) depende de que `SET LOCAL app.current_org` se ejecute
  **dentro de una transacción** y **antes** de cualquier consulta.
- **I-7** (idempotencia) depende de un mecanismo que no es del ledger, sino de
  la capa HTTP.
- **La atomicidad de [01 §7](01-arquitectura.md)** —movimientos, saldos, proceso
  y outbox en una transacción— depende de quién abre esa transacción y cómo la
  reciben los casos de uso.

Repartidas en frases sueltas, estas tres reglas se contradecían: el guard debía
fijar la sesión de Postgres pero la transacción la abría un interceptor que en
Nest corre *después*; el login necesitaba leer `app_user` sin tener organización;
el despachador de outbox debía leer todas las organizaciones con un rol que no
puede saltarse RLS. Este documento las hace compatibles.

## 2. Los tres contextos de ejecución

| Contexto | Quién corre en él | Rol de Postgres | RLS |
|---|---|---|---|
| **Tenant** | Toda petición autenticada | `tubodega_app` | Activo. `app.current_org` fijado desde el token |
| **Sistema** | Login, registro, despachador de outbox, evaluador de alertas, purgas | `tubodega_system` (`BYPASSRLS`) | Saltado por rol; el repositorio filtra igual |
| **Migración** | `prisma migrate deploy`, antes de arrancar | `tubodega_migrator` (dueño de las tablas) | No aplica |

Cada contexto tiene su **propio pool de conexiones** y su propia cadena de
conexión (§9). Un caso de uso no elige contexto: lo recibe. Lo que corre en
contexto de sistema es una **lista cerrada**, enumerada aquí, y añadir algo a esa
lista es una decisión de diseño que se revisa como se revisa una migración:

| Caso de uso / job | Por qué necesita sistema |
|---|---|
| `Authenticate` ([10](10-tenancy.md)) | Busca el correo en todas las organizaciones antes de saber cuál es |
| `RefreshSession` | Resuelve la sesión antes de tener contexto |
| `CreateOrganization` | La organización todavía no existe cuando empieza |
| Despachador de outbox ([05 §3](05-eventos-e-integraciones.md)) | Lee `outbox_event` de todas las organizaciones |
| Evaluador de alertas ([14 §4](14-alerts.md)) | Itera organizaciones; luego abre **una transacción por organización** con `SET LOCAL` |
| Purgas (§6) | Borran por `expires_at`/`published_at`/`resolved_at` en todas las organizaciones |

**El rol de sistema no exime del filtro del repositorio.** El evaluador de
alertas, aunque pueda leerlo todo, fija `app.current_org` en cada pasada por
organización y sus repositorios añaden `org_id = :org` como siempre. `BYPASSRLS`
es lo que hace posible el login y los jobs; el filtro es lo que impide que un
job mezcle organizaciones por descuido.

`Authenticate` es el caso más delicado: lee `app_user` de varias organizaciones
y verifica la contraseña contra cada candidato. Es la **única** lectura de datos
de tenant sin organización fijada en todo el sistema, y por eso se prueba
aparte ([06 §5](06-pruebas-y-calidad.md)).

## 3. Anatomía de una petición

Orden de ejecución en Nest: middleware → guards → interceptores (en orden de
registro) → pipes → handler → interceptores (vuelta) → filtros. El diseño
respeta ese orden en lugar de pelear con él:

```
 1. onRequest              traceId: X-Request-Id si es UUID válido; si no, UUIDv7 nuevo
 2. AuthGuard              verifica firma y expiración del JWT. Sin base de datos.
                           Construye un RequestContext provisional (sub, org, roles del token)
 3. TransactionInterceptor UnitOfWork.run(): abre transacción, SET LOCAL app.current_org,
                           READ ONLY si el método es GET/HEAD
 4. IdentityInterceptor    carga el usuario dentro de la transacción (RLS ya activo):
                           inactivo → 401 invalid-credentials (T-6); roles desde la base,
                           no desde el token. RequestContext definitivo.
 5. IdempotencyInterceptor solo POST no exentos (§5)
 6. Pipes                  validación de DTO; 400 si falla
 7. Handler → caso de uso  con RequestContext explícito
 8. commit                 o rollback si cualquier paso lanzó
 9. Filtro de excepciones  DomainError → problem+json; resto → 500 sin detalles
```

Tres consecuencias que conviene dejar dichas:

- **El guard no toca la base.** Lo que exigía base —comprobar que el usuario
  sigue activo, cargar sus roles vigentes— se movió al paso 4, que ya corre
  dentro de la transacción con RLS activo. Un guard que consultara `app_user`
  sin `app.current_org` fallaría o, peor, tendría que correr en contexto de
  sistema.
- **Toda petición abre transacción, también las lecturas.** `SET LOCAL` solo
  existe dentro de una; sin transacción no hay aislamiento. Las lecturas la
  abren `READ ONLY`, que cuesta lo mismo y convierte un `UPDATE` accidental en
  un error.
- **La autorización por acción se comprueba en el caso de uso**, contra los
  roles cargados en el paso 4 — no contra los del token. Retirar un rol surte
  efecto en la siguiente petición, igual que desactivar al usuario (T-6).

Los roles del token siguen presentes por una razón: permiten rechazar en el
paso 2, sin base, tokens que ni siquiera tienen la forma correcta. Nada más.

## 4. Unidad de trabajo

Un puerto en `libs/common`, el único que `application/` conoce sobre
transacciones:

```ts
interface UnitOfWork {
  /** Abre una transacción si no hay ninguna; si ya hay, abre un SAVEPOINT. */
  run<T>(fn: () => Promise<T>, opts?: { readonly readOnly?: boolean }): Promise<T>;
}
```

**La transacción es ambiental.** `infrastructure/` la propaga con
`AsyncLocalStorage`; los DAOs ([08 §6](08-acceso-a-datos.md)) toman de ahí la
transacción abierta —una `ControlledTransaction`, que es la que sabe abrir
savepoints— y nunca el pool: sin transacción activa, lanzan. Ningún caso de uso recibe ni pasa un handle de transacción:
llama a sus puertos y confía en que están dentro de la misma. Es lo que permite que el doble en
memoria de `UnitOfWork` sea, literalmente, `run: fn => fn()`.

Reglas:

- **El borde abre; los casos de uso no.** Un caso de uso invocado por HTTP ya
  está dentro de `run()`. Los jobs (§6) son los únicos que llaman a `run()` por
  sí mismos, una vez por organización.
- **`run()` anidado es un `SAVEPOINT`.** En Kysely, `savepoint()` y
  `rollbackToSavepoint()` sobre la transacción controlada; el adaptador los
  emite y el caso de uso no los ve. Es lo que resuelve un problema
  concreto de [12 §4.2](12-inventory.md): tras una violación de `CHECK`, la
  transacción de Postgres queda abortada y no admite ni un `SELECT`. Envolviendo
  `applyDelta` en un `run()` interno, el fallo de I-4 revierte solo el savepoint
  y el caso de uso puede leer el saldo disponible para construir
  `insufficient-stock` con `available` y `requested`. Sin savepoint, el único
  mensaje posible sería "no se pudo".
- **Un fallo dentro de `run()` revierte todo lo de ese nivel.** No hay
  transacciones parcialmente confirmadas.

## 5. Idempotencia: un solo mecanismo

La tabla `idempotency_key` de [04 §3.8](04-persistencia.md) es **el único**
mecanismo de idempotencia del sistema. El ledger no sabe de claves HTTP:
`movement` ya no lleva `idempotency_key`, y la invariante I-7 se sostiene sobre
esta tabla más el `id` generado por el cliente ([03 §4](03-contrato-api.md)),
que hace que un reintento que se cuele por cualquier rendija choque contra la
clave primaria.

Tener dos mecanismos —columna en `movement` y tabla— era peor que tener uno:
una petición por lote insertaba N filas con una sola clave, y una clave
reutilizada tras los 7 días de retención chocaba contra la columna permanente
con un 500 en vez de un replay.

### Secuencia

```
 A. Reserva                            transacción corta, propia
    INSERT idempotency_key (org, key, hash, IN_FLIGHT)
      ON CONFLICT DO NOTHING RETURNING *
    · devolvió fila           → seguir
    · no devolvió, COMPLETED  → hash igual: replay con Idempotency-Replayed: true
                                 hash distinto: 409 idempotency-key-reuse
    · no devolvió, IN_FLIGHT  → más reciente que 5 min: 409 idempotency-key-in-flight
                                 más antigua: se toma por abandonada y se re-reserva
 B. Petición                           la transacción de §3
    … handler …
    UPDATE idempotency_key SET status = COMPLETED, response_code, response_body
    COMMIT                             ← respuesta y hecho, juntos o ninguno
 C. Si B falló                         transacción corta, propia
    DELETE idempotency_key WHERE (org, key)   → el cliente puede reintentar
```

La reserva va en su propia transacción para que dos peticiones concurrentes con
la misma clave **se vean**: la segunda encuentra la fila `IN_FLIGHT` y recibe
`409` de inmediato, en vez de bloquearse en el índice hasta que la primera
confirme. La confirmación va en la transacción de la petición para que la
respuesta guardada exista si y solo si el efecto existió.

Los 5 minutos de la regla de abandono cubren el caso del proceso que muere
entre A y C: sin ellos, una clave quedaría `IN_FLIGHT` los 7 días de retención y
el cliente recibiría `409` para siempre por una operación que nunca ocurrió.

### Qué se hashea

`request_hash` es SHA-256 del cuerpo canonicalizado: JSON con claves ordenadas
y sin espacios para `application/json`; los bytes tal cual para `multipart`.
Cabeceras y query no entran: dos reintentos legítimos pueden diferir en ellas.

### Endpoints exentos

Los únicos `POST` que no exigen `Idempotency-Key`, porque corren antes de que
exista organización (§2) y la tabla se indexa por ella:

```
POST /v1/organizations
POST /v1/auth/login
POST /v1/auth/refresh
POST /v1/auth/logout
```

Todo otro `POST` la exige, lo diga o no la tabla de endpoints de su módulo.
La lista de arriba es la excepción; no hay que repetir la regla en cada spec.

## 6. Jobs

Todos corren **dentro del mismo proceso**, en contexto de sistema, con el
puerto `Clock` como única fuente de tiempo:

| Job | Cada | Concurrencia entre instancias | Referencia |
|---|---|---|---|
| Despachador de outbox | 1 s | `FOR UPDATE SKIP LOCKED` | [05 §3](05-eventos-e-integraciones.md) |
| Evaluador de alertas | 5 min | Advisory lock por organización; A-2 lo hace inocuo de todos modos | [14 §4](14-alerts.md) |
| Purga de `idempotency_key` | 1 h | `DELETE … WHERE expires_at < now()` — idempotente | [04 §3.8](04-persistencia.md) |
| Purga de `outbox_event` publicados | 1 h | 30 días desde `published_at` | [05 §3](05-eventos-e-integraciones.md) |
| Purga de `alert` resueltas | 1 h | 90 días desde `resolved_at` | [14 §7](14-alerts.md) |
| Purga de `media_upload` sin reclamar | 1 h | 24 h desde `created_at` | [11 §4](11-catalog.md) |

Un job que toca tablas de negocio por organización —hoy solo el evaluador— abre
`UnitOfWork.run()` **por organización**, fija `SET LOCAL app.current_org` y
termina antes de pasar a la siguiente. Una organización con un fallo no impide
evaluar las demás.

El evaluador además se puede invocar **bajo demanda** con
`POST /v1/alerts/evaluate` ([14 §8](14-alerts.md)), en contexto de tenant y solo
para la organización del token. Es lo que hace que el criterio de éxito 5 de
[00](00-vision-y-alcance.md) sea demostrable por la API pública, sin esperar
cinco minutos ni tocar la base.

## 7. Dónde viven los adaptadores cruzados

Los puertos que un módulo declara y **otro módulo** satisface
—`OrgProvisioner` ([10](10-tenancy.md)), `MovementCounter` y `StockChecker`
([11](11-catalog.md)), `ResolveCodePort`, `FindNodePort`, `MovementRecorder`,
`BatchCreator` ([13](13-process.md)), `ExpiringBatchQuery`, `OverdueCustodyQuery`,
`AlertEnricher` ([14](14-alerts.md))— se implementan en:

```
apps/tubodega/src/adapters/<módulo-que-declara-el-puerto>/
  tenancy/org-provisioner.adapter.ts      → llama a inventory, process y alerts
  catalog/stock-checker.adapter.ts        → llama a inventory
  process/movement-recorder.adapter.ts    → llama a inventory
  ...
```

La regla es simple: **un adaptador cruzado conoce a dos módulos, y el único
sitio donde está permitido conocer a más de uno es la aplicación.**
`libs/persistence` implementa solo puertos de acceso a datos —repositorios,
consultas— y nunca orquesta casos de uso de otro módulo. Ponerlos ahí haría de
`persistence` un segundo módulo raíz.

Un adaptador importa solo barriles (`@app/inventory`), nunca caminos internos
(R-3), y se registra en el módulo raíz junto al puerto que satisface.

## 8. Identificador de traza

`traceId` se toma de `X-Request-Id` **solo si es un UUID válido**; si no, se
genera un UUIDv7. La columna `trace_id` de `movement` y `outbox_event` es
`uuid`, y un cliente que enviara `req-123` rompería toda escritura de la
petición. La respuesta siempre lleva `X-Request-Id` con el valor que se usó,
de modo que el cliente sepa con qué identificador buscar en los logs, haya
enviado uno válido o no.

## 9. Configuración

Todo lo que el sistema lee del entorno, validado al arrancar por
`libs/common/src/config/env.validation.ts` como ya hacen `NODE_ENV` y `PORT`:

| Variable | Tipo | Por defecto | Para |
|---|---|---|---|
| `NODE_ENV` | `development \| production \| test` | `development` | Habilita `at` en `POST /v1/alerts/evaluate` solo en `test` |
| `PORT` | 1-65535 | `3000` | |
| `DATABASE_URL` | URL | — | Pool de tenant, rol `tubodega_app` |
| `DATABASE_URL_SYSTEM` | URL | — | Pool de sistema, rol `tubodega_system` |
| `DATABASE_URL_MIGRATOR` | URL | — | `prisma migrate deploy` antes de arrancar, rol `tubodega_migrator` |
| `SHADOW_DATABASE_URL` | URL | — | Solo desarrollo y CI: shadow database de `prisma migrate dev` y `db:check` |
| `DATABASE_POOL_SIZE` | entero | `10` | Pool de tenant; el de sistema es siempre 3 |
| `JWT_SECRET` | ≥ 32 bytes | — | Firma HS256 |
| `JWT_ACCESS_TTL` | duración | `15m` | |
| `JWT_REFRESH_TTL` | duración | `30d` | |
| `MEDIA_ROOT` | ruta | — | Adaptador de disco de `MediaStorage` |
| `OUTBOX_INTERVAL_MS` | entero | `1000` | |
| `ALERTS_INTERVAL_MS` | entero | `300000` | |
| `RATE_LIMIT_PER_MINUTE` | entero | `600` | Por organización |

Tres cadenas de conexión y no una: los tres roles de §2 tienen privilegios
distintos por diseño, y una sola cadena obligaría a elegir el más privilegiado
para todo — que es exactamente lo que `FORCE ROW LEVEL SECURITY` intenta
impedir.

## 10. Documentos relacionados

- [01 — Arquitectura](01-arquitectura.md) — la capa de composición
- [03 — Contrato de API](03-contrato-api.md) — idempotencia y `traceId`
- [04 — Persistencia](04-persistencia.md) — roles, RLS, tabla `idempotency_key`
- [06 — Pruebas y calidad](06-pruebas-y-calidad.md) — las pruebas del borde
- [08 — Acceso a datos](08-acceso-a-datos.md) — DAOs, unidad de trabajo de Kysely
