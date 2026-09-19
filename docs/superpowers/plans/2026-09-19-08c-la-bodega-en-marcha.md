# Plan 8c — La bodega en marcha

> Rama `plan/08c-la-bodega-en-marcha` · documento en
> `docs/superpowers/plans/2026-09-19-08c-la-bodega-en-marcha.md`
> Derivado del plan 8, como 3b..3f lo fueron del 3. **Sin fases del maestro.**

## Estado: **ejecutado** · 2026-09-19

---

## Context

La API tiene 52 operaciones y la caja negra las cubre todas: 549 comprobaciones, cada
operación con su camino feliz y su camino de error, cruzado contra el OpenAPI publicado.
Lo que ninguna de las seis suites hacía es **una jornada de trabajo**.

Están organizadas por endpoint, y esa es exactamente su virtud y su techo. Un `POST
/v1/movements` que devuelve 201 con el saldo correcto no dice nada sobre lo que pasa cuando
la recepción de la mañana deja existencias que el conteo del sábado ajusta, que el préstamo
del lunes saca, que la devolución parcial reabre y la compensación del martes deshace. Los
defectos que viven ahí no son de un endpoint: son de la costura entre dos.

Y hay una segunda cosa que no se estaba comprobando, más grave: **que la bodega cuadre**.
Los invariantes I-1..I-18 y la conservación —la suma de todos los saldos de un producto
sobre todos los nodos es exactamente cero— están probados como propiedades en
`test/invariants/`, en proceso, con dobles. Nunca desde fuera, contra el socket, después de
una secuencia real de gestos. Un verde que solo dice «contestó 200» no es el verde que
quiere un jefe de almacén.

**Lo que este plan añade** son siete jornadas y un arqueo al final de cada una. Lo que
encontró son seis defectos, cuatro de ellos 500 reproducibles.

---

## Global Constraints (heredadas)

- **Solo caja negra.** Ni un `fastify.inject()`, ni un doble, ni una consulta a la base para
  afirmar nada — salvo las tres comprobaciones del `REVOKE` que ya existían en
  `40-transversal.sh`, que son de permisos y no de datos.
- **Verificar contra un proceso limpio.** Puerto elegido libre y comprobado, binario recién
  compilado, y prueba de identidad antes de creerse un verde.
- **`lib.sh` solo se amplía.** Lo sourcean las seis suites existentes *y* `scripts/seed.sh`.
- **Un plan por rama, merge local a master.**

---

## Fase 0 · El terreno, que estaba sucio

Tres hechos comprobados antes de empezar, no supuestos:

| Qué había | Estado real |
|---|---|
| `:3000` | `tubodega-tubodega-1` de compose, **imagen de hace seis días**: su `openapi.json` publica **20 paths / 29 operaciones**. No conoce `/nodes`, `/movements`, `/stock` ni `/process-*`. Correr la suite contra él es un rojo masivo falso |
| `:3100` | Un `node dist/apps/tubodega/main` **huérfano** de una sesión anterior (pid 136937), con 37/51. El falso verde exacto contra el que avisa la restricción heredada del 8b |
| `:5432` | El Postgres de compose, sano, con las cuatro bases de `db/init/01-roles.sql` |

**Trampa que costó un susto:** `pgrep -f 'dist/apps/tubodega/main'` **se matchea a sí mismo**
cuando el patrón viaja dentro del comando, y el `kill` mata la propia shell. El patrón va con
una clase de un carácter: `'dist/apps/tubodega/[m]ain'`. Y el filtro para no matar el proceso
de dentro del contenedor —que compose relanzaría— es el cgroup, no el nombre.

Lo que se montó: huérfano muerto, contenedor obsoleto parado (no borrado), base dedicada
`tubodega_qa` migrada, binario recién compilado en el **:3210** elegido libre, y tres pruebas
de identidad antes de la primera comprobación: que el que escucha es *mi* pid, que sirve
37 paths / 51 operaciones, y que eso coincide con el snapshot del árbol de trabajo.

Línea base: **549 comprobaciones, 0 fallos, cobertura 52/52, exit 0.**

---

