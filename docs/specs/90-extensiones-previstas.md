# 90 — Extensiones previstas

> Lo que quedó deliberadamente fuera del MVP, con la puerta abierta.
>
> Para cada una: **qué la habilita ya**, **qué falta**, y —lo más importante— **qué
> no debe romperse al añadirla**. Este último punto es el que evita que una
> extensión, hecha con prisa, destruya una propiedad que costó diseñar.

## Cómo leer este documento

No es una hoja de ruta. No hay fechas ni prioridades: eso lo decide el producto, no
el diseño. Es un registro de qué se pensó y qué se dejó preparado, para que quien
llegue a implementar una de estas cosas no tenga que redescubrir el razonamiento.

Están ordenadas por lo cerca que están de poder hacerse, no por su valor.

---

## 1. Conteo cíclico

**Qué es.** Contar 20 SKUs al día en lugar de 800 el 31 de diciembre. La diferencia
entre lo contado y lo registrado genera un ajuste trazable con responsable.

**Qué lo habilita ya.** Todo el mecanismo, en realidad. Un conteo produce una
diferencia; una diferencia es un ajuste; un ajuste es un movimiento entre
`SOURCE:adjustment-in` o `TERMINAL:adjustment-out` y el nodo contado. Eso ya existe y
está probado. El flujo del conteo es una plantilla de proceso más:

```
CONTEO   SELECT_NODE(INTERNAL) → SCAN_ITEM → CAPTURE_QTY → CONFIRM
```

**Qué falta.**

- Una entidad `CountTask` con su alcance —un nodo, un subárbol, una clase ABC— y su
  estado
- Selección de qué contar: por rotación, por valor, o por antigüedad del último conteo
- Un manejador `CONFIRM` capaz de emitir la diferencia en vez de la cantidad absoluta,
  o —mejor— un tipo de paso `RECONCILE_QTY` que calcule la diferencia contra el saldo
  vigente

**Qué no debe romperse.** El ajuste tiene que seguir siendo un movimiento normal, con
su `reason` obligatorio y su actor. La tentación será crear una tabla
`inventory_count_adjustment` aparte "porque es distinto". No lo es: es un ajuste, y
sacarlo del ledger rompería la invariante de conservación.

---

## 2. Órdenes de compra y recepción contra documento

**Qué es.** Registrar lo que se pidió al proveedor y recibir contra ello,
controlando faltantes y sobrantes. Hoy la recepción es ciega: el operario declara lo
que llegó.

**Qué lo habilita ya.** Los proveedores existen como nodos `SOURCE`. La plantilla
`RECEPCION` ya selecciona el nodo de origen. Un movimiento puede referenciar el
proceso que lo originó, y ese proceso podría referenciar la orden.

**Qué falta.**

- Entidades `PurchaseOrder` y `PurchaseOrderLine`, probablemente en un contexto
  `purchasing` propio
- Un tipo de paso `SELECT_DOCUMENT` que cargue las líneas esperadas al contexto
- Comparación de lo recibido contra lo esperado, y política de tolerancia

**Qué no debe romperse.** El movimiento no debe ganar un campo `purchaseOrderId`. La
relación va por `processInstanceId`, y de ahí a la orden. Añadir referencias de
documento al ledger es el primer paso para acabar con quince columnas opcionales que
solo aplican a un tipo de operación — exactamente la erosión que
[12 §1](12-inventory.md) previene.

---

## 3. Picking y pedidos de salida

**Qué es.** Crear un pedido, generar una lista de picking ordenada por ubicación,
recorrerla y despachar.

**Qué lo habilita ya.** El `path` de los nodos permite ordenar una ruta de picking
sin estructura adicional. La plantilla `SALIDA` ya despacha a nodos `TERMINAL`.

**Qué falta.** Sobre todo, una pieza que el MVP no tiene: **reservas**.

Una reserva es stock comprometido que aún no se ha movido. Sin ella, dos pedidos
pueden prometer la misma unidad. Se implementa como una columna en `stock_balance`:

```sql
ALTER TABLE stock_balance ADD COLUMN reserved numeric(18,3) NOT NULL DEFAULT 0;
ALTER TABLE stock_balance ADD CONSTRAINT reserved_within_quantity
  CHECK (reserved >= 0 AND reserved <= quantity);
```

Además: entidades `SalesOrder` y `PickList`, y una plantilla de proceso que recorra
líneas.

**Qué no debe romperse.** La reserva **no es un movimiento**. La mercancía no se ha
ido a ninguna parte, sigue en su bin. La tentación será modelarla como movimiento a
un nodo `RESERVADO`, y sería un error: inflaría el ledger con asientos que no
describen ningún hecho físico, y rompería la correspondencia entre el histórico y la
realidad. Una reserva es una anotación sobre un saldo, y su sitio es
`stock_balance`.

---

## 4. Flujos con ramas

**Qué es.** Que un proceso pueda bifurcarse: *"si el valor supera X, exige
aprobación"*, *"si el producto es perecedero, pide fecha de vencimiento"*.

**Qué lo habilita ya.** Las tres decisiones de [13 §2](13-process.md), tomadas
precisamente para esto:

- Los pasos se direccionan por `id`, no por índice
- `transitions` es una lista, no un campo `next`
- Las plantillas se versionan y la instancia guarda su versión

Y `ProcessRunner` es una interfaz con una implementación.

**Qué falta.**

- `GraphRunner implements ProcessRunner` — misma interfaz, mismas tablas
- Un evaluador de condiciones sobre el contexto del proceso. **Un lenguaje mínimo y
  cerrado**, no expresiones arbitrarias: comparaciones sobre campos conocidos y nada
  más
- Retirar la invariante P-8, que hoy rechaza más de una transición por paso
- Un editor visual, o el producto no será usable por quien lo necesita

**Qué no debe romperse.** El motor debe seguir sin conocer los manejadores, y los
manejadores sin conocerse entre sí. La condición se evalúa **en el runner**, sobre el
contexto, nunca dentro de un manejador. Un manejador que decidiera el paso siguiente
haría que el flujo dejara de estar en la plantilla y volviera a estar en el código,
que es de donde lo sacamos.

Y la condición debe seguir siendo un lenguaje cerrado. Permitir expresiones
arbitrarias convierte cada plantilla en código sin pruebas, ejecutándose en
producción.

---

## 5. Offline-first

**Qué es.** Que un cliente funcione días sin red: réplica local del catálogo y del
stock, operaciones encoladas, sincronización bidireccional.

**Qué lo habilita ya.** Es la extensión mejor preparada, porque sus requisitos se
metieron en el diseño desde el principio:

| Requisito del offline | Ya está |
|---|---|
| Nombrar un hecho antes de que el servidor lo conozca | UUIDv7 generado por el cliente |
| Reintentar sin duplicar | `Idempotency-Key` obligatoria, con ventana de 7 días |
| Que el pasado no cambie bajo los pies de la réplica | Ledger append-only; corrección por compensación |
| Distinguir cuándo pasó de cuándo se supo | `occurredAt` y `recordedAt` separados |
| Reconstruir el estado desde los hechos | El saldo es derivable del ledger |

**Qué falta.** Casi todo del lado del cliente, y poco del servidor:

- Un endpoint de sincronización incremental: *"dame todo lo ocurrido desde este
  cursor"*, sobre `recordedAt`
- Una réplica local en el cliente
- Política de conflictos. Con el modelo actual hay menos de los que parece: dos
  clientes que reciben mercancía a la vez generan dos movimientos y ambos son
  correctos. **El único conflicto real es el saldo insuficiente detectado al
  sincronizar**, y su resolución es de producto, no técnica: se acepta el movimiento
  y se levanta una alerta de discrepancia, para que una persona decida.

