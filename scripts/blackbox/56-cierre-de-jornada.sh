#!/usr/bin/env bash
# ═════════════════════════════════════════════════════════════════════════════
# «El arqueo, con dos operarios a la vez»
#
# Todo lo que no se puede fabricar dentro del proceso: dos clientes de verdad
# compitiendo sobre el mismo socket por el último tornillo, por el mismo paso de
# la misma instancia, y por el mismo número de versión de una plantilla.
#
# Y la pregunta que ninguna suite por endpoint hace: ¿puede una plantilla
# publicada llevar una instancia a COMPLETED sin mover un solo gramo? Porque un
# operario que «termina» una recepción y no recibe nada es la peor clase de
# fallo: la que no se nota hasta el inventario siguiente.
# ═════════════════════════════════════════════════════════════════════════════
set -uo pipefail
AQUI="$(dirname "${BASH_SOURCE[0]}")"
source "$AQUI/lib.sh"
source "$AQUI/mundo.sh"

exigir_servidor
montar_mundo cierre

# ─────────────────────────────────────────────────────────────────────────────
step "1 · quedan diez tornillos y los quieren dos"

req POST /movements --token "$T_JUAN" --body "$(jq -nc \
  --arg p "$P_TOR" --arg f "$OPENING" --arg t "$B2" --arg o "$(ahora)" \
  '{productId:$p, fromNodeId:$f, toNodeId:$t, quantity:"10.000", occurredAt:$o}')"
ok "diez tornillos en la bandeja" 201

# Dos peticiones a la vez, claves distintas, siete cada una. No hay catorce.
CUERPO_7="$(jq -nc --arg p "$P_TOR" --arg f "$B2" --arg t "$SALE" --arg o "$(ahora)" \
  '{productId:$p, fromNodeId:$f, toNodeId:$t, quantity:"7.000", occurredAt:$o}')"
paralelo 2 -- POST /movements --token "$T_JUAN" --body "$CUERPO_7"
reparto "dos despachos de siete a la vez: uno pasa y el otro no alcanza" 201 422

saldo_es "y quedan tres, nunca menos tres" "$T_JUAN" "$B2" "$P_TOR" '3.000'
req GET "/movements?productId=$P_TOR&nodeId=$SALE&limit=50" --token "$T_JUAN" --no-cov
body "con un solo asiento de salida" '.data | length' '1'

# El saldo de un nodo custodiable no puede ser negativo, y el CHECK no tiene
# ventana: no hay SELECT previo que se pueda quedar rancio entre dos.
SALDO_B2="$(saldo "$T_JUAN" "$B2" "$P_TOR")"
if [[ "$SALDO_B2" -ge 0 ]]; then
  pass "el saldo nunca cruzó el cero (I-4)"
else
  fail "el saldo quedó negativo: $SALDO_B2 milésimas"
fi

# ─────────────────────────────────────────────────────────────────────────────
step "2 · el mismo paso, dos veces a la vez"

abrir_proceso INST "$T_JUAN" RECEPCION
avanzar_proceso "$INST" "$T_JUAN" 'recepción' \
  "origen:$(jq -nc --arg n "$SUPPLIER" '{nodeId:$n}')"
body "y pide el escaneo" '.nextStep.id' 'item'

paralelo 2 -- POST "/process-instances/$INST/steps/item/complete" --token "$T_JUAN" \
  --body "$(jq -nc --arg c "$EAN_TOR" '{payload:{code:$c}}')"
reparto_legitimo "el mismo paso a la vez: uno avanza y el otro llega tarde" '200 409' '200 200'

req GET "/process-instances/$INST" --token "$T_JUAN" --no-cov
body "y el paso quedó anotado una sola vez" '[.completions[] | select(.stepId=="item")] | length' '1'
body "con la instancia en el paso siguiente" '.currentStep.id' 'lote'

# ─────────────────────────────────────────────────────────────────────────────
step "3 · dos jefes publicando la misma versión"

PLANTILLA_V2='{"version":2,"steps":[
  {"id":"origen","type":"SELECT_NODE","required":true,"config":{"role":"from","allowedKinds":["SOURCE"]},"transitions":[{"to":"item"}]},
  {"id":"item","type":"SCAN_ITEM","required":true,"config":{},"transitions":[{"to":"cantidad"}]},
  {"id":"cantidad","type":"CAPTURE_QTY","required":true,"config":{},"transitions":[{"to":"destino"}]},
  {"id":"destino","type":"SELECT_NODE","required":true,"config":{"role":"to","allowedKinds":["INTERNAL"]},"transitions":[{"to":"confirmar"}]},
  {"id":"confirmar","type":"CONFIRM","required":true,"config":{},"transitions":[{"to":null}]}
]}'
paralelo 2 -- POST /process-templates/RECEPCION/versions --token "$T_DIEGO" --body "$PLANTILLA_V2"
reparto "la misma versión a la vez: una se publica y la otra choca" 201 409