## Los siete escenarios

| # | Suite | Jornada | Qué cruza |
|---|---|---|---|
| E1 | `50-jornada-recepcion.sh` | El camión de las seis | tenencia · catálogo · ubicaciones · procesos · ledger · idempotencia |
| E2 | `51-conteo-ciclico.sh` | El inventario del sábado | lotes · ajustes · fronteras · subárboles · histórico por fecha |
| E3 | `52-prestamo-herramienta.sh` | El taladro de Juan | custodias (I-17, I-18) · series · compensación |
| E4 | `53-venta-y-devolucion.sh` | La venta del martes | fronteras TERMINAL · compensación · paginación · roles |
| E5 | `54-reorganizacion-y-personal.sh` | Se muda la zona | árbol · `If-Match` · sesiones · **aislamiento entre organizaciones** |
| E6 | `55-catalogo-masivo.sh` | La hoja de cálculo del proveedor | import de 120 filas · campos propios · media · lote todo-o-nada |
| E7 | `56-cierre-de-jornada.sh` | El arqueo, con dos operarios a la vez | **concurrencia real** · versionado de plantillas |

Cada uno monta su organización, encadena gestos y **cierra con arqueo**. Después de cada
422 se **relee el estado**: un error que deja el inventario a medias es peor que no tener el
endpoint, y es lo único que una suite de códigos de estado no ve.

### El arqueo

Tres funciones en `lib.sh`, todo por HTTP. Son la forma externa de las propiedades de
`test/invariants/`, y la única red que detecta que el saldo materializado y el ledger se
separaron:

- **Conservación** — la suma de todos los saldos de un producto, estanterías y custodias y
  fronteras con su signo, es exactamente cero. `nonZeroOnly=false` es obligatorio: sin él
  desaparecen justo las filas que cancelan y la propiedad se cumpliría por no mirar.
- **Ledger** — el saldo se reconstruye desde los asientos (restando en el origen, sumando en
  el destino) y se compara clave a clave. Una compensación no necesita trato especial: es un
  asiento más con sus dos extremos.
- **Custodias** — lo pendiente es lo que está en manos de alguien, y está entre cero y lo
  prestado (I-18). Es la discriminante: un check-in que baja el saldo sin bajar el pendiente,
  o una compensación que borra el saldo y deja la deuda viva, sale aquí y en ningún otro sitio.

Los decimales se suman en **milésimas enteras** (`$JQ_MILI`), con el signo tratado aparte:
pasarlos por `tonumber` los mete en un double y devuelve el problema que el contrato evitó al
mandarlos como cadena, y sin tratar el signo `"-0.500"` sale positivo.

---

## Hallazgos

| id | Dónde | Esperado | Observado | Decisión |
|---|---|---|---|---|
| **H-1** | `GET /v1/movements?cursor=basura`, ídem `/products` | 400 `invalid-filter` | **500 `internal`** | arreglado · **D-69** |
| **H-2** | `GET /v1/stock?sort=` | ordenar, o rechazar | se acepta y **se descarta**: asc y desc devuelven el mismo orden | arreglado · **D-70** |
| **H-3** | `GET /v1/stock?productId=null`, `/movements?actorId=xyz` | 400 `invalid-filter` | **500 `internal`** · `invalid input syntax for type uuid` | arreglado · **D-71** |
| **H-4** | `POST /v1/products/{id}/media` con JSON inválido | 400 `validation-failed` | 415 `unsupported-media-type` | arreglado · **D-72** |
| **H-5** | dos `POST /v1/process-templates/{code}/versions` a la vez | 409 `template-version-taken` | **500 `internal`** · 23505 sin traducir | arreglado · **D-73** |
| **H-6** | plantilla cuyo CONFIRM es omitible, o que no termina en CONFIRM | 422 `invalid-template` | **201**, y la instancia llega a COMPLETED sin un asiento | arreglado · **D-74** |
| **H-6b** | consecuencia de H-6 sobre datos ya escritos | — | una organización con una plantilla ya inválida quedaba **atascada** | arreglado con H-6 · **D-74** |

### Reproducciones mínimas