**Qué no debe romperse.** La idempotencia y la inmutabilidad son el cimiento. La
tentación, al implementar la sincronización, será permitir que el cliente "corrija"
un movimiento ya enviado. No: se compensa, igual que en línea. Un ledger con dos
reglas distintas según el origen del movimiento deja de ser auditable.

---

## 6. Cliente PWA

**Qué es.** La interfaz que el MVP no tiene. Instalable, con cámara para escanear
y fotografiar.

**Qué lo habilita ya.** El contrato de API completo y documentado, y en particular la
respuesta de `CompleteStep`, que devuelve la definición del paso siguiente. **Un
cliente puede ser genérico**: no necesita conocer los procesos, solo pintar el paso
que el servidor le indique. Añadir un tipo de paso nuevo no obliga a desplegar el
cliente, siempre que sepa renderizar su forma.

**Qué falta.** El cliente entero. Escaneo con `BarcodeDetector` y respaldo a una
librería; captura y compresión de imágenes; un renderizador por tipo de paso.

**Qué no debe romperse.** Que la API siga siendo el contrato completo. En cuanto
exista una interfaz, aparecerá la tentación de añadir endpoints "para la pantalla X"
que devuelvan formas a medida. Eso rompe la propiedad más valiosa del MVP: que el
contrato de integración y el de la aplicación sean el mismo.

---

## 7. Webhooks e integraciones salientes

**Qué es.** Que un ERP, un e-commerce o un canal de mensajería reciba lo que pasa.

**Qué lo habilita ya.** El outbox transaccional completo. Los eventos ya se escriben
en la misma transacción que el hecho, con su catálogo definido en
[05 §4](05-eventos-e-integraciones.md).

**Qué falta.** Las tablas `webhook_subscription` y `webhook_delivery`, un consumidor
del outbox que entregue por HTTP, firma HMAC con marca de tiempo, y reintentos con
retroceso exponencial. El diseño está en [05 §7](05-eventos-e-integraciones.md).

**Qué no debe romperse.** **El productor no cambia.** Si implementar webhooks obliga
a tocar un caso de uso, es señal de que se está haciendo mal: lo único que cambia es
quién consume el outbox.

Y la compatibilidad de los eventos deja de ser negociable en cuanto haya un
consumidor externo. Las reglas de [05 §6](05-eventos-e-integraciones.md) pasan a ser
vinculantes.

---

## 8. Costeo de inventario

**Qué es.** Saber cuánto vale lo que hay, y cuánto costó lo que salió. PEPS, costo
promedio ponderado, o costo específico.

**Qué lo habilita ya.** El ledger tiene exactamente la granularidad necesaria: cada
movimiento identifica producto, lote, cantidad y momento. Un costeo PEPS es una
consulta sobre ese histórico.

**Qué falta.**

- Costo unitario en los movimientos de entrada
- Un saldo valorizado, paralelo a `stock_balance`
- Elección de método, que es una decisión contable con implicaciones fiscales
  distintas en cada país

**Qué no debe romperse.** El ledger de cantidades y el de valor deben permanecer
separados. Mezclarlos —hacer que un movimiento lleve cantidad y costo en la misma
fila con la misma autoridad— significa que una corrección contable obligaría a tocar
el registro físico. Son dos verdades distintas: cuánto hay, y cuánto vale.

Esta es la extensión que más conviene no improvisar. Es la más fácil de hacer mal de
una forma que solo se descubre en una auditoría.

---

## 9. Kits, ensamblados y producción ligera

**Qué es.** Un producto que se arma con otros: una canasta navideña, un kit de
herramientas.

**Qué lo habilita ya.** Más de lo que parece. Un ensamblado es un proceso que consume
componentes y produce un producto terminado — es decir, movimientos de los
componentes a `TERMINAL:consumption` y un movimiento de `SOURCE:production` al
producto final. **El ledger no cambia en absoluto.**

