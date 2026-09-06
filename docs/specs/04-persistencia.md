# 04 — Persistencia

> Cómo el modelo de [02](02-modelo-de-dominio.md) se traduce a PostgreSQL: esquema,
> constraints, aislamiento entre organizaciones e índices.
>
> Este documento es la única fuente de verdad del esquema. Los specs de módulo
> describen sus tablas conceptualmente y referencian aquí.

## 1. Elecciones

| Decisión | Elección | Por qué |
|---|---|---|
| Motor | **PostgreSQL 16+** | Constraints reales (`CHECK`, unique parciales, exclusión), JSONB con índices GIN, RLS nativo, transacciones sin sorpresas. El ledger usa las cuatro cosas. |
| Modelo y migraciones | **Prisma** (solo en desarrollo) | `schema.prisma` es la definición del modelo; `prisma migrate` genera el SQL de cada cambio y lleva el historial. Ni `@prisma/client` ni ningún otro código de Prisma corre en la aplicación. |
| Acceso en ejecución | **Kysely** | SQL explícito y tipado, sin ORM. Sus tipos se generan desde `schema.prisma`, así que el repositorio ve exactamente las tablas que las migraciones crearon. El patrón de uso —DAOs y repositorios— está en [08](08-acceso-a-datos.md). |
| Aislamiento | **`org_id` en toda tabla + RLS + claves foráneas compuestas** | Triple defensa: el repositorio filtra, Postgres filtra las lecturas, y las referencias no pueden cruzar organizaciones. |
| Migraciones | `prisma migrate`, SQL versionado en el repositorio | Una migración por cambio, revisable en el diff y editable a mano donde el schema no llega. |

### Por qué Prisma y Kysely, y no uno solo

Las consultas que definen este producto —el subárbol de nodos por `path`, la
reconciliación del saldo contra el ledger, los upserts de `stock_balance` con
`ON CONFLICT`— son SQL que conviene leer tal cual. El cliente de Prisma las
esconde tras su propio lenguaje y obliga a caer en `$queryRaw` justo donde más
importa la claridad. TypeORM las permite, pero su inferencia de tipos es
notablemente más débil y su capa de entidades empuja a usar las clases del ORM
como modelo de dominio — que es exactamente la contaminación que
[01](01-arquitectura.md) prohíbe.

Lo que sí hace Prisma mejor que nadie es la parte que ocurre **antes** de
ejecutar: un lenguaje de esquema legible, un diff que genera la migración, un
historial con checksum que detecta migraciones alteradas, una shadow database
que comprueba que el historial reproduce el esquema, y un `migrate deploy` con
advisory lock que dos instancias pueden lanzar a la vez sin pisarse. Ese es el
papel de Prisma aquí: **definir el modelo y controlar sus cambios**. Es una
dependencia de desarrollo y de despliegue, nunca de ejecución.

Kysely es lo que corre. Es un constructor de consultas, no un ORM: no tiene
entidades, no impone decoradores, y cada consulta se lee como el SQL que
produce. Los tipos de sus tablas no se escriben a mano: los genera
`prisma-kysely` desde `schema.prisma` en cada `prisma generate`, de modo que el
schema es la **única fuente** tanto de la forma de las tablas como de los tipos
que ve el repositorio. Cambiar una columna sin migrarla, o migrarla sin cambiar
el schema, rompe la compilación.

El costo es honesto: son dos herramientas, y todo lo que el lenguaje de Prisma
no puede expresar —`CHECK`, índices parciales, RLS, `REVOKE`, `NULLS NOT
DISTINCT`— se escribe a mano en el SQL de la migración (§5.1). Se acepta porque
la alternativa —un solo ORM que haga ambas cosas— sacrifica o la claridad de las
consultas o la calidad del control de cambios, y este producto necesita las dos.

## 2. Convenciones

- Tablas y columnas en `snake_case`; el mapeo a camelCase lo hace el
  `CamelCasePlugin` de Kysely. En `schema.prisma` cada modelo lleva
  `@@map("nombre_snake")` y cada campo su `@map`, para que el nombre físico sea
  el de este documento y no el que Prisma derivaría del identificador
- Toda tabla de negocio tiene `id uuid PRIMARY KEY` — **incluida `stock_balance`**,
  cuya clave natural es un índice único aparte (§3.5). Prisma exige que todo
  modelo tenga una clave única sin columnas nulas, y es más barato cumplirlo con
  una convención uniforme que con una excepción