Las seis, autocontenidas. `$V` es la raíz `/v1` y `$T` un token de cualquier organización.

**H-1 · el cursor que revienta el servidor**
```bash
curl -sS -i "$V/movements?cursor=no-es-un-cursor" -H "authorization: Bearer $T"
# → HTTP 500 · {"type":".../internal"}      esperaba 400 invalid-filter
```

**H-2 · el orden que no ordena**
```bash
curl -sS "$V/stock?productId=$P&sort=nodeId"  -H "authorization: Bearer $T" | jq -c '[.data[].nodeId]'
curl -sS "$V/stock?productId=$P&sort=-nodeId" -H "authorization: Bearer $T" | jq -c '[.data[].nodeId]'
# → las dos listas idénticas.  (/movements con el mismo gesto sí invierte)
```

**H-3 · el identificador que llega crudo a Postgres**
```bash
curl -sS -o /dev/null -w '%{http_code}\n' "$V/stock?productId=null"      -H "authorization: Bearer $T"  # 500
curl -sS -o /dev/null -w '%{http_code}\n' "$V/movements?actorId=xyz"     -H "authorization: Bearer $T"  # 500
# log: error: invalid input syntax for type uuid: "null"
```

**H-4 · el 415 que no era un 415**
```bash
curl -sS -o /dev/null -w '%{http_code}\n' -X POST "$V/products/$P/media" \
  -H "authorization: Bearer $T" -H 'content-type: application/json' -H "idempotency-key: $(uuidgen)" \
  -d '{"storageKeys":"no-es-un-array"}'
# → 415 unsupported-media-type, con un content-type que la ruta sí acepta
```

**H-5 · la carrera al publicar una versión**
```bash
P='{"version":2,"steps":[{"id":"item","type":"SCAN_ITEM","required":true,"config":{},"transitions":[{"to":"c"}]},
                         {"id":"c","type":"CONFIRM","required":true,"config":{},"transitions":[{"to":null}]}]}'
for i in a b; do
  curl -sS -o /dev/null -w "%{http_code} " -X POST "$V/process-templates/AJUSTE_ENTRADA/versions" \
    -H "authorization: Bearer $T" -H 'content-type: application/json' -H "idempotency-key: k-$i" -d "$P" &
done; wait; echo
# → «201 500» dos de cada tres veces.  log: UniqueViolationError: process_template_org_id_code_version_key
```

**H-6 · el proceso que completa sin mover nada**
```bash
curl -sS -X POST "$V/process-templates/TRASLADO/versions" -H "authorization: Bearer $T" \
  -H 'content-type: application/json' -H "idempotency-key: $(uuidgen)" -d '{"version":2,"steps":[
  {"id":"item","type":"SCAN_ITEM","required":true,"config":{},"transitions":[{"to":"c"}]},
  {"id":"c","type":"CONFIRM","required":false,"config":{},"transitions":[{"to":null}]}]}'   # → 201

I=$(curl -sS -X POST "$V/process-instances" -H "authorization: Bearer $T" -H 'content-type: application/json' \
      -H "idempotency-key: $(uuidgen)" -d '{"templateCode":"TRASLADO"}' | jq -r .instance.id)
curl -sS -X POST "$V/process-instances/$I/steps/item/complete" … -d '{"payload":{"code":"TOR-M8"}}'
curl -sS -X POST "$V/process-instances/$I/steps/c/complete"    … -d '{"payload":null}' | jq -c '{estado:.instance.state, movimientos:(.movements|length? // 0)}'
# → {"estado":"COMPLETED","movimientos":0}   y GET /v1/movements no creció
```

---

## Decisiones nuevas (continúan en D-69)

Las seis van a la tabla del plan maestro. Aquí el porqué largo de las dos que no son
mecánicas.

### D-70 · por qué `/stock` rechaza el orden en vez de honrarlo

