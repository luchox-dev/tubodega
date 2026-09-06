# 01 — Arquitectura

> Define la forma del sistema: cómo se parte en piezas, qué puede depender de qué,
> y cuáles son las reglas que ninguna pieza puede violar.

## 1. Estilo

**Monolito modular con dominio aislado.** Un único proceso desplegable, dividido
internamente en contextos con fronteras explícitas.

No es microservicios: el usuario objetivo no tiene equipo de operaciones y el
volumen no lo justifica. No es un CRUD por capas: las reglas del ledger y el motor
de proceso son el activo del producto, y acoplarlas al framework o al ORM
condenaría a reescribirlas cuando lleguen los flujos configurables.

### Alternativas descartadas

| Alternativa | Por qué no |
|---|---|
| **Nest idiomático por capas** — módulo por entidad, entidades del ORM como dominio | Es el camino más corto al primer endpoint, pero deja las reglas del ledger repartidas entre servicios y decoradores. El día del workflow configurable, el refactor es total — exactamente lo que este proyecto se propuso evitar. |
| **Event sourcing completo** — el ledger como event store, saldos como proyecciones | Conceptualmente el más limpio y el que mejor habilitaría el offline. Su costo real es versionado de eventos, proyecciones, replay y herramientas de depuración propias: meses de infraestructura antes del primer endpoint útil. Tomamos sus dos propiedades valiosas —asientos inmutables y saldo derivado— sin pagar esa factura. |

## 2. Las tres capas

Cada librería de dominio se organiza igual:

```
libs/<contexto>/src/
  domain/           TypeScript puro. Entidades, invariantes, tipos.
  application/      Casos de uso y puertos. Orquesta el dominio.
  infrastructure/   Adaptadores. Nest, Kysely, HTTP, relojes, ids.
  index.ts          Barril público. Lo único que otros contextos importan.
```

**`domain/`** — el modelo y sus reglas. No importa NestJS, ni Kysely, ni Prisma, ni nada de
`application/` o `infrastructure/`. Se prueba sin base de datos, sin HTTP y sin
contenedor de inyección.

**`application/`** — los casos de uso. Declaran **puertos de salida** como
interfaces (`MovementRepository`, `Clock`, `IdGenerator`) y los reciben inyectados.
Conocen el dominio; no conocen su implementación.

**`infrastructure/`** — donde vive el mundo real: módulos de Nest, repositorios
Kysely, relojes de sistema. Implementa los puertos que `application/` declaró.

La dirección de la dependencia se invierte en la frontera: `application/` define la
interfaz, `infrastructure/` la cumple. Esa inversión es la que permite probar los
casos de uso con dobles y cambiar de motor de persistencia sin tocar una regla.

## 3. Mapa de librerías

```
apps/tubodega/src/        composición HTTP: controllers, guards, interceptores, OpenAPI
  adapters/               los puertos que un módulo declara y otro satisface — ver [07 §7]
libs/
  common/                 config, errores base, tipos primitivos, unidad de trabajo  (ya existe)
  tenancy/                organización, usuarios, roles, contexto de request
  catalog/                productos, códigos, medios, campos custom
  inventory/              nodos, movimientos, saldos           ← núcleo
  process/                plantillas, instancias, handlers     ← motor
  alerts/                 reglas por fecha
  persistence/            esquema Prisma, migraciones, tipos generados, DAOs, repositorios  — ver [08]
```

Cada una es un proyecto de tipo `library` en `nest-cli.json`, con su alias
`@app/<nombre>` en `tsconfig.json`. El alias apunta al **archivo** barril, no al
directorio:

```jsonc
"@app/inventory": ["./libs/inventory/src/index.ts"]
```

Esto no es un detalle estético. Bajo `moduleResolution: "nodenext"` un objetivo de
directorio no resuelve por índice, así que el alias debe nombrar `index.ts`
explícitamente. `TsconfigPathsPlugin` de Rspack sí resuelve un directorio, con lo
cual un mapeo a directorio compila y arranca pero rompe `pnpm typecheck` — un fallo
que solo aparece en la puerta de tipos. El repositorio ya sigue esta convención con
`@app/common`.

## 4. El núcleo compartido

`libs/common` contiene los tipos que todos los módulos usan y que no pertenecen a
ninguno. Se definen aquí, una sola vez, porque los specs de módulo los emplean sin
volver a explicarlos.

```ts
// ─── Identificadores marcados ──────────────────────────────────────────────
type Branded<T, K extends string> = T & { readonly __brand: K };
```