- Claves primarias `uuid`, generadas como UUIDv7 por la aplicación, nunca por la base
- `org_id uuid NOT NULL` en toda tabla de negocio, primera columna tras el id
- Cantidades en `numeric(18,3)` — nunca `float`
- Marcas de tiempo en `timestamptz`, siempre almacenadas en UTC
- Textos libres en `text`; los códigos con longitud acotada usan `varchar(n)`
- `created_at timestamptz NOT NULL DEFAULT now()` en toda tabla
- `updated_at` y `version integer` solo en tablas mutables
- Toda tabla de negocio lleva `UNIQUE (org_id, id)`, y **toda clave foránea hacia
  una tabla de negocio es compuesta**: `(org_id, x_id) REFERENCES x (org_id, id)`.
  En el esquema de §3 las FK se escriben en forma corta por legibilidad; la forma
  compuesta es la que se genera.

**Claves foráneas compuestas.** Postgres **no aplica RLS al comprobar una clave
foránea**: la verificación corre con los privilegios del dueño de la tabla y ve
todas las filas. Con una FK simple, un tenant podría insertar un `movement` cuyo
`product_id` pertenezca a otra organización, y el `INSERT` pasaría — la política
`WITH CHECK` solo mira `movement.org_id`. El repositorio lo evita porque resuelve
producto y nodos con RLS activo antes de insertar, pero I-6 exige que la base lo
garantice por sí sola. Con `(org_id, product_id)` en la FK, la referencia
cruzada es imposible por construcción.

**`numeric` y no `float`.** Un flotante binario no representa exactamente 0.1, y en
un ledger ese error se acumula asiento a asiento hasta que el saldo materializado
deja de coincidir con la suma del histórico. `numeric(18,3)` da tres decimales
—suficiente para gramos y mililitros— con aritmética exacta.

## 3. Esquema

### 3.1 Organización y usuarios

```sql
organization
  id            uuid PRIMARY KEY
  name          text NOT NULL
  slug          varchar(64) NOT NULL UNIQUE
  active        boolean NOT NULL DEFAULT true
  created_at, updated_at, version

app_user
  id            uuid PRIMARY KEY
  org_id        uuid NOT NULL REFERENCES organization(id)
  email         citext NOT NULL
  password_hash text NOT NULL
  name          text NOT NULL
  active        boolean NOT NULL DEFAULT true
  created_at, updated_at, version
  UNIQUE (org_id, email)

user_role
  user_id       uuid NOT NULL REFERENCES app_user(id)
  org_id        uuid NOT NULL
  role          role_enum NOT NULL          -- OWNER | ADMIN | OPERATOR | VIEWER
  PRIMARY KEY (user_id, role)

refresh_token
  id            uuid PRIMARY KEY
  org_id        uuid NOT NULL
  user_id       uuid NOT NULL REFERENCES app_user(id)
  token_hash    varchar(64) NOT NULL UNIQUE   -- SHA-256; el token en claro no se guarda
  expires_at    timestamptz NOT NULL
  revoked_at    timestamptz
  created_at

CREATE INDEX ON refresh_token (user_id) WHERE revoked_at IS NULL;
```

`refresh_token` es lo que hace real la revocación de [10 §4](10-tenancy.md):
`logout` marca `revoked_at`, `RefreshSession` rechaza cualquier fila revocada o
vencida y **rota** el token en cada uso. Sin tabla, "revocar el token de
refresco" sería una frase sin mecanismo.

`citext` para el correo: distinguir mayúsculas en una dirección de email produce
cuentas duplicadas que el usuario no entiende. Requiere `CREATE EXTENSION citext`.

El correo es único **por organización**, no globalmente: la misma persona puede
pertenecer a dos negocios distintos.

### 3.2 Catálogo

