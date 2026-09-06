# 08 — Acceso a datos

> Cómo se usa Kysely por debajo de los puertos de salida que cada módulo declara
> en `application/`. Define la librería `libs/persistence`, el patrón DAO genérico
> inspirado en la API de Prisma, y la frontera entre lo que el genérico resuelve y
> lo que cada tabla escribe a mano.
>
> [04](04-persistencia.md) dice qué tablas existen y [07](07-composicion-y-contexto-de-ejecucion.md)
> quién abre la transacción. Este documento dice cómo se leen y escriben las filas.

## 1. Una sola librería

Todo el acceso a datos —el `schema.prisma`, las migraciones, los tipos generados,
los modelos, los DAOs y los adaptadores que implementan los puertos de los
módulos— vive en **una única librería Nest**, `libs/persistence`. La aplicación
la registra en su módulo raíz y nadie más la importa (R-4 de
[01 §5](01-arquitectura.md)).

| Decisión | Por qué |
|---|---|
| Una librería, no una carpeta `infrastructure/` por módulo | Es lo que permite que un segundo servicio —cuando el monolito se parta— importe el esquema, los tipos y los DAOs enteros, sin duplicar ni una tabla. Un módulo de dominio no sabe que Kysely existe; solo `persistence` lo sabe, y por eso es el único sitio donde puede vivir el código que lo usa (R-1). |
| Los adaptadores de repositorio viven aquí, no en el módulo que declara el puerto | Un adaptador de `UserRepository` conoce `UserDao`, y `UserDao` conoce Kysely. Ponerlo en `libs/tenancy` obligaría a `tenancy` a importar `persistence`, que es exactamente la inversión de dependencias que R-4 prohíbe. |
| DAO por tabla, repositorio por agregado | El DAO habla de filas y columnas; el repositorio habla de entidades e invariantes. Son vocabularios distintos y mezclarlos en una clase produce métodos que devuelven filas a un caso de uso. |

```
libs/persistence/
  prisma/
    schema.prisma                 definición del modelo                 [04 §5]
    migrations/                   SQL versionado, editable a mano       [04 §5.1]
  src/
    generated/db.ts               tipos de tabla, generados por prisma-kysely (gitignored)
    models/                       UserModel, NewUser, UserPatch …        §2
    kysely/
      kysely.factory.ts           un Kysely<DB> por pool: tenant y sistema
      transaction.context.ts      AsyncLocalStorage con la transacción activa
      kysely.unit-of-work.ts      implementa UnitOfWork de common        [07 §4]
    dao/
      base/                       interfaces, clases abstractas, DSL, errores   §3–§6
      user.dao.ts, node.dao.ts …  una concreción por tabla de [04 §3]
    repositories/                 user.repository.ts implements UserRepository …
    persistence.module.ts         PersistenceModule: provee y exporta todo lo anterior
    index.ts                      barril: lo que apps/tubodega registra, nada más
```

## 2. Modelos

Los tipos de cada tabla los genera `prisma-kysely` desde `schema.prisma` en cada
`prisma generate`, como una interfaz `DB` con una clave por tabla. En el código
todo es camelCase —`appUser`, `orgId`, `createdAt`— y el `CamelCasePlugin` de
Kysely lo traduce al `snake_case` físico de [04 §2](04-persistencia.md). Nadie
escribe un nombre de columna en `snake_case` fuera de una migración.

Por cada tabla se exportan tres alias, derivados con los utilitarios de Kysely:

```ts
type UserModel = Selectable<DB['appUser']>;   // lo que devuelve un SELECT
type NewUser   = Insertable<DB['appUser']>;   // lo que acepta un INSERT: los Generated<> son opcionales
type UserPatch = Updateable<DB['appUser']>;   // lo que acepta un UPDATE: todo opcional
```

El sufijo distingue el papel: `Model` es una fila que existe, `New` una que va a
existir, `Patch` un cambio parcial. Los tres se derivan del mismo tipo generado,
así que una columna nueva en el schema aparece en los tres sin tocar nada.