req GET /process-templates/RECEPCION --token "$T_DIEGO"
ok "y la activa es la nueva" 200
body "versión dos" '.version' '2'
body "sin el paso de la foto" '[.steps[] | select(.type=="CAPTURE_PHOTO")] | length' '0'

req GET /process-templates --token "$T_DIEGO"
ok "las seis plantillas siguen ahí" 200
body "seis activas" '.data | length' '6'

# La instancia abierta antes sigue con SUS reglas: nació en la versión 1.
req GET "/process-instances/$INST" --token "$T_JUAN" --no-cov
body "la instancia vieja conserva su versión" '.instance.templateVersion' '1'
body "y sigue viendo el paso del lote, que la v2 ya no tiene" '.currentStep.id' 'lote'

req POST /process-templates/RECEPCION/versions --token "$T_JUAN" --body "$PLANTILLA_V2"
problem "y un operario no publica plantillas" 403 insufficient-role

# ─────────────────────────────────────────────────────────────────────────────
step "4 · la jornada entera, mezclada"

req POST /movements/batch --token "$T_JUAN" --body "$(jq -nc \
  --arg tor "$P_TOR" --arg o "$OPENING" --arg b2 "$B2" --arg b3 "$B3" --arg t "$(ahora)" '
  { movements: [
      {productId:$tor, fromNodeId:$o, toNodeId:$b2, quantity:"400.000", occurredAt:$t},
      {productId:$tor, fromNodeId:$o, toNodeId:$b3, quantity:"200.000", occurredAt:$t}
  ]}')"
ok "se repone la bandeja" 201

nodo_de CUST "$T_DIEGO" pedro '' CUSTODY
ok "y se abre la custodia de Pedro" 201

# Traslado guiado con la plantilla v1 de TRASLADO (la v2 se rechazó entera).
ejecutar_proceso TRAS "$T_JUAN" TRASLADO \
  "origen:$(jq -nc --arg n "$B2" '{nodeId:$n}')" \
  "item:$(jq -nc --arg c "$EAN_TOR" '{code:$c}')" \
  'lote:null' \
  'cantidad:{"quantity":"50.000"}' \
  "destino:$(jq -nc --arg n "$B3" '{nodeId:$n}')" \
  'confirmar:{}'
saldo_es "cincuenta pasan de B2 a B3" "$T_JUAN" "$B3" "$P_TOR" '250.000'

# Préstamo, devolución parcial, venta, merma y compensación.
req POST /movements --token "$T_JUAN" --body "$(jq -nc \
  --arg p "$P_TOR" --arg f "$B3" --arg t "$CUST" --arg o "$(ahora)" --arg d "$(ahora '+5 days')" \
  '{productId:$p, fromNodeId:$f, toNodeId:$t, quantity:"20.000", occurredAt:$o, dueAt:$d}')"
ok "Pedro se lleva veinte" 201
PRESTAMO="$(jqv '.movement.id')"

req POST /movements --token "$T_JUAN" --body "$(jq -nc \
  --arg p "$P_TOR" --arg f "$CUST" --arg t "$B3" --arg o "$(ahora)" --arg s "$PRESTAMO" \
  '{productId:$p, fromNodeId:$f, toNodeId:$t, quantity:"8.000", occurredAt:$o, settlesId:$s}')"
ok "y devuelve ocho" 201

req POST /movements --token "$T_JUAN" --body "$(jq -nc \
  --arg p "$P_TOR" --arg f "$B2" --arg t "$SALE" --arg o "$(ahora)" \
  '{productId:$p, fromNodeId:$f, toNodeId:$t, quantity:"30.000", occurredAt:$o}')"
ok "se venden treinta" 201
VENTA="$(jqv '.movement.id')"

req POST /movements --token "$T_JUAN" --body "$(jq -nc \
  --arg p "$P_TOR" --arg f "$B2" --arg t "$SHRINK" --arg o "$(ahora)" \
  '{productId:$p, fromNodeId:$f, toNodeId:$t, quantity:"4.000", occurredAt:$o, reason:"caja aplastada"}')"
ok "se dan cuatro por perdidos" 201

req POST "/movements/$VENTA/reverse" --token "$T_DIEGO" --body '{"reason":"el cliente se arrepintió"}'
ok "y la venta se deshace" 201

# ─────────────────────────────────────────────────────────────────────────────
step "5 · una plantilla que no mueve nada no es una plantilla"

