# 06 — Pruebas y calidad

> Qué se prueba, en qué nivel, y qué puertas debe pasar un cambio para entrar.
>
> El repositorio ya trae vitest con SWC, oxlint y `pnpm typecheck`. Este documento
> define cómo se usan, no los reintroduce.

## 1. Principio

**El nivel de prueba lo determina la dependencia, no el tamaño.** Una regla que solo
necesita TypeScript se prueba sin base de datos; una que depende de un `CHECK` de
Postgres se prueba contra Postgres. Probar una regla de dominio a través de HTTP es
lento y diagnostica mal: cuando falla, hay cinco capas donde puede estar el error.

De ahí sale la razón por la que [01](01-arquitectura.md) exige el dominio puro. No es
purismo: es que la mayoría de las reglas de este producto puedan probarse en
milisegundos.

## 2. La pirámide

| Nivel | Dónde | Qué prueba | Dependencias | Objetivo |
|---|---|---|---|---|
| **Dominio** | `libs/*/src/domain/**/*.spec.ts` | Entidades, invariantes, cálculos | Ninguna | < 2 s en total |
| **Aplicación** | `libs/*/src/application/**/*.spec.ts` | Casos de uso con puertos dobles | Ninguna | < 5 s |
| **Integración** | `libs/persistence/test/**/*.int-spec.ts`, `apps/tubodega/test/**/*.int-spec.ts` | Repositorios, constraints, RLS, el borde ([07](07-composicion-y-contexto-de-ejecucion.md)) | Postgres | < 60 s |
| **e2e** | `apps/tubodega/test/**/*.e2e-spec.ts` | Contrato HTTP completo | Postgres + app | < 120 s |
| **Invariantes** | `test/invariants/**/*.prop-spec.ts` | Propiedades del sistema sobre datos generados | Postgres | < 180 s |
| **Caja negra** | `scripts/blackbox/*.sh` | El contrato HTTP **a través de un socket real** | Postgres + app arrancada | < 60 s |

Los dos primeros niveles corren con `pnpm test`, sin infraestructura, y son los que
se ejecutan en watch mientras se programa. Los tres siguientes con `pnpm test:e2e`.

El sexto es el único que no corre con vitest ni tiene sufijo: son guiones de shell con
`curl`, se invocan con `pnpm blackbox` contra un servidor levantado, y existen por lo que
el nivel e2e **no** puede ver (§6). Su runner cruza además lo que pidió contra los paths
del contrato publicado y exige de cada operación un camino feliz y uno de error, que es la
regla de §6 convertida en algo que se comprueba solo.

**El sufijo del archivo es lo que decide el nivel.** `vitest.config.ts` incluye
`**/*.spec.ts` y `vitest.config.e2e.ts` incluye `*.int-spec.ts`, `*.e2e-spec.ts`
y `*.prop-spec.ts`. Sin sufijos distintos, una prueba de integración llamada
`.spec.ts` entraría en `pnpm test` y lo haría depender de Postgres — que es
exactamente lo que el nivel quiere evitar. `tsconfig.typecheck.json` cubre los
cinco directorios, incluido `test/` en la raíz.

## 3. Pruebas de dominio

Sin dobles, sin contenedor de inyección, sin `beforeEach` que levante nada. Se
construye el objeto, se le pide algo, se comprueba.

```ts
describe('Movement', () => {
  it('I-1 · rechaza origen y destino iguales', () => {
    const result = Movement.create({ ...base, fromNode: n1, toNode: n1 });
    expect(result.ok).toBe(false);
    expect(result.error).toBeInstanceOf(SameNodeError);
  });

  it('I-12 · una compensación invierte origen y destino', () => {
    const original = unwrap(Movement.create({ ...base, fromNode: a, toNode: b }));
    const reversal = original.reverse(actorId, occurredAt);
    expect(reversal.fromNodeId).toBe(b.id);
    expect(reversal.toNodeId).toBe(a.id);
    expect(reversal.quantity).toEqual(original.quantity);
    expect(reversal.reversesId).toBe(original.id);
  });
});
```

Las reglas devuelven `Result` y no lanzan ([01 §4](01-arquitectura.md)), así que
las pruebas afirman sobre el resultado, no sobre una excepción.