**Los modelos no salen de `libs/persistence`.** El adaptador de repositorio
convierte `UserModel` en la entidad `User` de [10 §2](10-tenancy.md) y viceversa.
Un caso de uso que reciba un `UserModel` es un defecto: significa que una fila de
tabla cruzó la frontera que [01 §2](01-arquitectura.md) traza entre
`infrastructure/` y `application/`.

## 3. La jerarquía DAO

Un DAO es un objeto por tabla que sabe leer y escribir sus filas. Lo genérico
—buscar por clave, filtrar, paginar, insertar, actualizar, borrar— se escribe una
vez; lo específico —`findByEmailGlobal`, `settledQuantity`, `updateSubtreePaths`—
lo escribe cada concreción.

```
IReadDao<E, T>           findUnique · findUniqueOrThrow · findManyByIds · findFirst
                         findMany · findPage · count · exists
IAppendDao<E, T>         + create · createMany
IBaseDao<E, T>           + update · updateMany · upsert · delete · deleteMany

IOrgReadDao<E, T>  ·  IOrgAppendDao<E, T>  ·  IOrgDao<E, T>
                         las mismas firmas, con `orgId: OrgId` como primer parámetro

AbstractReadDao  ─▶  AbstractAppendDao  ─▶  AbstractBaseDao
AbstractOrgReadDao ─▶ AbstractOrgAppendDao ─▶ AbstractOrgDao
```

**`E`** es el tipo de la clave: `string` cuando la tabla tiene `id`, y un objeto
cuando la clave es compuesta —`{ userId; role }` para `user_role`. En la familia
Org, `E` **excluye** `orgId`: `alert_rule` tiene clave `(org_id, kind)` y su `E`
es `{ kind }`, porque el `orgId` llega siempre por parámetro.

**`T`** es el modelo, `Selectable` de la tabla. Las clases abstractas reciben
además el nombre literal de la tabla —`AbstractBaseDao<'appUser', string>`—
porque Kysely lo necesita para tipar cada consulta; de ahí deriva `T`, y la
interfaz que ven los consumidores sigue siendo `IBaseDao<E, T>`.

### Tres capas, no una

La inmutabilidad del ledger (I-3) no se defiende solo con un `REVOKE`: un DAO de
`movement` con `update` heredado tendría el método en su tipo y alguien acabaría
llamándolo. Por eso la jerarquía tiene tres escalones, y cada tabla hereda del
que le corresponde:

| Tabla | Base | `E` |
|---|---|---|
| `organization` | `AbstractBaseDao` | `string` |
| `app_user`, `refresh_token`, `product`, `product_code`, `product_media`, `media_upload`, `batch`, `custom_field_definition`, `node`, `stock_balance`, `process_template`, `process_instance`, `alert` | `AbstractOrgDao` | `string` |
| `user_role` | `AbstractOrgDao` | `{ userId; role }` |
| `alert_rule` | `AbstractOrgDao` | `{ kind }` |
| `idempotency_key` | `AbstractOrgDao` | `{ key }` |
| `movement`, `step_completion` | `AbstractOrgAppendDao` | `string` |
| `outbox_event` | `AbstractOrgAppendDao`, más `markPublished` como método concreto | `string` |

`MovementDao` no tiene `update` ni `delete` **en el tipo**. Es la primera capa de
I-3 de [04 §3.4](04-persistencia.md), y hay una prueba de tipo que lo comprueba (§8).

### La familia Org

Casi toda tabla lleva `org_id`, y [04 §4](04-persistencia.md) exige que el
repositorio lo filtre además de RLS. La familia Org convierte esa exigencia en
firma: no existe un `findMany` sin `orgId`, y el genérico lo añade al `WHERE` de
toda lectura y al `INSERT` de toda escritura.