Un `UserId` y un `OrgId` son ambos cadenas. Pasar uno donde va el otro compila sin
protestar, y el resultado es una consulta que no devuelve nada por un motivo que
nadie encuentra. La marca de tipo convierte ese error en un fallo de compilación y
desaparece por completo en tiempo de ejecución.

```ts
// ─── Resultado ─────────────────────────────────────────────────────────────
type Result<T, E extends DomainError = DomainError> =
  | { readonly ok: true;  readonly value: T }
  | { readonly ok: false; readonly error: E };

abstract class DomainError extends Error {
  abstract readonly type: string;      // el `type` de problem+json
  abstract readonly status: number;
}
```

Las reglas de negocio devuelven `Result`, no lanzan. Un fallo de validación es un
resultado esperado —el usuario escribió algo inválido— y modelarlo en el tipo obliga
a que quien llama lo trate. Las excepciones quedan para lo que de verdad es
excepcional: una conexión caída, un fallo de infraestructura.

`DomainError` lleva su `type` y su `status`, de modo que el filtro de excepciones de
`apps/tubodega` traduce a `problem+json` sin conocer ningún error concreto. Añadir un
error nuevo no toca la capa HTTP.

```ts
// ─── Paginación ────────────────────────────────────────────────────────────
type Cursor = Branded<string, 'Cursor'>;      // opaco, base64

interface Page<T> {
  readonly data: readonly T[];
  readonly nextCursor?: Cursor;
  readonly hasMore: boolean;
}
```

Corresponde exactamente a la forma de respuesta de
[03 §6](03-contrato-api.md).

```ts
// ─── Eventos ───────────────────────────────────────────────────────────────
type TraceId = Branded<string, 'TraceId'>;

interface DomainEvent {
  readonly id: string;
  readonly type: string;
  readonly orgId: OrgId;
  readonly traceId: TraceId;
  readonly occurredAt: Date;
  readonly data: Record<string, unknown>;
}
```

Es la envoltura de [05 §5](05-eventos-e-integraciones.md).

```ts
// ─── Puertos transversales ─────────────────────────────────────────────────
interface Clock       { now(): Date; }
interface IdGenerator { next(): string; }      // UUIDv7

interface UnitOfWork {
  /** Abre una transacción si no hay ninguna; si ya hay, abre un SAVEPOINT. */
  run<T>(fn: () => Promise<T>, opts?: { readonly readOnly?: boolean }): Promise<T>;
}
```

`Clock` es un puerto y no `new Date()` porque las reglas de vencimiento y de custodia
vencida son intrínsecamente temporales: sin poder fijar el reloj, sus pruebas serían
no deterministas o dependerían de esperas reales.

`UnitOfWork` es el único contacto de `application/` con las transacciones. La
transacción es ambiental —`infrastructure/` la propaga con `AsyncLocalStorage` y
los repositorios la toman de ahí— así que ningún caso de uso pasa un handle. El
borde la abre; los casos de uso solo la usan, y la usan anidada cuando necesitan
un `SAVEPOINT`. El detalle está en [07 §4](07-composicion-y-contexto-de-ejecucion.md).

```ts
// ─── Identificadores compartidos hacia abajo ───────────────────────────────
type ProcessInstanceId = Branded<string, 'ProcessInstanceId'>;
```

Vive aquí y no en `process` porque `inventory` lo referencia
(`Movement.processInstanceId`) y `process` está por encima de `inventory`. Un id
opaco en `common` es lo que permite que el ledger diga *"este movimiento vino de
aquella operación"* sin conocer qué es una operación.

## 5. Reglas de dependencia

```
tenancy       ─┐  no depende de ningún otro contexto
catalog       ─┤→ tenancy
inventory     ─┤→ tenancy, catalog
process       ─┤→ tenancy, catalog, inventory
alerts        ─┘→ tenancy, catalog, inventory

persistence      → implementa los puertos de salida de todos los anteriores
apps/tubodega    → compone todo; nadie depende de él
common           → lo puede importar cualquiera; no importa a nadie
```

### Las cuatro reglas duras

**R-1. El dominio es puro.** Ningún archivo bajo `domain/` importa NestJS, Kysely,
Prisma, Fastify ni nada de `application/` o `infrastructure/`. Solo TypeScript, tipos del
propio dominio, y tipos de dominio de contextos de los que ya depende.

**R-2. Las dependencias van hacia abajo.** Solo en el orden de la lista. Sin ciclos.
Si `catalog` necesitara algo de `inventory`, la respuesta correcta es un puerto en
`catalog` que `inventory` implemente, o mover el concepto a `common`.

