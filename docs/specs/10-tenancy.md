# 10 — Tenancy

> `libs/tenancy` · Organizaciones, usuarios, roles y el contexto de petición.
>
> Es el primer módulo porque todos los demás dependen de él y porque es el que
> establece la frontera de aislamiento sobre la que descansa la invariante I-6.

## 1. Propósito y frontera

Responde tres preguntas, y ninguna más:

- **¿Quién eres?** — autenticación
- **¿A qué organización perteneces?** — contexto de tenant
- **¿Qué puedes hacer?** — autorización por rol

Queda fuera: gestión de suscripciones y facturación, invitaciones por correo,
inicio de sesión federado, permisos por recurso individual, y toda noción de
jerarquía entre organizaciones. Cada una tiene su lugar en
[90](90-extensiones-previstas.md) o simplemente no es de este producto.

**El límite importante:** este módulo *establece* el contexto de organización; no lo
*aplica*. Aplicarlo es cosa de RLS en la base y del filtro en cada repositorio. Si
tenancy fuera lo único que separa a dos clientes, un solo olvido bastaría para
filtrar datos.

## 2. Entidades y tipos del dominio

```ts
type OrgId  = Branded<string, 'OrgId'>;
type UserId = Branded<string, 'UserId'>;
type Email  = Branded<string, 'Email'>;   // normalizado a minúsculas
type Slug   = Branded<string, 'Slug'>;    // minúsculas, guiones, 3-64

interface TokenClaims {
  readonly sub: UserId;
  readonly org: OrgId;
  readonly roles: readonly Role[];
  readonly exp: number;
}

class Organization {
  readonly id: OrgId;
  readonly name: string;
  readonly slug: Slug;          // minúsculas, guiones, 3-64
  readonly active: boolean;
}

class User {
  readonly id: UserId;
  readonly orgId: OrgId;
  readonly email: Email;         // normalizado a minúsculas
  readonly name: string;
  readonly roles: ReadonlySet<Role>;
  readonly active: boolean;

  can(action: Action): boolean;
}

enum Role   { OWNER, ADMIN, OPERATOR, VIEWER }
enum Action { MANAGE_ORG, MANAGE_USERS, MANAGE_CATALOG, CREATE_BATCH,
              MANAGE_NODES, RECORD_MOVEMENT, REVERSE_MOVEMENT, READ }

// Fijado por el guard, propagado a todo caso de uso.
interface RequestContext {
  readonly orgId: OrgId;
  readonly userId: UserId;
  readonly roles: ReadonlySet<Role>;
  readonly traceId: TraceId;
}
```

Los identificadores son tipos marcados (*branded*) y no `string`. Pasar un `UserId`
donde se espera un `OrgId` compila si ambos son cadenas, y el resultado es una
consulta que no devuelve nada por una razón que nadie encuentra. El tipo marcado
convierte ese error en un fallo de compilación y no cuesta nada en ejecución.

### Matriz de permisos

| Acción | OWNER | ADMIN | OPERATOR | VIEWER |
|---|:--:|:--:|:--:|:--:|
| `MANAGE_ORG` | ● | | | |
| `MANAGE_USERS` | ● | ● | | |
| `MANAGE_CATALOG` | ● | ● | | |
| `CREATE_BATCH` | ● | ● | ● | |
| `MANAGE_NODES` | ● | ● | | |
| `RECORD_MOVEMENT` | ● | ● | ● | |
| `REVERSE_MOVEMENT` | ● | ● | | |
| `READ` | ● | ● | ● | ● |

**Roles fijos, no permisos configurables.** Cuatro roles cubren la estructura real de
un negocio de 2 a 50 personas; un sistema de permisos granular sería una superficie
de configuración que ese usuario no quiere administrar. La matriz vive en el dominio
como una tabla constante, así que ampliarla es añadir una fila.

`REVERSE_MOVEMENT` está separado de `RECORD_MOVEMENT` a propósito: compensar un
asiento es la operación con la que se corrige un error, y quien opera el día a día no
debería poder deshacer su propio registro sin que lo vea un responsable.

`CREATE_BATCH` está separado de `MANAGE_CATALOG` por la razón contraria: un lote
nuevo llega con la mercancía, y quien la recibe es el operario. Si crear el lote
exigiera un administrador, la recepción de un perecedero se detendría en el
muelle esperando a alguien de oficina — el paso `CAPTURE_BATCH` de
[13 §5](13-process.md) sería inservible para el rol que más lo usa. Definir el
producto sigue siendo `MANAGE_CATALOG`; identificar una remesa de un producto
que ya existe, no.

## 3. Invariantes