Se implementa **por composición**, no por herencia: un `AbstractOrgDao` envuelve
un DAO plano cuya clave es `E & { orgId }` y fusiona `{ orgId }` en cada `where`
y cada `create`. TypeScript no admite que una subclase añada un parámetro a un
método heredado —la firma deja de ser compatible—, y la composición evita
duplicar el CRUD: la lógica de consultas y del DSL existe una sola vez, en la
familia plana.

La consecuencia importante es que **el genérico Org no puede cruzar
organizaciones**. Lo que necesita hacerlo —el login que busca un correo en todas
las organizaciones, el despachador de outbox, las purgas— es un método concreto,
escrito con Kysely, en la lista cerrada de [07 §2](07-composicion-y-contexto-de-ejecucion.md).
Añadir una operación entre organizaciones exige escribirla a mano, y ese es el
momento en que alguien pregunta si debe existir.

### Lo que declara una concreción

```ts
@Injectable()
export class UserDao extends AbstractOrgDao<'appUser', UserId> {
  protected readonly table     = 'appUser';
  protected readonly idColumns = ['id'] as const;    // por defecto; se omite
  protected readonly versioned = true;               // tiene columna version

  constructor(ctx: TransactionContext) { super(ctx); }

  /** Contexto de sistema: la única lectura sin organización de [07 §2]. */
  findByEmailGlobal(email: string): Promise<UserModel[]> {
    return this.db.selectFrom('appUser')
      .where('email', '=', email).where('active', '=', true)
      .selectAll().execute();
  }
}
```

Tres propiedades y los métodos exclusivos. Nada más. Un DAO concreto que
reimplemente `findMany` está diciendo que el genérico no sirve, y eso se arregla
en el genérico.

**Sin joins en el genérico.** Un DAO conoce una tabla. Una consulta que cruce dos
—el saldo pendiente de una custodia, los nodos de un subárbol con su saldo— es un
método concreto del DAO que la posee, o una consulta del repositorio. Replicar el
`include` de Prisma sobre Kysely costaría más que todos los joins del sistema
escritos a mano.

## 4. El contrato

```ts
interface IReadDao<E, T> {
  findUnique(id: E, opts?: { select?: Cols<T> }): Promise<T | null>;
  findUniqueOrThrow(id: E): Promise<T>;                  // RecordNotFoundError
  findManyByIds(ids: E[]): Promise<T[]>;                 // IN, o IN sobre tuplas si E es compuesta
  findFirst(args?: FindArgs<T>): Promise<T | null>;
  findMany(args?: FindManyArgs<T>): Promise<T[]>;        // take / skip: offset
  findPage(args: FindPageArgs<T>): Promise<Page<T>>;     // keyset con cursor opaco
  count(where?: WhereInput<T>): Promise<number>;
  exists(where?: WhereInput<T>): Promise<boolean>;       // SELECT 1 … LIMIT 1
}

interface IAppendDao<E, T> extends IReadDao<E, T> {
  create(data: New<T>): Promise<T>;                      // INSERT … RETURNING *
  createMany(data: New<T>[]): Promise<T[]>;              // un INSERT multi-fila, en lotes de 1000
}

interface IBaseDao<E, T> extends IAppendDao<E, T> {
  update(id: E, data: Patch<T>, opts?: { expectedVersion?: number }): Promise<T>;
  updateMany(where: WhereInput<T>, data: Patch<T>): Promise<number>;
  upsert(id: E, create: New<T>, update: Patch<T>): Promise<T>;   // ON CONFLICT (idColumns)
  delete(id: E): Promise<T>;                             // DELETE … RETURNING *
  deleteMany(where: WhereInput<T>): Promise<number>;
}

// IOrgReadDao, IOrgAppendDao, IOrgDao: idénticas, con `orgId: OrgId` como primer parámetro.
```

```ts
interface FindArgs<T> {
  where?: WhereInput<T>;
  orderBy?: OrderBy<T>;
  select?: Cols<T>;                    // estrecha el retorno a Pick<T, K>
}
interface FindManyArgs<T> extends FindArgs<T> { take?: number; skip?: number }
interface FindPageArgs<T> {
  where?: WhereInput<T>;
  orderBy?: OrderBy<T>;                // una sola columna; `id` es siempre el desempate
  take: number;
  cursor?: Cursor;                     // el Cursor opaco de [01 §4]
}
type OrderBy<T> = { [K in keyof T]?: 'asc' | 'desc' } | Array<{ [K in keyof T]?: 'asc' | 'desc' }>;
```