**R-3. Solo se importa el barril.** Un contexto importa `@app/catalog`, jamás
`@app/catalog/domain/product`. Lo que no está en `index.ts` es privado, y eso es lo
que permite reorganizar el interior de una librería sin romper a nadie.

**R-4. `persistence` no es importado por nadie.** Implementa puertos y se registra
en el módulo raíz. Ningún contexto de dominio conoce su existencia; si alguno lo
importara, la inversión de dependencias se habría perdido.

### Verificación

Las cuatro reglas son mecánicamente comprobables. La configuración concreta se
define en [06 — Pruebas y calidad](06-pruebas-y-calidad.md); aquí basta con dejar
constancia de que **son parte de la puerta de CI, no una convención de buena
voluntad**. Una regla de arquitectura que solo vive en un documento se rompe en el
tercer mes.

## 6. Composición

`apps/tubodega` es la única pieza que conoce a todas las demás. Su
responsabilidad es exclusivamente de borde:

- **Controllers** — traducen HTTP a llamadas de caso de uso y de vuelta. Sin lógica.
- **Guards** — verifican el token. Sin base de datos.
- **Interceptors** — en este orden: transacción y `SET LOCAL`, identidad y roles,
  idempotencia.
- **Filtros de excepción** — traducen errores de dominio a `problem+json`.
- **Adaptadores cruzados** — implementan los puertos que un módulo declara y otro
  satisface.
- **Módulo raíz** — enlaza cada puerto con su adaptador, de `persistence` o propio.

El orden exacto, los tres contextos de ejecución y la configuración están en
[07 — Composición y contexto de ejecución](07-composicion-y-contexto-de-ejecucion.md).
Un controller que contenga una regla de negocio es un defecto, no un atajo.

## 7. Transacciones

**Una petición, una transacción** — también las lecturas, porque RLS lo exige.
Se abre en el borde con `UnitOfWork.run()` y se propaga a los casos de uso de
forma ambiental. Dentro de la transacción de una escritura caben, siempre juntos:

1. los movimientos insertados en el ledger,
2. la actualización de `stock_balance`,
3. el avance de la instancia de proceso,
4. los eventos escritos en la tabla outbox.

Que los cuatro compartan transacción es lo que hace que el sistema no pueda quedar
en un estado donde el stock cambió pero el evento no se emitió, o donde el proceso
avanzó pero el saldo no. El detalle del outbox está en
[05 — Eventos e integraciones](05-eventos-e-integraciones.md).

## 8. Preparación para lo que viene

Tres decisiones de esta arquitectura existen solo para no cerrar puertas. Ninguna
añade código hoy más allá de una interfaz.

| Extensión futura | Qué la habilita | Qué habría costado sin ella |
|---|---|---|
| Flujos con ramas | `ProcessRunner` es una interfaz con una implementación lineal; los pasos se direccionan por `id` y no por índice | Reescribir el motor y migrar todas las plantillas |
| Integraciones | Los eventos ya se escriben en outbox dentro de la transacción | Auditar cada escritura para encontrar dónde emitir |
| Offline-first | IDs generados por el cliente, escrituras idempotentes, ledger append-only | Rehacer el esquema de identidad de todo el sistema |
| Otro motor de persistencia | Los puertos ya están declarados en `application/` | Reescribir los casos de uso |

## 9. Lo que esta arquitectura cuesta

Por honestidad, y para que nadie la aplique donde no toca: hay más ceremonia que en
un CRUD. Un caso de uso trivial —listar productos— pasa por un puerto y un
adaptador que en un servicio con repositorio del ORM no existirían.

Aceptamos ese costo porque el valor del producto está concentrado en dos piezas
—el ledger y el motor de proceso— cuya corrección debe ser demostrable y cuya
evolución está prevista desde el inicio. En los contextos donde no hay reglas que
proteger, la capa `application/` puede ser delgada hasta la trivialidad; lo que no
se admite es saltársela, porque la excepción de hoy es la inconsistencia de mañana.

## 10. Documentos relacionados

- [00 — Visión y alcance](00-vision-y-alcance.md)
- [02 — Modelo de dominio](02-modelo-de-dominio.md)
- [04 — Persistencia](04-persistencia.md)
- [06 — Pruebas y calidad](06-pruebas-y-calidad.md)
- [07 — Composición y contexto de ejecución](07-composicion-y-contexto-de-ejecucion.md)
- [08 — Acceso a datos](08-acceso-a-datos.md) — DAOs y repositorios sobre Kysely