Había tres salidas: honrarlo, rechazarlo, o dejarlo. Dejarlo era lo único inadmisible —el
cliente se queda creyendo que ordenó—, y entre las otras dos manda lo que el propio código ya
decía: *«a balance has no meaningful order beyond its natural key, and offering one would be
offering a seq scan»*. Honrarlo significaba llevar la dirección hasta el keyset del DAO y
cambiar el orden de respuestas 2xx que hoy funcionan. Rechazarlo es el molde de D-60, donde
`/v1/process-templates` rechaza toda clave de query porque no pagina: **una colección que no
ofrece algo lo dice, no lo acepta y lo tira.**

`parsePage` gana la forma de expresarlo: `sortable: []` significa «este listado no ordena», y
un `?sort=` explícito es entonces un parámetro no admitido como cualquier otro (D-10).

### D-74 · la guarda de las plantillas, y lo que destapó

Que una plantilla tenga que terminar en un `CONFIRM` obligatorio es poco discutible: P-6 dice
que los efectos salen al cerrar y `CONFIRM` es el único que los emite, así que las dos formas
de quedarse sin ellos son no terminar en `CONFIRM` y poder saltárselo. Las seis de fábrica ya
cumplían, y hay una prueba que lo ancla para que el arreglo sea seguro.

**Lo que no estaba previsto y es la mitad importante de esta decisión:** `parseSteps` se
re-evalúa en **cada lectura**, a propósito (`template.ts` no tiene `rehydrate`, y el
comentario explica por qué). Así que la guarda no solo impide publicar plantillas rotas:
también hace ilegibles las que ya estaban escritas. Y el daño era mayor de lo que parece:

- `GET /v1/process-templates` devolvía **422 para el listado entero**, no solo para la
  plantilla rota, porque `listActive` las construye todas.
- Y publicar una versión sana —el único arreglo posible— **también fallaba**, porque
  `CreateTemplateVersion` cargaba la activa para comparar números de versión.

Una organización en ese estado quedaba **atascada para siempre**. No es teórico: pasó en la
base de esta campaña, con las plantillas que los propios escenarios habían publicado antes
del arreglo, y está verificado contra el socket.

El arreglo es que publicar deje de necesitar la plantilla. Solo necesita **el número** de la
activa, que es una columna: el puerto gana `activeVersion`, `versionExists` y
`deactivateAll`, las tres contestadas con la fila y no con la entidad. Publicar una versión
sana desactiva la rota, y el listado vuelve a leerse. De paso, el camino de escritura se
ahorra dos cargas completas de dominio.

**Nota para quien tenga datos:** si alguna organización tiene hoy una plantilla activa que no
termina en un `CONFIRM` obligatorio, su `GET /v1/process-templates` responderá 422 hasta que
publique una versión sana de cada código afectado. El camino existe y funciona; no hace falta
migración, pero conviene saberlo antes de que lo cuente un usuario.

---

## Lo que encontró cada capa

Vale la pena dejarlo dicho, porque decide dónde merece la pena escribir la próxima prueba.

- **Solo la caja negra sobre un socket real** podía encontrar H-1, H-3 y H-5: los tres son
  errores que nacen en la capa de datos y mueren en el filtro de excepciones, y los tres
  llegan con un valor que ningún tipo de TypeScript permite escribir (`"null"` en un `ProductId`,
  un cursor de otra ordenación, dos transacciones a la vez).
- **H-5 además necesitaba concurrencia de verdad**: `fastify.inject()` no abre la ventana.
- **H-6 lo podía haber encontrado una prueba de dominio**, y no lo hizo porque la prueba que
  existía *documentaba el comportamiento como propiedad del runner* («un proceso que cierra
  sin CONFIRM termina sin movimientos») en lugar de preguntarse si la plantilla debería poder
  existir. La propiedad era cierta; la pregunta no se había hecho.
- **H-2 lo encuentra cualquiera que compare dos respuestas**, y nadie lo había comparado:
  las suites por endpoint comprueban que `?sort=` devuelve 200, no que ordene.

---

## Desviaciones

1. **Un falso verde propio, y es el más instructivo.** `jq -r "$JQ_MILI" --arg x y '<programa>'`
   pasa el `def` como programa y el programa como **fichero**: jq falla, las dos cadenas salen
   vacías, y la comparación pasa. Todas las aserciones de saldo del primer escenario estaban
   en verde sin comprobar nada. Ahora el programa va concatenado y `cantidad`/`saldo_es`
   fallan si no sale un número: dos vacíos son iguales y no son una prueba.
