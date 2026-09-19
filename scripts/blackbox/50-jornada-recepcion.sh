#!/usr/bin/env bash
# ═════════════════════════════════════════════════════════════════════════════
# «El camión de las seis»
#
# Marta abre la casa, Diego dibuja la bodega, Juan descarga el camión. Es la
# jornada más corriente que existe en un almacén, y cruza los cinco módulos:
# tenencia, catálogo, ubicaciones, procesos y ledger.
#
# Lo que se comprueba no es que la API contestara 200, sino que después de cada
# gesto la bodega está como debería: el saldo en el bin, la foto reclamada, el
# asiento trazable hasta la instancia que lo produjo, y el arqueo cuadrando.
# ═════════════════════════════════════════════════════════════════════════════
set -uo pipefail
AQUI="$(dirname "${BASH_SOURCE[0]}")"
source "$AQUI/lib.sh"
source "$AQUI/mundo.sh"

exigir_servidor
montar_mundo recepcion

# ─────────────────────────────────────────────────────────────────────────────
step "1 · la casa quedó en pie"

req GET /me --token "$T_JUAN"
ok "Juan se reconoce" 200
body "con su rol" '.user.roles[0]' 'OPERATOR'
body "y en su organización" '.organization.slug' "$SLUG"

req GET /me --token "$T_SOFIA"
body "Sofía solo mira" '.user.roles[0]' 'VIEWER'

req GET "/nodes/$BODA/tree" --token "$T_JUAN"
ok "el árbol se despliega entero" 200
body "BOD-A tiene una zona" '.children | length' '1'
body "que tiene un estante" '.children[0].children | length' '1'
body "con dos bandejas" '.children[0].children[0].children | length' '2'
body "y el path es la cadena de códigos" '.children[0].children[0].children[0].node.path' 'BOD-A/Z1/E3/B2'

req GET "/nodes?kind=SOURCE&limit=50" --token "$T_JUAN"
ok "las fronteras de entrada estaban sembradas" 200
body "tres" '[.data[] | select(.kind=="SOURCE")] | length' '3'
req GET "/nodes?kind=TERMINAL&limit=50" --token "$T_JUAN" --no-cov
body "y cinco de salida" '[.data[] | select(.kind=="TERMINAL")] | length' '5'

req GET "/codes/$EAN_TOR/resolve" --token "$T_JUAN"
ok "el código de barras lleva al tornillo" 200
body "al tornillo y no a otro" '.product.sku' 'TOR-M8'
req GET "/codes/000000000000/resolve" --token "$T_JUAN"
problem "un código inventado no resuelve" 404 code-not-found

# ─────────────────────────────────────────────────────────────────────────────
step "2 · la foto del albarán entra en la zona de espera"

subir_foto FOTO1 "$T_JUAN"
ok "Juan sube la primera" 201
body "y le dan caducidad" '.expiresAt | type' 'string'
subir_foto FOTO2 "$T_JUAN"
ok "y la segunda" 201

# ─────────────────────────────────────────────────────────────────────────────
step "3 · la recepción guiada, paso a paso"

# El guion no sabe qué pasos hay: `ejecutar_proceso` exige que cada uno sea el
# que el servidor acaba de anunciar. Si la plantilla cambiara, esto se rompe —
# que es justo lo que tiene que pasar.
ejecutar_proceso INST "$T_JUAN" RECEPCION \
  "origen:$(jq -nc --arg n "$SUPPLIER" '{nodeId:$n}')" \
  "item:$(jq -nc --arg c "$EAN_LECHE" '{code:$c}')" \
  "lote:$(jq -nc --arg f "$(ahora '+40 days')" '{lotCode:"L-2609", expiresAt:$f}')" \
  'cantidad:{"quantity":"300.000"}' \
  "foto:$(jq -nc --arg a "$FOTO1" --arg b "$FOTO2" '{storageKeys:[$a,$b]}')" \
  "destino:$(jq -nc --arg n "$B2" '{nodeId:$n}')" \
  'confirmar:{}'