### Correspondencia con Prisma

La API se parece a la de Prisma a propósito: es la que más gente conoce y la que
menos hay que explicar. Las diferencias son deliberadas.

| Prisma | Aquí | Diferencia |
|---|---|---|
| `findUnique({ where: { id } })` | `findUnique(id)` | Solo por clave primaria. Buscar por otro único es un método concreto (`findBySku`) |
| `findFirst`, `findMany`, `count` | igual | `where` con el DSL de §5, no el de Prisma |
| `create`, `createMany` | igual | `createMany` **devuelve las filas**, como `createManyAndReturn`; `RETURNING` es gratis en Postgres |
| `update({ where, data })` | `update(id, data, { expectedVersion })` | Por clave, con bloqueo optimista integrado |
| `upsert({ where, create, update })` | `upsert(id, create, update)` | Solo sobre la clave primaria. Un `ON CONFLICT` sobre otro índice —el de `stock_balance`— es un método concreto |
| `delete`, `deleteMany` | igual | `delete` devuelve la fila borrada |
| `include`, `select` anidado | no existe | Un DAO, una tabla. Los joins se escriben |
| `aggregate`, `groupBy` | no existe | Kysely directo en un método concreto |
| `cursor` de `findMany` | `findPage` | Keyset real con cursor opaco, no el cursor posicional de Prisma |

### Bloqueo optimista

Las tablas mutables llevan `version` y la API exige `If-Match`
([03 §9](03-contrato-api.md)). Si la concreción declara `versioned = true`,
`update` con `expectedVersion` emite:

```sql
UPDATE app_user SET …, version = version + 1, updated_at = now()
WHERE id = $1 AND org_id = $2 AND version = $3
RETURNING *;
```

Cero filas afectadas tiene dos causas, y el DAO las distingue con una segunda
lectura por clave: si la fila no existe, `RecordNotFoundError`; si existe con
otra versión, `VersionConflictError`, que el filtro de excepciones traduce al
`409 stale-version` del contrato. Sin `expectedVersion`, `update` incrementa
`version` igualmente: una escritura sin condición sigue siendo una versión nueva.

### Paginación

`findPage` implementa keyset sobre `(columna de orden, id)`: la página siguiente
es `WHERE (col, id) > ($valor, $id)` con el mismo orden, y el `nextCursor` codifica
ese par en base64. Es el mecanismo de [03 §6](03-contrato-api.md), y es estable
bajo inserciones concurrentes —cosa que `skip` no es. `findMany` con `take`/`skip`
existe para listas cortas y acotadas; una lista pública siempre pagina con
`findPage`.

## 5. El filtro `where`

Un DSL propio cubre lo que el 80 % de las consultas necesita. El 20 % restante es
un callback con el `ExpressionBuilder` de Kysely, con tipado completo, que puede
mezclarse con el DSL dentro de un `AND` u `OR`.

```ts
type WhereInput<T> =
  | Where<T>
  | ((eb: ExpressionBuilder<DB, TB>) => Expression<SqlBool>);   // el escape

type Where<T> =
  { [K in keyof T]?: T[K] | null | FieldFilter<T[K]> } &
  { AND?: WhereInput<T>[]; OR?: WhereInput<T>[]; NOT?: WhereInput<T> };

interface FieldFilter<V> {
  equals?: V | null;   not?: V | null;
  in?: V[];            notIn?: V[];
  lt?: V; lte?: V; gt?: V; gte?: V;
  contains?: string; startsWith?: string; endsWith?: string;   // solo string
  mode?: 'insensitive';                                        // con los tres anteriores
}
```