**Toda invariante de [02](02-modelo-de-dominio.md) que sea comprobable sin base de
datos tiene su prueba aquí**, nombrada con su número: `I-1`, `I-2`, `I-8`, `I-9`,
`I-11`, `I-12`, `I-14`, `I-15`, `I-16`, `I-17`, `I-18`. Las que dependen de un
constraint o de RLS —`I-3`, `I-4`, `I-6`, `I-10`, `I-13`— se prueban en
integración, e `I-7` en las pruebas del borde (§5).

Esa correspondencia no es decorativa: es lo que permite comprobar de un vistazo que
ninguna invariante quedó sin cubrir.

## 4. Pruebas de aplicación

Casos de uso con los puertos sustituidos por dobles en memoria. Los dobles viven en
`libs/*/test/doubles/` y son implementaciones reales, no simulacros con expectativas:

```ts
class InMemoryMovementRepository implements MovementRepository { /* ... */ }
class FixedClock implements Clock { constructor(private readonly now: Date) {} }
class SequentialIdGenerator implements IdGenerator { /* ... */ }
```

**Dobles con comportamiento, no mocks con aserciones de llamada.** Un test que
verifica *"se llamó a `save` una vez"* comprueba la implementación, no la conducta:
se rompe con cualquier refactorización que no cambie nada observable. Un repositorio
en memoria permite afirmar sobre el resultado, que es lo que de verdad importa.

`FixedClock` es lo que hace que las pruebas de vencimiento y de custodia vencida
sean deterministas. Ninguna prueba usa `new Date()`.

## 5. Pruebas de integración

Postgres real, levantado con el `compose.yaml` del repositorio, ampliado con un
servicio de base de datos. Nada de SQLite ni de dobles del motor: la mitad de las
garantías de este sistema son constraints de Postgres, y un motor distinto no las
tiene.

Aislamiento: **cada prueba corre dentro de una transacción que se revierte al
terminar**. Es más rápido que truncar tablas y hace que el orden de ejecución no
importe.

Lo que se prueba aquí, y en ningún otro sitio:

- **Cada constraint del esquema**, con un caso que lo viola y espera el fallo
- **La imposibilidad de actualizar o borrar un movimiento** (I-3), incluido el
  `REVOKE` sobre el rol de aplicación
- **El aislamiento por RLS** (I-6): con el filtro del repositorio deliberadamente
  anulado, una organización no ve ni una fila de otra. Una prueba por tabla
- **El orden de upserts que evita interbloqueos**: dos transacciones que tocan los
  mismos dos nodos en sentidos opuestos, en paralelo, y ninguna muere por deadlock
- **La detección de ciclos** al reasignar el padre de un nodo (I-10)
- **Las claves foráneas compuestas**: un `INSERT` con `product_id` de otra
  organización falla aunque el `org_id` propio sea correcto
- **El DAO genérico, una sola vez**, contra `app_user` y `user_role`: cada método,
  cada operador del DSL y sus errores ([08 §8](08-acceso-a-datos.md)). Las
  concreciones solo prueban sus métodos exclusivos. (La familia `Org` se probaba contra
  `alert_rule` en el plan original; se usó `user_role` porque `alert_rule` no existe hasta
  la WAVE 5 — decisión D-1 del maestro)
- **El índice único `NULLS NOT DISTINCT` de `stock_balance`**: dos upserts de un
  producto `QUANTITY` sobre el mismo nodo actualizan una sola fila, no dos. Es la
  prueba de que la cláusula escrita a mano en la migración
  ([04 §5.1](04-persistencia.md)) llegó a la base

Y las del borde, en `apps/tubodega/test/**/*.int-spec.ts`, contra los
interceptores de [07 §3](07-composicion-y-contexto-de-ejecucion.md) con la
aplicación real:

- **La reserva de idempotencia bajo concurrencia** (I-7): dos peticiones
  simultáneas con la misma clave, una se procesa y la otra recibe `409
  idempotency-key-in-flight`; tras confirmar, la segunda repetida recibe el
  replay; una fila `IN_FLIGHT` de más de 5 minutos se re-reserva
- **`SET LOCAL` dentro de la transacción** (T-5): una petición cuya transacción
  se abre después del guard —simulando el orden equivocado— no ve ninguna fila
