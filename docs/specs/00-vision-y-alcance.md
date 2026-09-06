# 00 — Visión y alcance

> Documento raíz. Fija qué construimos, para quién, y —sobre todo— qué no
> construimos. Todo spec posterior hereda estos límites.

## 1. El problema

Un negocio pequeño que maneja mercancía física pasa por tres etapas:

1. **Papel y memoria.** Funciona hasta que hay más de una persona o más de un sitio.
2. **Excel.** Funciona hasta que dos personas lo editan a la vez, o hasta que
   alguien pregunta *"¿quién movió esto?"* y no hay respuesta.
3. **Un sistema.** Aquí es donde se atasca, porque el mercado le ofrece dos cosas
   y ninguna le sirve.

La consecuencia está medida: la distorsión de inventario —el hueco entre lo que el
registro dice y lo que hay en el estante— representa entre el **5% y el 10% del
valor anual del inventario**, y mantener ese inventario cuesta otro **20-30% de su
valor cada año**. Para un negocio con márgenes de dos dígitos bajos, eso no es una
ineficiencia: es la diferencia entre ganar y perder.

## 2. El hueco de mercado

```
$0        Treinta, Loyverse            "¿cuánto vendí?"
$18/mes   Alegra Emprendedor            "¿cuánto tengo?"   1 usuario, 1 bodega
                    ▲
        ╔═══════════╧═══════════════╗
        ║   AQUÍ NO HAY PRODUCTO    ║
        ║   US$20 – 60 / mes         ║
        ╚═══════════╤═══════════════╝
$229/mes  Fishbowl                      "¿dónde está y quién lo movió?"
$350/mes  WareGo
$186-999  inFlow
$500-1500 WMS de un solo sitio
$80K/año  Blue Yonder
```

La capa barata es **venta-céntrica o contabilidad-céntrica**. Registra transacciones
comerciales y deduce el stock como efecto secundario. La capa cara es
**operación-céntrica**, que es lo correcto, pero llega empaquetada con slotting,
olas de picking, gestión de mano de obra e integración con automatización — y con
implementaciones de 4 a 12 semanas como mínimo.

Nadie ofrece operación de bodega real a precio de app.

## 3. Qué es tubodega

> **Un WMS de movimientos para el negocio que ya superó el Excel pero al que un
> ERP le queda grande.**

El núcleo no es la factura ni la venta: es el **movimiento**. Toda pregunta que el
producto responde —cuánto hay, dónde está, quién lo tocó, qué se venció, qué no ha
vuelto— se contesta leyendo el mismo registro de movimientos.

Tomamos de Sortly la ergonomía (escanear, fotografiar, campos propios, alertas por
fecha) y le ponemos debajo la maquinaria de un WMS: ubicaciones reales, partida
doble, trazabilidad completa e inmutabilidad del histórico.

## 4. Usuario objetivo

| | |
|---|---|
| **Tamaño** | 2 a 50 personas operando mercancía |
| **Ubicaciones** | 1 bodega con estructura interna, o 2-3 sitios |
| **Catálogo** | cientos a pocos miles de SKU |
| **Perfil de producto** | mezcla de consumible y de activo retornable |
| **Sensibilidad** | perecederos, lotes, o herramienta que se presta y debe volver |
| **Punto de partida** | una o varias hojas de cálculo |
| **Capacidad técnica** | ninguna; no hay departamento de sistemas |

El operario está de pie, con una caja en la mano, frente a un estante. Esa postura
—no la de alguien sentado ante un escritorio— es la que manda en cada decisión de
diseño de la operación.

## 5. Los cuatro diferenciadores

Frente a la capa barata:

1. **Ubicaciones internas reales.** Saber que hay 40 unidades no sirve si nadie
   sabe en qué estante. Es la línea que separa un WMS de un contador de existencias.
2. **Consumo y custodia en el mismo sistema.** El taladro que se presta y el saco
   de arroz que se vende conviven sin dos productos distintos.
3. **Histórico inmutable.** Nada se edita. Los errores se corrigen con asientos de
   compensación, así que el registro nunca miente sobre lo que pasó.
4. **Alertas por fecha unificadas.** Vencimiento de lote y retorno pendiente de
   custodia son la misma pregunta —*una fecha que vence sobre una posición de stock*—
   y las resuelve un solo motor.

Frente a la capa cara: **precio de app, cero implementación, y un contrato de API
abierto desde el primer día.**

## 6. Alcance del MVP

Entra:

- **Catálogo** — productos, múltiples códigos por producto (EAN, QR interno,
  referencia de proveedor), fotos, campos custom definidos por la organización
- **Ubicaciones** — grafo jerárquico de nodos: bodega › zona › estante › bin
- **Ledger** — recepción, salida, traslado, ajuste, check-out y check-in de custodia
- **Saldos** — consulta de existencias por producto, por nodo y por lote
- **Lotes y series** — tres modos de seguimiento: cantidad, lote, serie
- **Alertas por fecha** — vencimiento de lote y retorno de custodia vencido
- **Proceso** — motor de plantillas versionadas con seis plantillas de fábrica,
  una línea por instancia