```sql
product
  id            uuid PRIMARY KEY
  org_id        uuid NOT NULL
  sku           varchar(64) NOT NULL
  name          text NOT NULL
  description   text
  tracking_mode tracking_mode_enum NOT NULL   -- QUANTITY | LOT | SERIAL
  uom           varchar(16) NOT NULL
  active        boolean NOT NULL DEFAULT true
  custom_fields jsonb NOT NULL DEFAULT '{}'
  created_at, updated_at, version
  UNIQUE (org_id, sku)

product_code
  id            uuid PRIMARY KEY
  org_id        uuid NOT NULL
  product_id    uuid NOT NULL REFERENCES product(id)
  value         varchar(128) NOT NULL
  kind          code_kind_enum NOT NULL
  created_at
  UNIQUE (org_id, value)              -- ← el escaneo nunca puede ser ambiguo

product_media
  id            uuid PRIMARY KEY
  org_id        uuid NOT NULL
  product_id    uuid NOT NULL REFERENCES product(id)
  storage_key   text NOT NULL
  content_type  varchar(64) NOT NULL
  byte_size     bigint NOT NULL
  position      integer NOT NULL DEFAULT 0
  created_at

media_upload                                -- zona de espera de POST /v1/uploads
  id            uuid PRIMARY KEY
  org_id        uuid NOT NULL
  storage_key   text NOT NULL UNIQUE
  content_type  varchar(64) NOT NULL
  byte_size     bigint NOT NULL
  uploaded_by   uuid NOT NULL REFERENCES app_user(id)
  created_at
  claimed_at    timestamptz                 -- cuando ATTACH_MEDIA lo convirtió en product_media

CREATE INDEX ON media_upload (created_at) WHERE claimed_at IS NULL;   -- purga a 24 h

batch
  id            uuid PRIMARY KEY
  org_id        uuid NOT NULL
  product_id    uuid NOT NULL REFERENCES product(id)
  lot_code      varchar(64)
  serial        varchar(128)
  expires_at    timestamptz
  custom_fields jsonb NOT NULL DEFAULT '{}'
  created_at
  UNIQUE (org_id, product_id, lot_code)  -- parcial: WHERE lot_code IS NOT NULL
  UNIQUE (org_id, serial)                -- parcial: WHERE serial IS NOT NULL
  CHECK (lot_code IS NOT NULL OR serial IS NOT NULL)

custom_field_definition
  id            uuid PRIMARY KEY
  org_id        uuid NOT NULL
  entity        custom_entity_enum NOT NULL   -- PRODUCT | NODE | BATCH
  key           varchar(64) NOT NULL
  label         text NOT NULL
  type          custom_type_enum NOT NULL
  options       jsonb
  required      boolean NOT NULL DEFAULT false
  position      integer NOT NULL DEFAULT 0
  created_at, updated_at, version
  UNIQUE (org_id, entity, key)

CREATE INDEX ON product (org_id, active, name);
CREATE INDEX ON product USING gin (custom_fields);     -- filtro por campo custom
CREATE INDEX ON batch (org_id, expires_at)
  WHERE expires_at IS NOT NULL;                        -- barrido de alerts
```

El índice GIN se crea desde el principio aunque el MVP no ofrezca filtrado por
campo custom en la API: añadirlo después sobre una tabla grande exige
`CONCURRENTLY` y una ventana de mantenimiento, mientras que crearlo vacío es
instantáneo.

### 3.3 Nodos

```sql
node
  id            uuid PRIMARY KEY
  org_id        uuid NOT NULL
  kind          node_kind_enum NOT NULL   -- INTERNAL | CUSTODY | TERMINAL | SOURCE
  code          varchar(64) NOT NULL
  name          text NOT NULL
  parent_id     uuid REFERENCES node(id)
  path          text NOT NULL             -- materializado: "BOD-A/Z1/E3/B2"
  active        boolean NOT NULL DEFAULT true
  custom_fields jsonb NOT NULL DEFAULT '{}'
  created_at, updated_at, version
  UNIQUE (org_id, code)
  CHECK (parent_id IS NULL OR kind = 'INTERNAL')          -- I-10

CREATE INDEX ON node (org_id, path text_pattern_ops);     -- consultas de subárbol
CREATE INDEX ON node (org_id, kind) WHERE active;
```

El índice `text_pattern_ops` sobre `path` es lo que hace que
`WHERE path LIKE 'BOD-A/Z1/%'` use índice. Sin él, cada consulta de subárbol es un
recorrido completo de la tabla.

La ausencia de ciclos **no** la impone un constraint: detectar un ciclo requiere
recursión, y un `CHECK` no puede recorrer la tabla. Se valida en el dominio al
reasignar padre, y hay una prueba de invariante que la comprueba sobre datos reales.

### 3.4 El ledger