- **El `SAVEPOINT` de `applyDelta`**: tras un fallo de I-4 la transacción sigue
  usable y `insufficient-stock` sale con `available` correcto
- **Los tres roles**: el pool de tenant no puede leer sin `app.current_org`; el
  de sistema sí; ninguno de los dos puede `UPDATE movement`

La prueba de RLS es la más importante del conjunto. Es la que demuestra que la
segunda capa de aislamiento existe de verdad y no solo en este documento.

## 6. Pruebas e2e

Contra la aplicación completa, por HTTP, usando supertest —ya presente en el
repositorio— y hablando **solo el contrato público**. Ninguna prueba e2e toca la
base de datos directamente ni para preparar ni para comprobar; si algo no se puede
montar por la API, es que a la API le falta algo.

Con un límite que conviene conocer: estas pruebas corren **en proceso**, con
`fastify.inject()`, que fabrica la petición en memoria y no la transporta. Hay fallos que
solo aparecen cuando los bytes cruzan un socket —`@fastify/multipart` corta el archivo
demasiado grande mientras lo recibe y avisa lanzando un `FastifyError`, que el filtro
convertía en `500` en vez de `413`— y para eso está el nivel de caja negra de §2.

Los diez criterios de éxito de [00](00-vision-y-alcance.md) son, literalmente, diez
pruebas e2e. Es la definición operativa de *"el MVP está listo"*. El criterio 5
—la custodia vencida— usa `POST /v1/alerts/evaluate` con `at`
([14 §5](14-alerts.md)): es lo que permite "adelantar el reloj" sin salirse del
contrato público ni esperar al job.

Además:

- Todo endpoint tiene al menos una prueba de camino feliz y una de error
- La forma `problem+json` se verifica en cada tipo de error, no solo el código
- El reintento con la misma `Idempotency-Key` devuelve la respuesta guardada y no
  duplica nada; un `POST` no exento sin cabecera recibe `400`; los cuatro exentos
  de [07 §5](07-composicion-y-contexto-de-ejecucion.md) funcionan sin ella
- Un token de otra organización recibe `404`, nunca `403`
- `X-Request-Id` no UUID se sustituye y la respuesta devuelve el usado
- El documento OpenAPI generado coincide con el versionado en el repositorio

## 7. Pruebas de invariantes

Basadas en propiedades: se generan secuencias aleatorias de operaciones válidas y se
comprueba que ciertas afirmaciones se sostienen siempre. Con `fast-check`.

```ts
it('I-5 · el saldo materializado siempre coincide con la suma del ledger', async () => {
  await fc.assert(fc.asyncProperty(arbitraryMovementSequence(), async (moves) => {
    await applyAll(moves);
    const materialized = await readAllBalances();
    const derived      = await sumLedgerByPosition();
    expect(materialized).toEqual(derived);
  }));
});
```

Las cuatro propiedades que se prueban así:

- **I-5** — reconciliación de saldo contra ledger, tras cualquier secuencia válida
- **Conservación** — la suma de todo lo que salió por nodos `TERMINAL`, más el
  inventario propio, menos lo que entró por nodos `SOURCE`, es siempre cero
- **I-9** — un producto `SERIAL` nunca está en dos nodos custodiables a la vez
- **I-18** — el pendiente de todo check-out está entre cero y su cantidad tras
  cualquier secuencia de check-ins parciales y compensaciones

Estas cuatro son afirmaciones sobre el sistema entero, no sobre una operación. Un
ejemplo escrito a mano solo prueba el caso que a alguien se le ocurrió; la
generación encuentra la secuencia de siete pasos que nadie imaginó. Encontró una
en el plan 6: una serie vendida, devuelta por el proveedor a otra estantería, y
una compensación de la venta que la dejaba en dos sitios a la vez (D-41).

## 8. Reglas de arquitectura

Las cuatro reglas de [01](01-arquitectura.md) se comprueban mecánicamente con
`dependency-cruiser`, como parte de `pnpm lint`:

| Regla | Comprobación |
|---|---|
| R-1 · dominio puro | Ningún archivo bajo `domain/` importa `@nestjs/*`, `kysely`, `pg`, `@prisma/*`, `fastify`, ni `../application`, ni `../infrastructure` |
| R-2 · sin ciclos | Grafo acíclico entre librerías, y el orden de dependencia declarado se respeta |
| R-3 · solo el barril | Ninguna importación cruzada apunta a un camino interno de otra librería |
| R-4 · `persistence` no se importa | Ninguna librería de dominio importa `@app/persistence` |

Una regla que solo vive en un documento se rompe en el tercer mes. Estas fallan la
compilación.

## 9. Cobertura

| Ámbito | Mínimo | Por qué |
|---|---|---|
| `libs/inventory/domain` | **100 %** líneas y ramas | Es el ledger. No hay línea que no importe. |
| `libs/process/domain` | **100 %** líneas y ramas | Es el motor. Igual. |
| Resto de `domain/` | 95 % | |
| `application/` | 90 % | |
| Global | 85 % | |

**La cobertura es un suelo, no una meta.** Un módulo al 100 % con aserciones
triviales está peor probado que uno al 85 % con las invariantes cubiertas. El
umbral existe para detectar código que nadie ejercitó, no para presumir.

Los dos módulos al 100 % lo están porque son los únicos donde un error no se
manifiesta como una pantalla rara, sino como un inventario que miente.

## 10. Rendimiento

Un conjunto con datos representativos —1.000.000 de movimientos, 5.000 productos,
500 nodos, 50 organizaciones— y los objetivos de la tabla de
[04 §7](04-persistencia.md). Corre en CI nocturno, no en cada commit.

Una regresión de más del 50 % sobre el objetivo falla la ejecución. Lo que se busca
no es el número exacto, sino enterarse el día que una consulta deje de usar índice.

## 11. Puertas de CI

En cada push:

```
pnpm lint          oxlint + reglas de arquitectura
pnpm typecheck     tsc --noEmit sobre apps, libs y specs
pnpm db:check      prisma migrate diff --exit-code: el historial de migraciones
                   reproduce schema.prisma   (Postgres, shadow database)
pnpm test          dominio + aplicación          (sin infraestructura)
pnpm test:e2e      integración + e2e + invariantes
```

Y, en un job aparte que corre en paralelo:

```
pnpm blackbox      el contrato por HTTP contra la aplicación levantada, sobre un
                   socket real; compila, arranca start:prod, espera al contrato
```

Va al lado y no dentro del primero porque levantar la aplicación es lento y no tiene por
qué alargar la ruta crítica: quien rompe un tipo quiere saberlo sin esperar a un build.

Ninguna se salta. `pnpm db:check` existe porque la mitad del esquema es SQL
escrito a mano dentro de las migraciones ([04 §5.1](04-persistencia.md)): sin
esa puerta, editar `schema.prisma` y olvidar la migración —o al revés— pasaría
desapercibido hasta el despliegue. `pnpm typecheck` es especialmente crítico en este repositorio:
SWC elimina los tipos sin comprobarlos, así que **un error de tipos no rompe la
compilación** — es esa puerta, y solo esa, la que lo detecta.

## 12. Datos de prueba

Constructores con valores por defecto sensatos y sobrescritura parcial:

```ts
const product = aProduct({ trackingMode: 'LOT' });
const node    = anInternalNode({ path: 'BOD-A/Z1/E3/B2' });
const movement = aMovement({ from: node, to: custody, quantity: '3.000' });
```

Viven en `libs/*/test/builders/`. Sin fixtures JSON compartidos entre pruebas: una
prueba debe poder leerse entera sin abrir otro archivo, y un fixture compartido
acaba siendo modificado para una prueba y rompiendo otras cinco.

## 13. Documentos relacionados

- [00 — Visión y alcance](00-vision-y-alcance.md) — los criterios de éxito son e2e
- [01 — Arquitectura](01-arquitectura.md) — las reglas que aquí se verifican
- [02 — Modelo de dominio](02-modelo-de-dominio.md) — las invariantes numeradas
- [04 — Persistencia](04-persistencia.md) — constraints y RLS
- [07 — Composición y contexto de ejecución](07-composicion-y-contexto-de-ejecucion.md) — el borde que se prueba en integración
- [08 — Acceso a datos](08-acceso-a-datos.md) — qué prueba el DAO genérico y qué las concreciones