| # | Invariante | Mecanismo |
|---|---|---|
| **T-1** | Un correo es único dentro de una organización, no globalmente | `UNIQUE (org_id, email)` sobre `citext` |
| **T-2** | Toda organización tiene al menos un usuario `OWNER` activo | Validación de dominio al desactivar usuario o retirar rol |
| **T-3** | Un usuario pertenece a exactamente una organización | `org_id NOT NULL` sin tabla de pertenencia |
| **T-4** | La organización del contexto proviene solo del token | Ningún endpoint acepta `orgId` de entrada; verificado en pruebas e2e |
| **T-5** | La variable de sesión de RLS se fija antes de todo caso de uso | El interceptor de transacción corre antes que el handler y fija `SET LOCAL` dentro de la transacción ([07 §3](07-composicion-y-contexto-de-ejecucion.md)); probado en integración |
| **T-6** | Un usuario inactivo no autentica, aunque su token siga vigente | Comprobación de estado en cada petición, no solo al emitir |

**T-2** evita el estado en el que una organización queda sin nadie que pueda
administrarla — irrecuperable sin intervención manual en la base de datos.

**T-6** es la razón por la que el token se valida contra el estado actual y no se
confía ciegamente en su firma: revocar un acceso debe surtir efecto de inmediato, no
cuando expire el token.

## 4. Casos de uso

```ts
interface CreateOrganization {
  execute(input: {
    name: string; slug: string;
    owner: { email: string; name: string; password: string };
  }): Promise<{ organization: Organization; owner: User }>;
}
```
Crea la organización, su primer `OWNER`, **los ocho nodos de frontera**, **las seis
plantillas de proceso de fábrica** y **las cuatro reglas de alerta**, todo en una
transacción. Una organización a medio sembrar no puede registrar ni un movimiento,
porque la partida doble no tendría contra qué asentar.

Corre en **contexto de sistema** ([07 §2](07-composicion-y-contexto-de-ejecucion.md)):
cuando empieza, la organización no existe y no hay token del que sacarla.

```ts
interface Authenticate {
  execute(input: { email: string; password: string }):
    Promise<{ accessToken: string; refreshToken: string; user: User }>;
}

interface RefreshSession {
  execute(input: { refreshToken: string }):
    Promise<{ accessToken: string; refreshToken: string }>;   // rotado
}

interface Logout {
  execute(ctx: RequestContext, input: { refreshToken: string }): Promise<void>;
}

interface CreateUser {   // exige MANAGE_USERS
  execute(ctx: RequestContext, input: {
    email: string; name: string; password: string; roles: Role[];
  }): Promise<User>;
}

interface UpdateUserRoles { /* exige MANAGE_USERS; respeta T-2 */ }
interface DeactivateUser  { /* exige MANAGE_USERS; respeta T-2 */ }
interface ChangePassword  { /* el propio usuario, con contraseña actual */ }
```

**Precondición común a todos salvo `CreateOrganization`, `Authenticate` y
`RefreshSession`:** existe un `RequestContext` válido, y el usuario tiene la
acción requerida. Esos tres corren en contexto de sistema porque, cuando
empiezan, no hay organización que fijar
([07 §2](07-composicion-y-contexto-de-ejecucion.md)).

**El token de refresco es opaco, se guarda por hash y se rota.** `Authenticate`
emite un par; `RefreshSession` verifica el hash, rechaza revocados o vencidos,
marca el usado como revocado y emite un par nuevo; `Logout` revoca el recibido.
Sin estado en el servidor, "revocar" no significaría nada: un JWT de refresco
firmado seguiría siendo válido hasta su expiración.

## 5. Puertos de salida

```ts
interface OrganizationRepository {
  findById(id: OrgId): Promise<Organization | null>;
  findBySlug(slug: Slug): Promise<Organization | null>;
  save(org: Organization): Promise<void>;
}

interface UserRepository {
  findById(id: UserId): Promise<User | null>;
  findByEmail(orgId: OrgId, email: Email): Promise<User | null>;
  findByEmailGlobal(email: Email): Promise<User[]>;   // solo para autenticar
  countActiveOwners(orgId: OrgId): Promise<number>;   // T-2
  save(user: User): Promise<void>;
}

interface PasswordHasher {
  hash(plain: string): Promise<string>;
  verify(plain: string, hash: string): Promise<boolean>;
}

interface TokenIssuer {
  issueAccess(user: User): string;
  verify(token: string): TokenClaims | null;
}

interface SessionRepository {                       // refresh tokens
  create(session: { userId: UserId; orgId: OrgId; tokenHash: string; expiresAt: Date }): Promise<void>;
  findByHash(tokenHash: string): Promise<Session | null>;   // contexto de sistema
  revoke(id: string, at: Date): Promise<void>;
}

interface OrgProvisioner {          // implementado fuera de tenancy
  provision(orgId: OrgId): Promise<void>;   // nodos de frontera, plantillas, reglas de alerta
}
```

`OrgProvisioner` es lo que evita que `tenancy` dependa de `inventory`, `process` y `alerts`,
lo que violaría la regla R-2 de [01](01-arquitectura.md). `tenancy` declara la
necesidad; el módulo raíz la satisface con implementaciones de los módulos de abajo.
Es inversión de dependencias aplicada donde el orden natural la exigiría al revés.