```sql
movement
  id                  uuid PRIMARY KEY          -- UUIDv7 del cliente
  org_id              uuid NOT NULL
  product_id          uuid NOT NULL REFERENCES product(id)
  batch_id            uuid REFERENCES batch(id)
  from_node_id        uuid NOT NULL REFERENCES node(id)
  to_node_id          uuid NOT NULL REFERENCES node(id)
  quantity            numeric(18,3) NOT NULL
  occurred_at         timestamptz NOT NULL
  recorded_at         timestamptz NOT NULL DEFAULT now()
  actor_id            uuid NOT NULL REFERENCES app_user(id)
  reason              text
  due_at              timestamptz
  reverses_id         uuid REFERENCES movement(id)
  settles_id          uuid REFERENCES movement(id)   -- el check-out que este check-in cierra
  process_instance_id uuid
  trace_id            uuid NOT NULL

  -- desnormalizado desde product y node, solo para hacer cumplibles los CHECK
  tracking_mode       tracking_mode_enum NOT NULL
  from_node_kind      node_kind_enum NOT NULL
  to_node_kind        node_kind_enum NOT NULL

  CHECK (from_node_id <> to_node_id)                                    -- I-1
  CHECK (quantity > 0)                                                  -- I-2
  CHECK ((tracking_mode = 'QUANTITY') = (batch_id IS NULL))             -- I-8
  CHECK (due_at IS NULL OR to_node_kind = 'CUSTODY')                    -- I-11
  CHECK (occurred_at <= recorded_at + interval '5 minutes')             -- I-14
  CHECK (from_node_kind <> 'CUSTODY'
         OR settles_id IS NOT NULL OR reverses_id IS NOT NULL)          -- I-17
  CHECK (settles_id IS NULL OR from_node_kind = 'CUSTODY')              -- I-17

  UNIQUE (org_id, reverses_id)  -- parcial: WHERE reverses_id IS NOT NULL  I-13

CREATE INDEX ON movement (org_id, occurred_at DESC);
CREATE INDEX ON movement (org_id, product_id, occurred_at DESC);
CREATE INDEX ON movement (org_id, from_node_id, occurred_at DESC);
CREATE INDEX ON movement (org_id, to_node_id, occurred_at DESC);
CREATE INDEX ON movement (org_id, to_node_id, due_at)
  WHERE due_at IS NOT NULL;      -- alertas de custodia vencida
CREATE INDEX ON movement (org_id, settles_id)
  WHERE settles_id IS NOT NULL;  -- saldo pendiente de cada check-out
```

**No hay columna de idempotencia.** El mecanismo es la tabla `idempotency_key`
de §3.8 y el `id` generado por el cliente ([07 §5](07-composicion-y-contexto-de-ejecucion.md));
el ledger no sabe qué es una petición HTTP.

**Las cuatro columnas desnormalizadas existen por una sola razón:** un `CHECK` de
Postgres no puede consultar otra tabla, y las invariantes I-8, I-11, I-17 y I-4
son demasiado importantes para dejarlas solo en manos del código de aplicación.
El costo es que si el `tracking_mode` de un producto o el `kind` de un nodo
cambiaran, las filas históricas quedarían desalineadas — y por eso I-15 prohíbe
el primero y `MoveNode` ([12 §4.1](12-inventory.md)) el segundo. Las decisiones
se sostienen mutuamente.

### El saldo de una custodia (I-17, I-18)

`settles_id` es lo que hace que la custodia funcione para productos por
cantidad. Sin él, "¿qué le falta devolver a Juan?" solo tiene respuesta por
agregado —*tiene 1 martillo*— y no por préstamo —*el del lunes ya volvió, el del
viernes no*. La alerta de custodia vencida es por préstamo, así que la pregunta
tiene que poder responderse por préstamo:

```sql
-- pendiente de un check-out c: su cantidad menos lo que lo salda,
-- ignorando los check-ins que a su vez fueron compensados
SELECT c.quantity - COALESCE(SUM(s.quantity), 0)
FROM movement c
LEFT JOIN movement s ON s.org_id = c.org_id AND s.settles_id = c.id
  AND NOT EXISTS (SELECT 1 FROM movement r WHERE r.org_id = s.org_id AND r.reverses_id = s.id)
WHERE c.id = $1
GROUP BY c.quantity;
```

Un check-out compensado (`reverses_id` apuntando a él) cuenta como saldado por
completo; un check-in compensado deja de contar, y el pendiente del préstamo
vuelve a subir. La regla I-18 —la suma de lo que salda un check-out nunca supera su
cantidad— no cabe en un `CHECK` porque es un agregado; la impone el dominio y la
comprueba una prueba de propiedades ([06 §7](06-pruebas-y-calidad.md)).

### Cómo se garantiza la inmutabilidad (I-3)

Tres capas:

1. El repositorio no expone ningún método de actualización o borrado de movimientos.
2. El rol de base de datos de la aplicación tiene `UPDATE` y `DELETE` **revocados**
   sobre `movement`:
   ```sql
   REVOKE UPDATE, DELETE ON movement FROM tubodega_app;
   ```
3. Una prueba de CI comprueba que ese revoke sigue en pie.

La segunda capa es la que importa: convierte un error de programación en un error de
permisos que falla ruidosamente, en vez de en una corrupción silenciosa del
histórico.

### 3.5 Saldos

```sql
stock_balance
  id            uuid PRIMARY KEY                  -- surrogate; ninguna consulta lo usa
  org_id        uuid NOT NULL
  node_id       uuid NOT NULL REFERENCES node(id)
  product_id    uuid NOT NULL REFERENCES product(id)
  batch_id      uuid                              -- NULL para QUANTITY
  node_kind     node_kind_enum NOT NULL           -- desnormalizado
  quantity      numeric(18,3) NOT NULL
  updated_at    timestamptz NOT NULL DEFAULT now()

  UNIQUE (org_id, node_id, product_id, batch_id) NULLS NOT DISTINCT   -- clave natural
  CHECK (quantity >= 0 OR node_kind IN ('SOURCE','TERMINAL'))          -- I-4

CREATE INDEX ON stock_balance (org_id, product_id) WHERE quantity <> 0;
CREATE INDEX ON stock_balance (org_id, node_id)   WHERE quantity <> 0;
```

La clave natural de un saldo es `(org_id, node_id, product_id, batch_id)`, y así
la ve el dominio. Sería la clave primaria si no fuera porque `batch_id` admite
nulos y Prisma exige que todo modelo tenga una clave única compuesta solo por
columnas `NOT NULL`. El `id` existe para cumplir esa regla y nada más: el
repositorio no lo lee, no lo expone y no lo usa en ningún `WHERE`.

`batch_id` forma parte de la clave natural y admite nulos, lo que en Postgres
significa que dos filas con `batch_id` nulo **no colisionan** en un índice único
por defecto. Para productos `QUANTITY` eso rompería la unicidad, así que el índice
usa `NULLS NOT DISTINCT` (disponible desde Postgres 15). Es el detalle que,
omitido, produce filas de saldo duplicadas para exactamente los productos más
comunes del catálogo. Prisma no sabe escribirlo: el `@@unique` se declara en el
schema y la cláusula se añade a mano en la migración (§5.1).

### La escritura del saldo

Un upsert por cada extremo del movimiento, en la misma transacción que lo inserta:

```sql
INSERT INTO stock_balance (id, org_id, node_id, product_id, batch_id, node_kind, quantity)
VALUES ($1, $2, $3, $4, $5, $6, $7)
ON CONFLICT (org_id, node_id, product_id, batch_id)
DO UPDATE SET quantity   = stock_balance.quantity + EXCLUDED.quantity,
              updated_at = now();
```

Con `+quantity` para el destino y `-quantity` para el origen, y un UUIDv7 nuevo
en `$1` que solo sobrevive si la fila no existía. `ON CONFLICT` infiere el índice
único de la clave natural, `NULLS NOT DISTINCT` incluido. Si el resultado deja
negativo un nodo custodiable, el `CHECK` aborta la transacción y el movimiento
completo se deshace. **La imposibilidad de despachar lo que no existe la impone la
base de datos, no una validación previa** — así ninguna ruta nueva de código puede
saltársela.

Para evitar interbloqueos cuando dos transacciones tocan el mismo par de nodos en
orden opuesto, los upserts de una transacción se emiten **ordenados por la clave
natural** `(node_id, product_id, batch_id)`. Es una regla del repositorio y está
cubierta por una prueba de concurrencia.

### 3.6 Proceso

```sql
process_template
  id            uuid PRIMARY KEY
  org_id        uuid NOT NULL
  code          varchar(64) NOT NULL
  version       integer NOT NULL
  steps         jsonb NOT NULL
  active        boolean NOT NULL DEFAULT true
  created_at
  UNIQUE (org_id, code, version)

process_instance
  id                uuid PRIMARY KEY
  org_id            uuid NOT NULL
  template_code     varchar(64) NOT NULL
  template_version  integer NOT NULL
  state             process_state_enum NOT NULL  -- OPEN | COMPLETED | CANCELLED
  current_step_id   varchar(64)
  context           jsonb NOT NULL DEFAULT '{}'
  actor_id          uuid NOT NULL REFERENCES app_user(id)
  created_at, updated_at, version
  FOREIGN KEY (org_id, template_code, template_version)
    REFERENCES process_template (org_id, code, version)

step_completion
  id            uuid PRIMARY KEY
  org_id        uuid NOT NULL
  instance_id   uuid NOT NULL REFERENCES process_instance(id)
  step_id       varchar(64) NOT NULL
  actor_id      uuid NOT NULL
  payload       jsonb NOT NULL
  completed_at  timestamptz NOT NULL DEFAULT now()
  UNIQUE (org_id, instance_id, step_id)
```