2. **Un fallo tragado por un `> /dev/null`.** Se usó `ejecutar_proceso` para una instancia que
   se abandona a medias, silenciando su salida; el ayudante exige llegar al final, así que
   contó un fallo que nadie veía. Se partió en `abrir_proceso` + `avanzar_proceso`, y no queda
   ni un `/dev/null` en los siete escenarios.
3. **Una aserción intermitente por construcción.** Fijar «un 201 y un 409» en una carrera es
   escribir una prueba que falla según el reloj: si la primera termina antes de que entre la
   segunda, la segunda es un eco y también es correcto. `reparto_legitimo` admite las dos
   formas; lo que no admite ninguna es el efecto, y eso se afirma sobre el ledger.
4. **El orden de un escenario no debe depender de que el sistema esté sano.** El bloque de
   plantillas rotas de E7 estaba antes de la jornada; publicar una rota la dejaba activa
   mientras el defecto viviera y envenenaba los procesos de después. Va al final, y cada
   intento usa un número de versión distinto: con el mismo, el segundo saldría 409 y taparía
   el hallazgo tras un error que parece razonable.
5. **Dos pruebas existentes ajustadas, ninguna por conveniencia.** Están explicadas en el
   commit de los arreglos: la del runner que documentaba H-6, y la del paso inalcanzable, que
   usaba un huérfano que además cerraba y dejó de probar la inalcanzabilidad sin dejar de pasar
   (lo delató el umbral de cobertura del 100% en `libs/process/src/domain`, no una persona).

---

## Verificación de extremo a extremo

Contra un binario recién compilado, en el `:3210` elegido libre, sobre `tubodega_qa`, con las
tres pruebas de identidad pasadas.

```
pnpm lint            ✔  (2 avisos preexistentes en products.dto.ts, de 121b453)
pnpm typecheck       ✔
pnpm db:check        ✔  No difference detected
pnpm test            ✔  849 pruebas · 67 ficheros
pnpm test:e2e        ✔  282 pruebas · 32 ficheros
pnpm test:cov        ✔  sin errores de umbral
pnpm openapi:write   ✔  snapshot sin cambios — el contrato ya prometía lo que ahora se cumple
pnpm blackbox        ✔  1063 comprobaciones · 0 fallos · exit 0
                        cobertura del contrato: 52/52 ejercitadas, 52 feliz, 52 error
pnpm seed            ✔  siembra un mundo nuevo sin error
```

| suite | antes | después |
|---|---:|---:|
| tenencia · catalogo · ubicaciones · movimientos · procesos · transversal | 549 | 549 |
| jornada-recepcion | — | 90 |
| conteo-ciclico | — | 69 |
| prestamo-herramienta | — | 80 |
| venta-y-devolucion | — | 63 |
| reorganizacion-y-personal | — | 71 |
| catalogo-masivo | — | 68 |
| cierre-de-jornada | — | 73 |
| **total** | **549** | **1063** |

---

## Qué queda fuera

- **`GET /v1/stock?under=` sigue devolviendo `nodeId:""` y `nodeKind:"INTERNAL"`** en las filas
  agregadas. El agregado no pertenece a ningún nodo, así que fingir uno es una mentira pequeña
  pero es una mentira, y un cliente que confíe en ese `nodeKind` se equivoca. Dejar de fingirlo
  significa una clave nueva (`subtreeRootId`, o una forma distinta para esas filas), y eso es
  contrato, no arreglo. Anotado y no tocado.
- **El replay de idempotencia no reconstruye `Location`.** Documentado en
  `idempotency.interceptor.ts` como decisión consciente; cambiarlo cambia la forma de un 2xx.
  Los escenarios lo dejan anclado tal como es.
- **`template-has-instances` sigue sin ruta que lo produzca.** Es código muerto declarado a
  propósito, para el día que haya edición de plantillas.
- **Las alertas** son el plan 9 y no se han tocado. Los escenarios no las mencionan.