| Filtro | SQL |
|---|---|
| `{ active: true }` | `active = $1` |
| `{ revokedAt: null }` | `revoked_at IS NULL` |
| `{ resolvedAt: { not: null } }` | `resolved_at IS NOT NULL` |
| `{ kind: { in: [...] } }` | `kind IN ($1, $2)` — con lista vacía produce `FALSE`, no un error de sintaxis |
| `{ expiresAt: { lt: now } }` | `expires_at < $1` |
| `{ name: { contains: 'mart', mode: 'insensitive' } }` | `name ILIKE $1` con `%` y `_` del valor escapados |
| `{ OR: [{ sku: 'A' }, { name: { startsWith: 'B' } }] }` | `(sku = $1 OR name LIKE $2)` |
| `{ NOT: { active: true } }` | `NOT (active = $1)` |

Las claves de un objeto se combinan con `AND`. Un valor plano es igualdad; `null`
plano es `IS NULL`. Los operadores de texto solo se admiten en columnas `string`
y el tipo lo impone.

**Lo que es siempre escape o método concreto:** JSONB (`custom_fields @> …`), el
`path LIKE 'BOD-A/%'` del subárbol de nodos, subconsultas, `FOR UPDATE SKIP
LOCKED`, y cualquier condición que compare dos columnas. El DSL no crece para
absorberlos: cuando un filtro no cabe, la respuesta es un callback de tres líneas,
no un operador nuevo.

```ts
// DSL y escape en la misma consulta
await batchDao.findMany(orgId, {
  where: {
    expiresAt: { lte: horizon },
    AND: [(eb) => eb.exists(
      eb.selectFrom('stockBalance').select('id')
        .whereRef('stockBalance.batchId', '=', 'batch.id')
        .where('stockBalance.quantity', '>', '0')
    )],
  },
  orderBy: { expiresAt: 'asc' },
});
```

## 6. Transacción, contexto y errores

**El DAO nunca abre una transacción.** `protected get db()` en las clases
abstractas devuelve la transacción activa del `TransactionContext` —el
`AsyncLocalStorage` de [07 §4](07-composicion-y-contexto-de-ejecucion.md), que
guarda una `ControlledTransaction` de Kysely—. Si no hay ninguna, lanza
`NoActiveTransactionError`. No cae al pool: en el pool de tenant una consulta sin
`SET LOCAL app.current_org` falla por RLS, y en el de sistema leería todas las
organizaciones. Un DAO fuera de `UnitOfWork.run()` es un error de composición, y
debe sonar como tal.

Quien abre, fija `app.current_org`, confirma y elige pool es `KyselyUnitOfWork`,
la implementación del puerto `UnitOfWork` de common. Sus `run()` anidados son
`savepoint()` / `rollbackToSavepoint()` sobre la misma `ControlledTransaction`.

**Errores.** `libs/persistence` lanza, no devuelve `Result`: un fallo de acceso a
datos es infraestructura, no una regla de negocio ([01 §4](01-arquitectura.md)).

| Error | Cuándo | Quién lo traduce |
|---|---|---|
| `RecordNotFoundError` | `findUniqueOrThrow`, `update`, `delete` sobre una clave inexistente | El repositorio, a `null` o al error de dominio del módulo |
| `VersionConflictError` | `update` con `expectedVersion` distinta | El filtro de excepciones, a `409 stale-version` |
| `UniqueViolationError` | `23505` de Postgres, con el nombre del constraint | El repositorio, al error de dominio correcto: `sku` duplicado, código de nodo repetido |
| `NoActiveTransactionError` | DAO invocado fuera de `run()` | Nadie: es un `500` y un bug |

`UniqueViolationError` lleva el nombre del constraint porque es lo único que
permite al repositorio distinguir *"ese SKU ya existe"* de *"ese código de barras
ya existe"* sin una consulta previa — y la consulta previa tiene la misma ventana
de carrera que [12 §4.2](12-inventory.md) prohíbe para el stock.