**Qué falta.** Una entidad de composición en `catalog`, y una plantilla de proceso que
la recorra emitiendo los movimientos correspondientes.

**Qué no debe romperse.** La conservación. Es tentador modelar el ensamblado como una
transformación —una fila que dice "3 de A se convirtieron en 1 de B"— y eso rompe la
partida doble. Con nodos de frontera, la conservación se mantiene y la trazabilidad
también: se puede responder qué componentes entraron en qué unidad producida.

---

## 10. Multi-organización y grupos

**Qué es.** Que una persona administre varios negocios, o que un grupo tenga
visibilidad consolidada de sus filiales.

**Qué lo habilita ya.** La organización es la frontera de aislamiento y está en toda
tabla. `RequestContext` lleva `orgId` explícito, y ningún caso de uso lo deduce de
otra cosa.

**Qué falta.** Una tabla de pertenencia usuario-organización —que retira la
invariante T-3—, un selector de organización activa, y para la consolidación, una
entidad de grupo por encima con políticas RLS que la contemplen.

**Qué no debe romperse.** El aislamiento. La consolidación es la funcionalidad con
más riesgo de todo este documento: cualquier consulta que cruce organizaciones tiene
que ser explícita, auditada y estar fuera del camino normal. La invariante I-6 no
admite excepciones "solo para reportes" — es así como se filtran datos entre clientes.

---

## 11. Particionado del ledger

**Qué es.** Partir `movement` por rango de `occurred_at` cuando el volumen lo pida.

**Qué lo habilita ya.** Todos los índices empiezan por `org_id`, y las consultas
naturales llevan rango de fecha. La tabla está lista para particionarse sin cambiar
ninguna consulta.

**Qué falta.** Nada de diseño; es una decisión operativa. Se hace cuando las métricas
de [04 §7](04-persistencia.md) se degraden, no antes.

**Qué no debe romperse.** La unicidad de `(org_id, idempotency_key)`. En una tabla
particionada, un índice único debe incluir la clave de partición o dejar de ser
global — y perder esa unicidad significa perder la invariante I-7. Es el detalle que
convierte un particionado rutinario en un incidente, y hay que resolverlo antes de
particionar, no después.

---

## 12. Procesos multi-línea

**Qué es.** Que una sola instancia de `RECEPCION` registre veinte productos y
los asiente todos al confirmar. Hoy una instancia produce un movimiento
([13 §3](13-process.md)); veinte productos son veinte instancias.

**Qué lo habilita ya.** `CONFIRM` emite una lista de borradores, no uno;
`RecordMovementBatch` recibe una lista y la asienta todo-o-nada; el contexto de
proceso acumula valores por `StepId`.

**Qué falta.** Un mecanismo de repetición en la plantilla —un grupo de pasos
que se recorre N veces— y, con él, un índice de iteración en `step_completion`:
la invariante P-3 pasa de `UNIQUE (instance, step)` a
`UNIQUE (instance, step, iteration)`. El `LinearRunner` necesita saber cuándo
volver al inicio del grupo y cuándo salir; es el mismo tipo de decisión que una
rama, y probablemente conviene esperar al `GraphRunner` de §4 en vez de
construir un bucle especial.

**Qué no debe romperse.** P-6 y P-7: nada se asienta hasta `CONFIRM`, y al
confirmar entra todo o nada. La tentación será asentar línea a línea "para no
perder trabajo"; eso es `CONFIRM_LINE` ([13 §14](13-process.md)), una decisión
de producto distinta y con otra garantía.

---

## Documentos relacionados

- [00 — Visión y alcance](00-vision-y-alcance.md) — la tabla de no-alcance
- [02 §11](02-modelo-de-dominio.md) — lo que el modelo deja preparado
- [12 §11](12-inventory.md) · [13 §14](13-process.md) · [14 §12](14-alerts.md)
- [07 — Composición y contexto de ejecución](07-composicion-y-contexto-de-ejecucion.md) — los jobs y roles que las extensiones heredan