- **Plataforma** — multi-tenant, autenticación, roles, API REST versionada con
  OpenAPI generado

No entra, y es deliberado:

| Fuera del MVP | Por qué | Dónde vive el diseño |
|---|---|---|
| Conteo cíclico | Alto valor, pero el ledger y el motor deben estar probados antes | [90](90-extensiones-previstas.md) |
| Órdenes de compra | La recepción del MVP es ciega: el operario declara lo que llegó | [90](90-extensiones-previstas.md) |
| Picking contra pedido | El flujo más largo; añade superficie antes de validar el núcleo | [90](90-extensiones-previstas.md) |
| Flujos con ramas | La plantilla lineal cubre los cinco procesos de fábrica | [13](13-process.md), [90](90-extensiones-previstas.md) |
| Offline-first | Solo resiliencia a cortes; las invariantes que lo habilitan sí entran | [03](03-contrato-api.md), [90](90-extensiones-previstas.md) |
| Cualquier interfaz gráfica | El entregable del MVP es el contrato de API | — |
| Contabilidad, facturación, POS | No es nuestro problema; se integra, no se replica | [05](05-eventos-e-integraciones.md) |
| Costeo de inventario | Requiere decisiones contables por país | [90](90-extensiones-previstas.md) |

**Sobre la ausencia de interfaz.** El MVP se valida con pruebas e2e contra el
contrato, no con pantallas. Esto adelanta el momento en que el modelo de dominio
queda ejercitado de verdad y evita gastar el presupuesto del proyecto en UI antes
de saber si el flujo operativo es el correcto.

## 7. Criterios de éxito

El MVP está listo cuando, sobre una organización recién creada y solo a través de
la API pública:

1. Se importa un catálogo de 500 productos con códigos, fotos y al menos un campo
   custom por producto.
2. Se define un árbol de ubicaciones de tres niveles.
3. Se ejecuta una recepción completa que deja stock localizado en un bin concreto.
4. Se traslada stock entre bins y el saldo de origen y destino cuadra.
5. Se presta una herramienta a una persona con fecha de retorno, y el sistema la
   marca como vencida al pasar la fecha.
6. Se despacha stock a un nodo terminal y el inventario propio disminuye.
7. Se corrige un error con un asiento de compensación, y el histórico muestra
   ambos asientos —el equivocado y su corrección— sin haber alterado ninguno.
8. Se reconstruye el saldo completo sumando el ledger y coincide, fila por fila,
   con `stock_balance`.
9. Toda escritura repetida con la misma `Idempotency-Key` no duplica nada.
10. Ninguna petición de una organización puede leer ni escribir datos de otra.

Los puntos 7, 8 y 10 son los innegociables: son las tres propiedades sobre las que
se apoya todo lo demás.

## 8. Principios de producto

- **El movimiento es la unidad atómica.** Si algo no se puede expresar como un
  movimiento entre dos nodos, probablemente no pertenece a este sistema.
- **Nada se edita.** La corrección es un asiento nuevo, nunca una enmienda.
- **La operación manda sobre el reporte.** Primero que el operario pueda registrar
  lo que pasó, rápido y sin errores; los informes se derivan después.
- **Configurar antes que programar.** Un proceso distinto debería ser una plantilla
  distinta, no una rama en el código.
- **Cerrar puertas cuesta más que dejarlas abiertas.** No construimos el workflow
  ni el offline, pero tampoco tomamos decisiones que los vuelvan un rediseño.

## 9. Referencias de mercado

| Producto | Qué le tomamos | Dónde se queda corto |
|---|---|---|
| **Sortly** | Ergonomía: QR, fotos, campos custom, alertas por fecha, offline | Es asset tracking: no tiene flujo operativo ni ubicaciones reales |
| **Boxstorm** | El ledger de transacciones con timestamp por cada cambio | Descontinuado |
| **inFlow** | Cobertura funcional de recepción y órdenes | Entrada desde US$186/mes: inalcanzable para el segmento |
| **Bind ERP** | Multi-ubicación sin cobrar por sucursal | ERP completo; superficie enorme para el usuario objetivo |
| **Odoo Inventory** | Referencia de modelo de datos multi-bodega | Requiere apetito técnico que el usuario objetivo no tiene |
| **Treinta** | Cómo se le habla a un negocio pequeño en LATAM | El inventario es secundario a la venta |

## 10. Documentos relacionados

- [01 — Arquitectura](01-arquitectura.md)
- [02 — Modelo de dominio](02-modelo-de-dominio.md)
- [07 — Composición y contexto de ejecución](07-composicion-y-contexto-de-ejecucion.md)
- [08 — Acceso a datos](08-acceso-a-datos.md)
- [90 — Extensiones previstas](90-extensiones-previstas.md)