`findByEmailGlobal` existe porque en el inicio de sesión aún no hay organización: el
correo puede repetirse entre organizaciones, así que la resolución devuelve
candidatos y la contraseña desambigua. Si más de uno coincidiera, se exige `slug`
explícito.

## 6. Persistencia

Tablas `organization`, `app_user`, `user_role` y `refresh_token`, definidas en
[04 §3.1](04-persistencia.md).

`organization` es la única tabla del sistema **sin** `org_id` propio ni política RLS:
es la raíz del aislamiento, y una política sobre ella se referiría a sí misma.
Su acceso se restringe por identificador, siempre resuelto desde el token.

## 7. Endpoints

| Método | Ruta | Acción | Notas |
|---|---|---|---|
| `POST` | `/v1/organizations` | — | Registro. Único endpoint público de escritura. Exento de `Idempotency-Key` |
| `POST` | `/v1/auth/login` | — | Devuelve par de tokens. Exento |
| `POST` | `/v1/auth/refresh` | — | Rota el par. Exento |
| `POST` | `/v1/auth/logout` | `READ` | Revoca el token de refresco. Exento |
| `GET` | `/v1/me` | `READ` | Usuario y organización actuales |
| `GET` | `/v1/users` | `MANAGE_USERS` | Filtros: `active`, `role` |
| `POST` | `/v1/users` | `MANAGE_USERS` | |
| `PATCH` | `/v1/users/{id}` | `MANAGE_USERS` | `If-Match` obligatorio; la respuesta devuelve la `version` ya incrementada |
| `DELETE` | `/v1/users/{id}` | `MANAGE_USERS` | Desactiva; no borra |
| `POST` | `/v1/me/password` | `READ` | Exige contraseña actual |

`DELETE` desactiva en lugar de borrar porque los movimientos referencian a su actor.
Borrar un usuario dejaría movimientos huérfanos, y el ledger no admite huecos.

## 8. Eventos emitidos

| Tipo | Cuándo |
|---|---|
| `organization.created` | Tras el aprovisionamiento completo |
| `user.created` · `user.roles_changed` · `user.deactivated` | |

Nombres y forma según el catálogo de [05](05-eventos-e-integraciones.md).

## 9. Errores

| `type` | Estado | Cuándo |
|---|---|---|
| `invalid-credentials` | 401 | Correo o contraseña incorrectos, o usuario inactivo |
| `token-expired` | 401 | |
| `refresh-token-invalid` | 401 | Desconocido, revocado o vencido; un solo tipo, por la misma razón que `invalid-credentials` |
| `insufficient-role` | 403 | Autenticado sin la acción requerida |
| `slug-taken` | 409 | |
| `email-taken` | 409 | Ya existe en esa organización |
| `last-owner` | 422 | La operación dejaría la organización sin `OWNER` (T-2) |
| `ambiguous-login` | 409 | El correo existe en varias organizaciones; falta `slug` |

`invalid-credentials` cubre correo inexistente, contraseña errónea y usuario
inactivo con el mismo mensaje y el mismo tiempo de respuesta. Distinguirlos
permitiría enumerar qué cuentas existen.

## 10. Pruebas

**Dominio** — matriz de permisos completa; normalización de correo; validación de
slug; T-2 al retirar el último `OWNER`.

**Aplicación** — creación de organización con `OrgProvisioner` doble; login
ambiguo entre organizaciones; refresco con token revocado.

**Integración** — T-1 bajo concurrencia; el interceptor fija `app.current_org`
antes del caso de uso (T-5); un token válido de otra organización no lee ni una
fila (I-6); `Authenticate` con el pool de sistema encuentra un correo en dos
organizaciones, y con el pool de tenant no encuentra ninguno; un token de
refresco usado dos veces falla la segunda.

**e2e** — `orgId` en cuerpo o query se ignora y no altera el contexto (T-4);
`404` y nunca `403` al pedir un recurso de otra organización; token de usuario
recién desactivado rechazado de inmediato (T-6).

## 11. Ganchos de extensión

| Extensión | Qué ya lo permite | Qué falta |
|---|---|---|
| Invitaciones por correo | `CreateUser` ya separa alta de activación | Entidad de invitación y envío |
| OAuth / SSO | `TokenIssuer` es un puerto | Un adaptador por proveedor |
| Permisos granulares | `can(action)` ya es el único punto de decisión | Sustituir la tabla constante por consulta a rol persistido |
| Multi-organización por usuario | `RequestContext` ya lleva `orgId` explícito, no implícito | Tabla de pertenencia y selector de organización activa. T-3 se retira. |
| Auditoría de accesos | El `traceId` ya recorre toda la petición | Persistir los intentos de autenticación |

**Ninguna toca el modelo de dominio de los demás módulos**, porque todos reciben
`RequestContext` como valor y nunca preguntan por su origen.

## 12. Documentos relacionados

- [03 — Contrato de API](03-contrato-api.md) · [04 §3.1](04-persistencia.md) · [04 §4](04-persistencia.md) · [07 — Composición y contexto de ejecución](07-composicion-y-contexto-de-ejecucion.md)