`steps` como JSONB y no como tabla relacional: una plantilla se lee siempre entera,
nunca se consulta por paso individual, y su forma va a evolucionar hacia un grafo.
Una tabla `template_step` con `order` obligaría a migrar filas el día que aparezcan
las ramas; el JSONB absorbe ese cambio de forma sin migración estructural.

La clave foránea compuesta hacia `(code, version)` es lo que garantiza que la
versión registrada en la instancia existió de verdad.

### 3.7 Alertas

```sql
alert
  id            uuid PRIMARY KEY
  org_id        uuid NOT NULL
  kind          alert_kind_enum NOT NULL   -- BATCH_EXPIRING | BATCH_EXPIRED
                                           -- CUSTODY_DUE   | CUSTODY_OVERDUE
  subject_type  varchar(32) NOT NULL       -- BATCH | MOVEMENT
  subject_id    uuid NOT NULL
  due_at        timestamptz NOT NULL
  raised_at     timestamptz NOT NULL DEFAULT now()
  resolved_at   timestamptz
  UNIQUE (org_id, kind, subject_type, subject_id)
    WHERE resolved_at IS NULL                                            -- A-1

CREATE INDEX ON alert (org_id, due_at) WHERE resolved_at IS NULL;

alert_rule
  org_id          uuid NOT NULL
  kind            alert_kind_enum NOT NULL
  threshold_days  integer NOT NULL CHECK (threshold_days >= 0)
  enabled         boolean NOT NULL DEFAULT true
  updated_at      timestamptz NOT NULL DEFAULT now()
  PRIMARY KEY (org_id, kind)
```

La unicidad sobre `(kind, subject)` es lo que hace que el evaluador sea idempotente:
puede correr cada minuto sin generar duplicados. Es **parcial sobre las abiertas**
y no total: las resueltas se conservan 90 días, y con un índice total un lote
cuyo stock volvió a cero y luego reingresó no podría re-levantar su alerta —
`ON CONFLICT DO NOTHING` la descartaría en silencio.

### 3.8 Infraestructura

```sql
idempotency_key
  org_id        uuid NOT NULL
  key           varchar(128) NOT NULL
  request_hash  varchar(64) NOT NULL      -- SHA-256 del cuerpo canonicalizado
  status        idem_status_enum NOT NULL -- IN_FLIGHT | COMPLETED
  response_code integer
  response_body jsonb
  created_at    timestamptz NOT NULL DEFAULT now()
  expires_at    timestamptz NOT NULL      -- created_at + 7 días
  PRIMARY KEY (org_id, key)

CREATE INDEX ON idempotency_key (expires_at);
-- Único mecanismo de idempotencia. Secuencia de reserva y confirmación en [07 §5].
-- Una fila IN_FLIGHT con más de 5 minutos se considera abandonada.

outbox_event
  id            uuid PRIMARY KEY
  org_id        uuid NOT NULL
  type          varchar(64) NOT NULL
  payload       jsonb NOT NULL
  trace_id      uuid NOT NULL
  occurred_at   timestamptz NOT NULL DEFAULT now()
  published_at  timestamptz

CREATE INDEX ON outbox_event (published_at, occurred_at) WHERE published_at IS NULL;
```

## 4. Aislamiento entre organizaciones

Dos mecanismos, y ambos son obligatorios.

**Primero, el repositorio filtra.** Todo acceso pasa por un repositorio que añade
`org_id = :currentOrg`. Es la defensa normal.

**Segundo, RLS lo garantiza.** Toda tabla de negocio activa Row Level Security con
la misma política:

```sql
ALTER TABLE movement ENABLE ROW LEVEL SECURITY;
ALTER TABLE movement FORCE ROW LEVEL SECURITY;

CREATE POLICY org_isolation ON movement
  USING      (org_id = current_setting('app.current_org')::uuid)
  WITH CHECK (org_id = current_setting('app.current_org')::uuid);
```