**Inyección.** Cada DAO es un `@Injectable()` que recibe el `TransactionContext`;
`PersistenceModule` los provee junto con los repositorios y el `UnitOfWork`, y el
módulo raíz de `apps/tubodega` enlaza cada puerto con su adaptador.

## 7. Un repositorio de principio a fin

El adaptador de `UserRepository` ([10 §5](10-tenancy.md)) sobre `UserDao`:

```ts
@Injectable()
export class KyselyUserRepository implements UserRepository {
  constructor(private readonly users: UserDao, private readonly roles: UserRoleDao) {}

  async findById(orgId: OrgId, id: UserId): Promise<User | null> {
    const row = await this.users.findUnique(orgId, id);
    if (!row) return null;
    const roles = await this.roles.findMany(orgId, { where: { userId: id } });
    return toUser(row, roles);                                   // fila → entidad
  }

  findByEmail(orgId: OrgId, email: Email): Promise<User | null> {
    return this.users.findFirst(orgId, { where: { email } }).then(nullable(toUser));
  }

  findByEmailGlobal(email: Email): Promise<User[]> {             // contexto de sistema
    return this.users.findByEmailGlobal(email).then(rows => rows.map(toUser));
  }

  countActiveOwners(orgId: OrgId): Promise<number> {
    return this.roles.count(orgId, {
      where: { role: 'OWNER', AND: [(eb) => eb.exists(activeUserFor(eb))] },
    });
  }

  async save(user: User): Promise<void> {
    try {
      await this.users.update(user.orgId, user.id, fromUser(user), { expectedVersion: user.version });
    } catch (e) {
      if (e instanceof RecordNotFoundError) { await this.users.create(fromUser(user)); return; }
      throw e;
    }
  }
}
```

Lo que muestra: el repositorio mapea en ambos sentidos y decide qué error de
persistencia significa qué; el DAO no sabe qué es un `User`; el único método
escrito con Kysely es el que cruza organizaciones; y el bloqueo optimista viaja
en la entidad (`user.version`) hasta el `update` genérico.

## 8. Pruebas

Siguen los niveles de [06 §2](06-pruebas-y-calidad.md):

- **El genérico se prueba una vez**, en integración, contra dos tablas reales:
  `app_user` (clave `id`, `versioned`) y `alert_rule` (clave compuesta `{ kind }`).
  Cada método del contrato, cada operador del DSL con el SQL que produce, los
  cuatro errores, y `findPage` recorriendo tres páginas con inserciones entre
  medias. Es la única prueba que necesita cubrir el DSL: las concreciones lo
  heredan probado.
- **Cada concreción prueba solo sus métodos exclusivos.** `UserDao` prueba
  `findByEmailGlobal`; no vuelve a probar `findUnique`.
- **Una prueba de tipo** con `expectTypeOf` afirma que `MovementDao` y
  `StepCompletionDao` no tienen `update`, `upsert` ni `delete`. Falla en
  `pnpm typecheck`, antes de que exista una base de datos.
- **Un DAO fuera de transacción lanza** `NoActiveTransactionError`: una prueba de
  integración lo invoca sin `run()` y lo espera.

Los repositorios adaptadores se prueban en integración con el mismo patrón de
transacción revertida de [06 §5](06-pruebas-y-calidad.md); los casos de uso
siguen probándose con dobles en memoria del puerto, sin DAO ni base.

## 9. Documentos relacionados

- [01 — Arquitectura](01-arquitectura.md) — capas, puertos, reglas R-1 y R-4
- [03 — Contrato de API](03-contrato-api.md) — paginación, `If-Match`, `stale-version`
- [04 — Persistencia](04-persistencia.md) — tablas, Prisma y Kysely, migraciones
- [06 — Pruebas y calidad](06-pruebas-y-calidad.md) — niveles y aislamiento
- [07 — Composición y contexto de ejecución](07-composicion-y-contexto-de-ejecucion.md) — unidad de trabajo, contextos, lista cerrada de sistema
- [10 — Tenancy](10-tenancy.md) — el `UserRepository` del ejemplo