# P-6 dice que los efectos salen al cerrar, y CONFIRM es quien los emite. Una
# versión cuyo CONFIRM se pueda omitir, o que ni siquiera termine en CONFIRM,
# lleva la instancia a COMPLETED sin un solo asiento: el operario cree que
# recibió y el inventario no se enteró.
req GET "/movements?limit=200" --token "$T_JUAN" --no-cov
ANTES="$(jqv '.data | length')"

req POST /process-templates/TRASLADO/versions --token "$T_DIEGO" --body '{"version":2,"steps":[
  {"id":"item","type":"SCAN_ITEM","required":true,"config":{},"transitions":[{"to":"confirmar"}]},
  {"id":"confirmar","type":"CONFIRM","required":false,"config":{},"transitions":[{"to":null}]}
]}'
problem "un CONFIRM que se puede omitir no se publica" 422 invalid-template

req POST /process-templates/TRASLADO/versions --token "$T_DIEGO" --body '{"version":3,"steps":[
  {"id":"item","type":"SCAN_ITEM","required":true,"config":{},"transitions":[{"to":"cantidad"}]},
  {"id":"cantidad","type":"CAPTURE_QTY","required":true,"config":{},"transitions":[{"to":null}]}
]}'
problem "ni una que termina sin confirmar nada" 422 invalid-template

req GET "/movements?limit=200" --token "$T_JUAN" --no-cov
body "y el ledger no creció por el camino" '.data | length' "$ANTES"

# Las que sí están mal por otras razones, y ya se rechazaban.
req POST /process-templates/TRASLADO/versions --token "$T_DIEGO" --body '{"version":4,"steps":[
  {"id":"a","type":"SCAN_ITEM","required":true,"config":{},"transitions":[{"to":"b"},{"to":"c"}]},
  {"id":"b","type":"CONFIRM","required":true,"config":{},"transitions":[{"to":null}]}
]}'
problem "una plantilla que se bifurca, tampoco (P-8)" 422 branching-not-supported

req POST /process-templates/TRASLADO/versions --token "$T_DIEGO" --body '{"version":5,"steps":[
  {"id":"a","type":"BAILAR","required":true,"config":{},"transitions":[{"to":null}]}
]}'
problem "ni un tipo de paso inventado" 422 unknown-step-type

# El orden de estas dos comprobaciones es contrato (D-61): cuando las dos son
# ciertas —reenviar el número en servicio— «ese número está cogido» es la
# respuesta concreta y «no avanza» la vaga. Para llegar a la segunda hace falta
# un número que no exista y que además no supere a la activa.
req POST /process-templates/TRASLADO/versions --token "$T_DIEGO" \
  --body "${PLANTILLA_V2/\"version\":2/\"version\":10}"
ok "se publica una versión diez" 201
req POST /process-templates/TRASLADO/versions --token "$T_DIEGO" \
  --body "${PLANTILLA_V2/\"version\":2/\"version\":10}"
problem "repetir el número en servicio tiene nombre propio" 409 template-version-taken
req POST /process-templates/TRASLADO/versions --token "$T_DIEGO" \
  --body "${PLANTILLA_V2/\"version\":2/\"version\":5}"
problem "y una versión nueva que no supera a la activa, tampoco" 422 invalid-template

req GET /process-templates/NO_EXISTE --token "$T_DIEGO"
problem "y una plantilla que no existe es un 404" 404 template-not-found

# ─────────────────────────────────────────────────────────────────────────────
step "6 · todo lo que quedó, recorrido entero"

recorrer_paginas GET "/movements?limit=3" "$T_JUAN"
ok "el histórico completo, de tres en tres" 200
paginas_sin_repetidos "sin repetir ni saltarse un asiento"

recorrer_paginas GET "/stock?nonZeroOnly=false&custodialOnly=false&limit=3" "$T_JUAN"
paginas_sin_repetidos "y los saldos tampoco" 'nodeId'

recorrer_paginas GET "/process-instances?limit=2" "$T_JUAN"
paginas_sin_repetidos "ni las instancias"

recorrer_paginas GET "/nodes?limit=4" "$T_JUAN"
paginas_sin_repetidos "ni las ubicaciones"

req GET /stock/custodies --token "$T_JUAN" --no-cov
body "queda un préstamo abierto" '.data | length' '1'
cantidad "con doce pendientes" '.data[0].pending' '12.000'

# ─────────────────────────────────────────────────────────────────────────────
step "7 · el arqueo de cierre"

arqueo "$T_JUAN" "$P_TOR:TOR-M8" "$P_LECHE:LECHE-1L" "$P_TALADRO:TAL-18V"

printf '\n  organización de esta corrida: %s\n' "$SLUG"
resumen cierre-de-jornada