El guard de autenticación fija la variable al inicio de la transacción:

```sql
SET LOCAL app.current_org = '018f3a2b-...';
```

`SET LOCAL` y no `SET`: la variable muere con la transacción, así que una conexión
devuelta al pool no arrastra el contexto de la petición anterior. Con un pool de
conexiones, esa distinción es la diferencia entre aislamiento y una filtración
intermitente imposible de reproducir.

`FORCE ROW LEVEL SECURITY` hace que la política aplique también al dueño de la
tabla. Sin él, RLS no protege nada cuando la aplicación se conecta con un rol
privilegiado.

**Tres roles, no uno.** Definidos en
[07 §2](07-composicion-y-contexto-de-ejecucion.md):

| Rol | `BYPASSRLS` | Quién lo usa |
|---|---|---|
| `tubodega_app` | No | Toda petición autenticada |
| `tubodega_system` | Sí | Login, registro, despachador, evaluador, purgas — lista cerrada |
| `tubodega_migrator` | Dueño de las tablas | Solo `prisma migrate` |

Sin el rol de sistema, el login es imposible: `Authenticate` busca el correo en
todas las organizaciones antes de saber a cuál pertenece, y con `FORCE ROW LEVEL
SECURITY` y `app.current_org` sin fijar, `current_setting` lanza un error. El
despachador de outbox y el evaluador de alertas tienen el mismo problema.
`BYPASSRLS` en un rol aparte, con un pool aparte, es lo que resuelve los tres
sin abrir la puerta al rol de aplicación.

`REVOKE UPDATE, DELETE ON movement` aplica a **ambos** roles de aplicación,
`tubodega_app` y `tubodega_system`. La inmutabilidad no tiene contexto de
excepción.

Una prueba de integración dedicada intenta leer datos de otra organización por cada
tabla, con el filtro del repositorio deliberadamente anulado, y debe recibir cero
filas. Es la prueba que demuestra que la segunda capa existe de verdad.

## 5. Migraciones

El esquema vive en `libs/persistence/prisma/schema.prisma`; las migraciones, en
`libs/persistence/prisma/migrations/`, una carpeta por cambio con su
`migration.sql`. El flujo de un cambio:

```
 1. editar schema.prisma
 2. prisma migrate dev --create-only --name <cambio>   genera el SQL, no lo aplica
 3. completar migration.sql a mano                      lo que el schema no expresa (§5.1)
 4. prisma migrate dev                                  aplica, valida contra la shadow DB,
                                                        regenera los tipos de Kysely
```

Reglas:

- Una migración por cambio lógico, con nombre descriptivo
- **Solo hacia adelante**: sin scripts de reversión. Un error se corrige con una
  migración nueva, igual que un movimiento se corrige con una compensación
- Toda migración es compatible con la versión anterior de la aplicación: primero se
  añade, luego se despliega, luego se retira. Nunca en un solo paso
- Una migración aplicada **no se edita**: Prisma guarda su checksum y rechaza el
  historial si cambia. Lo que se olvidó va en la siguiente
- Se aplican **antes de arrancar**, no al arrancar: `prisma migrate deploy` es el
  primer paso del entrypoint del contenedor, con `DATABASE_URL_MIGRATOR`, y la
  aplicación no se lanza si falla. Prisma no ofrece API programática de
  migración, y tampoco hace falta: `migrate deploy` toma un advisory lock, así
  que dos instancias desplegadas a la vez no compiten
- **Schema y migraciones deben coincidir**, y CI lo comprueba: `prisma migrate
  diff --from-migrations --to-schema-datamodel --exit-code` devuelve distinto de
  cero si el historial de migraciones no reproduce el schema. Es la prueba de que
  nadie editó uno sin el otro ([06 §11](06-pruebas-y-calidad.md))

### 5.1 Qué no cabe en `schema.prisma`

El lenguaje de Prisma cubre tablas, columnas, tipos, enums, claves foráneas
—incluidas las compuestas— e índices. No cubre todo lo que este esquema necesita.
La regla es que **cada objeto se declara donde Prisma lo entiende, y el resto va
en el SQL de la migración**:

| Objeto | Dónde se declara |
|---|---|
| Tablas, columnas, enums, `NOT NULL`, `DEFAULT` | `schema.prisma` |
| `numeric(18,3)`, `timestamptz`, `citext`, `jsonb` | `schema.prisma` — `@db.Decimal(18,3)`, `@db.Timestamptz`, `@db.Citext`, `Json` |
| Claves foráneas compuestas `(org_id, x_id)` | `schema.prisma` — `@relation(fields: [orgId, xId], references: [orgId, id])` |
| Índices totales, incluido `text_pattern_ops` | `schema.prisma` — `@@index([orgId, path(ops: raw("text_pattern_ops"))])` |
| `CREATE EXTENSION citext` | `schema.prisma` — `extensions = [citext]` en el `datasource` |
| Índices y únicos **parciales** (`WHERE …`) | **Ambos**: `@@index` / `@@unique` en el schema, y el predicado añadido a mano en el SQL |
| `NULLS NOT DISTINCT` | **Ambos**: `@@unique` en el schema, la cláusula en el SQL |
| `CHECK` | Solo SQL |
| `ENABLE / FORCE ROW LEVEL SECURITY`, `CREATE POLICY` | Solo SQL |
| `REVOKE UPDATE, DELETE ON movement` | Solo SQL |
| Roles de Postgres (§4) | Fuera de las migraciones: los crea el aprovisionamiento de la base, porque el migrator no debe tener `CREATEROLE` |

Los índices parciales se declaran en **ambos** sitios por una razón concreta:
Prisma compara el schema contra la base que resulta de aplicar las migraciones,
y un índice que existe en la base pero no en el schema lo interpreta como algo
que sobra — la siguiente migración generada lo borraría. Declarado en el schema,
Prisma ve un índice con las mismas columnas, ignora el predicado que no sabe
leer, y no lo toca. Los `CHECK`, las políticas y los `REVOKE` no tienen ese
problema: Prisma no los introspecciona en absoluto y los deja en paz.

Que la mitad de las garantías del esquema vivan en SQL escrito a mano es
precisamente lo que hace imprescindibles dos pruebas de
[06 §5](06-pruebas-y-calidad.md): la que viola cada constraint y espera el
fallo, y la que lee con RLS activo desde otra organización y espera cero filas.
Son las únicas que demuestran que el SQL manual llegó a la base.

## 6. Datos semilla

Al crear una organización, se materializan sus nodos de frontera. Sin ellos, la
partida doble no tendría contra qué asentar:

```
SOURCE   supplier-default    Proveedor sin especificar
SOURCE   adjustment-in       Ajuste positivo
SOURCE   opening-balance     Saldo inicial
TERMINAL sale                Venta
TERMINAL consumption         Consumo interno
TERMINAL shrinkage           Merma
TERMINAL adjustment-out      Ajuste negativo
TERMINAL supplier-return     Devolución a proveedor
```

Más las **seis plantillas de proceso de fábrica** de [13 §6](13-process.md) y
las **cuatro reglas de alerta** con sus umbrales por defecto de
[14 §2](14-alerts.md). Todo en la misma transacción que crea la organización:
una organización a medio sembrar no puede registrar ni un movimiento.

## 7. Rendimiento

Lo que se mide, con datos representativos —un millón de movimientos, cinco mil
productos, quinientos nodos— en [06 — Pruebas y calidad](06-pruebas-y-calidad.md):

| Consulta | Objetivo |
|---|---|
| Saldo de un producto en un nodo | < 5 ms |
| Saldo de todo un subárbol | < 50 ms |
| Últimos 50 movimientos de un producto | < 20 ms |
| Inserción de un movimiento con sus dos upserts | < 15 ms |
| Alertas pendientes de una organización | < 30 ms |

**Particionado del ledger: no en el MVP.** `movement` es la única tabla sin techo de
crecimiento y la candidata natural a particionar por rango de `occurred_at`. No se
hace ahora porque añade complejidad operativa que a un millón de filas no se
justifica. Se deja anotado como el primer movimiento a hacer si las métricas se
degradan, y los índices ya están encabezados por `org_id`, que es lo que mantiene
esa puerta abierta.

## 8. Documentos relacionados

- [02 — Modelo de dominio](02-modelo-de-dominio.md) — el porqué de cada tabla
- [03 — Contrato de API](03-contrato-api.md) — idempotencia
- [05 — Eventos e integraciones](05-eventos-e-integraciones.md) — outbox
- [07 — Composición y contexto de ejecución](07-composicion-y-contexto-de-ejecucion.md) — roles, transacción, idempotencia
- [08 — Acceso a datos](08-acceso-a-datos.md) — cómo se leen y escriben estas tablas
- [10 — Tenancy](10-tenancy.md) — quién fija `app.current_org`