body "al confirmar sale un asiento y solo uno" '.movements | length' '1'
body "y la instancia queda cerrada" '.instance.state' 'COMPLETED'
MOV_RECEP="$(jqv '.movements[0].id')"
LOTE="$(jqv '.movements[0].batchId')"

req GET "/movements/$MOV_RECEP" --token "$T_JUAN"
ok "el asiento se puede volver a leer" 200
body "y sabe de qué instancia salió" '.processInstanceId' "$INST"
body "vino del proveedor" '.fromNodeId' "$SUPPLIER"
cantidad "con los 300 litros" '.quantity' '300.000'

saldo_es "y la bandeja B2 tiene los 300" "$T_JUAN" "$B2" "$P_LECHE" '300.000'
saldo_es "el proveedor queda a -300, que es lo que entregó" "$T_JUAN" "$SUPPLIER" "$P_LECHE" '-300.000'

req GET "/products/$P_LECHE/batches" --token "$T_JUAN"
ok "el lote nuevo existe en el catálogo" 200
body "con el código que dictó el operario" '[.[] | select(.lotCode=="L-2609")] | length' '1'

# ─────────────────────────────────────────────────────────────────────────────
step "4 · la foto quedó reclamada, no solo mencionada"

req GET "/products/$P_LECHE" --token "$T_JUAN"
ok "el producto se lee" 200
body "y arrastra sus dos fotos" '.media | length' '2'

# P-6 con dientes: ATTACH_MEDIA corrió al cerrar, así que la clave ya no está en
# la zona de espera. Si esto diera 201, la reclamación no habría pasado.
req POST "/products/$P_TOR/media" --token "$T_JUAN" --body "$(jq -nc --arg k "$FOTO1" '{storageKeys:[$k]}')"
problem "y su clave ya no se puede reclamar dos veces" 422 upload-not-found

# ─────────────────────────────────────────────────────────────────────────────
step "5 · lo que quedó escrito de la instancia"

req GET "/process-instances/$INST" --token "$T_JUAN"
ok "la instancia se relee" 200
body "con sus siete pasos completados" '.completions | length' '7'
body "y sin paso actual, que ya terminó" '.currentStep' 'null'
body "el escaneo guardó el payload enriquecido" '[.completions[] | select(.stepId=="item")] | length' '1'

req GET "/process-instances?state=COMPLETED&limit=50" --token "$T_JUAN"
ok "y aparece entre las cerradas" 200
body "la nuestra está" "[.data[] | select(.id==\"$INST\")] | length" '1'

# ─────────────────────────────────────────────────────────────────────────────
step "6 · la segunda línea del camión, por asiento directo"

# No todo se descarga con un proceso guiado: el tornillo entra a mano.
CUERPO_TOR="$(jq -nc --arg p "$P_TOR" --arg f "$SUPPLIER" --arg t "$B3" --arg o "$(ahora)" \
  '{productId:$p, fromNodeId:$f, toNodeId:$t, quantity:"500.000", occurredAt:$o}')"
req POST /movements --token "$T_JUAN" --body "$CUERPO_TOR"
ok "quinientos tornillos a la bandeja B3" 201
header "con su Location" location '~^/v1/movements/'
body "y la respuesta trae los dos extremos como quedaron" '.balances | length' '2'
cantidad "B3 con 500" "[.balances[] | select(.nodeId==\"$B3\")][0].quantity" '500.000'
saldo_es "y el saldo dice lo mismo que la respuesta" "$T_JUAN" "$B3" "$P_TOR" '500.000'

# ─────────────────────────────────────────────────────────────────────────────
step "7 · el operario con mala cobertura: idempotencia de verdad"

# Dos peticiones a la vez con la misma clave. Esto no se puede fabricar en
# proceso: hace falta la ventana real entre reservar y completar.
K="$(uuid)"
CUERPO_DOBLE="$(jq -nc --arg p "$P_TOR" --arg f "$SUPPLIER" --arg t "$B3" --arg o "$(ahora)" \
  '{productId:$p, fromNodeId:$f, toNodeId:$t, quantity:"7.000", occurredAt:$o}')"
paralelo 2 -- POST /movements --token "$T_JUAN" --idem "$K" --body "$CUERPO_DOBLE"
reparto_legitimo "dos veces a la vez: o la segunda choca en vuelo, o llega tarde y es un eco" '201 409' '201 201'

# Lo anterior admite dos formas porque quién gana la carrera depende del reloj.
# Esto no admite ninguna: pase lo que pase, el camión trajo siete tornillos.
saldo_es "y solo entraron siete tornillos, no catorce" "$T_JUAN" "$B3" "$P_TOR" '507.000'
req GET "/movements?productId=$P_TOR&limit=200" --token "$T_JUAN" --no-cov
body "un solo asiento de siete en el ledger" '[.data[] | select(.quantity=="7.000")] | length' '1'

# Ahora el reintento tranquilo, con la misma clave y el mismo cuerpo.
req POST /movements --token "$T_JUAN" --idem "$K" --body "$CUERPO_DOBLE"
ok "el reintento devuelve el mismo 201" 201
header "diciendo que es un eco" idempotency-replayed 'true'
saldo_es "y sigue sin duplicar" "$T_JUAN" "$B3" "$P_TOR" '507.000'

# La misma clave con otro cuerpo es otra cosa, y tiene que decirlo.
req POST /movements --token "$T_JUAN" --idem "$K" --body "$(jq -nc --arg p "$P_TOR" --arg f "$SUPPLIER" --arg t "$B3" --arg o "$(ahora)" \
  '{productId:$p, fromNodeId:$f, toNodeId:$t, quantity:"9.000", occurredAt:$o}')"
problem "y con otro cuerpo, la misma clave es un error" 409 idempotency-key-reuse

# ─────────────────────────────────────────────────────────────────────────────
step "8 · lo que el camión no traía"

req POST /movements --token "$T_JUAN" --idem none --body "$CUERPO_TOR"
problem "un POST sin clave de idempotencia no se acepta" 400 missing-idempotency-key

req POST /movements --token "$T_SOFIA" --body "$CUERPO_TOR"
problem "y Sofía, que solo mira, no descarga camiones" 403 insufficient-role

# El límite de fotos es 1..5, y quien lo dice es el manejador del paso. Esta
# instancia se queda a medias a propósito, así que se abre y se avanza en dos
# gestos: `ejecutar_proceso` exige llegar al final, que aquí sería mentira.
abrir_proceso INST2 "$T_JUAN" RECEPCION
avanzar_proceso "$INST2" "$T_JUAN" 'recepción a medias' \
  "origen:$(jq -nc --arg n "$SUPPLIER" '{nodeId:$n}')" \
  "item:$(jq -nc --arg c "$EAN_TOR" '{code:$c}')" \
  'lote:null' \
  'cantidad:{"quantity":"10.000"}'
body "y el servidor pide la foto" '.nextStep.id' 'foto'
paso "$INST2" "$T_JUAN" foto '{"storageKeys":["a","b","c","d","e","f"]}'
problem "seis fotos son demasiadas" 422 invalid-step-payload
pointer "y lo dice sobre el campo" /storageKeys

req POST "/process-instances/$INST2/cancel" --token "$T_JUAN"
ok "la instancia a medias se abandona" 200
body "y queda cancelada" '.state' 'CANCELLED'
saldo_es "sin haber tocado el inventario (P-6)" "$T_JUAN" "$B2" "$P_TOR" '0'

# ─────────────────────────────────────────────────────────────────────────────
step "9 · el cierre"

arqueo "$T_JUAN" "$P_TOR:TOR-M8" "$P_LECHE:LECHE-1L"

printf '\n  organización de esta corrida: %s\n' "$SLUG"
resumen jornada-recepcion
