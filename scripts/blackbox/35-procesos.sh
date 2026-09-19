#!/usr/bin/env bash
# Caja negra · WAVE 4 — «los procesos». Las seis plantillas de fábrica que toda
# organización trae puestas, y las instancias que se ejecutan con ellas.
#
# Nadie las crea aquí. Las siembra el provisioner dentro de la transacción que
# da de alta la organización, igual que los ocho nodos de frontera, así que lo
# que se comprueba es que estaban.
#
# Y lo que el plan 8 añade: abrir una instancia y recorrerla paso a paso hasta
# que salga un asiento del ledger, abandonarla, filtrarla y versionar la
# plantilla. Las ocho operaciones de [13 §10], cada una con su camino feliz y el
# de error, que es lo que exige el cruce de cobertura de spec 06 §6.
#
# Se invoca solo o a través de ./scripts/blackbox.sh.
set -uo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

SLUG="procesos-$(date +%s)-$RANDOM"
VENCE="$(date -u -d '+30 days' +%Y-%m-%dT%H:%M:%S.000Z 2>/dev/null || date -u -v+30d +%Y-%m-%dT%H:%M:%S.000Z)"

# ═════════════════════════════════════════════════════════════════════════════
exigir_servidor

# ─────────────────────────────────────────────────────────────────────────────
step "1 · la organización y el equipo"
MARTA="marta-$SLUG@esquina.co"
req POST /organizations --idem none --body "$(jq -nc --arg s "$SLUG" --arg e "$MARTA" --arg p "$PASSWORD" \
  '{name:"Distribuidora La Esquina", slug:$s, owner:{email:$e, name:"Marta", password:$p}}')"
ok "registra la organización" 201

req POST /auth/login --idem none --body "$(jq -nc --arg e "$MARTA" --arg p "$PASSWORD" --arg s "$SLUG" \
  '{email:$e, password:$p, slug:$s}')"
ok "Marta inicia sesión" 200
T_OWNER="$(jqv '.accessToken')"

alta T_DIEGO ADMIN diego
alta T_JUAN OPERATOR juan
alta T_SOFIA VIEWER sofia

# La bodega y el catálogo mínimos para poder ejecutar un proceso de verdad. Sin
# esto lo único comprobable serían las plantillas, que es donde se quedó el
# plan 7.
nodo() { # nodo <var> <code> [parentId]
  local -n dest="$1"
  local extra='{}'
  [[ $# -ge 3 ]] && extra="$(jq -nc --arg p "$3" '{parentId:$p}')"
  req POST /nodes --token "$T_DIEGO" \
    --body "$(jq -nc --arg c "$2" --argjson e "$extra" '{kind:"INTERNAL", code:$c, name:$c} + $e')"
  dest="$(jqv '.id')"
}
nodo BODA BOD-A
nodo B2 B2 "$BODA"
nodo B3 B3 "$BODA"
ok "la bodega queda dibujada" 201

frontera() { # frontera <var> <kind> <code>
  local -n dest="$1"
  req GET "/nodes?kind=$2" --token "$T_DIEGO" --no-cov
  dest="$(jq -r --arg c "$3" '[.data[] | select(.code==$c)][0].id' < "$BODY_F")"
}
frontera SUPPLIER SOURCE supplier-default
frontera SALE TERMINAL sale

req POST /products --token "$T_DIEGO" \
  --body '{"sku":"TOR-M8","name":"Tornillo M8 galvanizado","trackingMode":"QUANTITY","uom":"UNIT"}'
ok "crea el tornillo, que se lleva por cantidad" 201
TOR="$(jqv '.id')"

req POST /products --token "$T_DIEGO" \
  --body '{"sku":"LECHE-1L","name":"Leche entera 1L","trackingMode":"LOT","uom":"UNIT"}'
ok "y la leche, que se lleva por lote" 201
LECHE="$(jqv '.id')"

# ─────────────────────────────────────────────────────────────────────────────
step "2 · las seis plantillas ya estaban"
req GET /process-templates --token "$T_OWNER"
ok "lista las plantillas" 200
body "son seis" '.data | length' 6
body "y son las de [13 §6]" '[.data[].code] | sort | join(",")' \
  'AJUSTE_ENTRADA,AJUSTE_SALIDA,CUSTODIA,RECEPCION,SALIDA,TRASLADO'
body "todas en versión 1" '[.data[] | select(.version != 1)] | length' 0
body "y todas activas" '[.data[] | select(.active != true)] | length' 0

# Sin paginación: son seis, y el día que sean por organización seguirán siendo
# pocas. Por eso el listado tampoco lleva sobre `page`.
body "sin sobre de paginación" 'has("page")' 'false'

# ─────────────────────────────────────────────────────────────────────────────
step "3 · una plantilla, con sus pasos y sus transiciones"
req GET /process-templates/RECEPCION --token "$T_OWNER"
ok "la recepción se lee por su código, que no es un uuid" 200
body "sus siete pasos, en orden" '[.steps[].id] | join(",")' \
  'origen,item,lote,cantidad,foto,destino,confirmar'
body "el primero elige el proveedor" '.steps[0].config.allowedKinds | join(",")' 'SOURCE'
body "el del lote es opcional: la plantilla no sabe qué producto pasará" \
  '.steps[] | select(.id=="lote") | .required' 'false'
body "y el de la cantidad no lo es" '.steps[] | select(.id=="cantidad") | .required' 'true'

# P-8: hoy cada paso lleva exactamente una transición. Pasar al workflow es
# retirar esa comprobación, no rediseñar el modelo.
body "cada paso tiene exactamente una transición" \
  '[.steps[] | select((.transitions | length) != 1)] | length' '0'
body "y la última cierra el proceso" '.steps[-1].transitions[0].to' 'null'

req GET /process-templates/AJUSTE_ENTRADA --token "$T_OWNER"
ok "el ajuste positivo también" 200
# Un default por uuid sería una plantilla de fábrica que solo vale para una
# empresa: los ocho de frontera son distintos en cada organización.
body "fija su origen por código de nodo, no por id" \
  '.steps[] | select(.id=="confirmar") | .config.defaults.fromNodeCode' 'adjustment-in'
body "y no tiene paso de origen que pedirle a nadie" \
  '[.steps[] | select(.id=="origen")] | length' '0'

# ─────────────────────────────────────────────────────────────────────────────
step "4 · quien puede leerlas"
req GET /process-templates --token "$T_SOFIA"
ok "una VIEWER las lee" 200
req GET /process-templates/CUSTODIA --token "$T_JUAN"
ok "y un OPERATOR también, que es quien va a operarlas" 200

req GET /process-templates
problem "sin token, 401" 401 invalid-credentials
req GET /process-templates/RECEPCION
problem "y la de detalle igual" 401 invalid-credentials

# ─────────────────────────────────────────────────────────────────────────────
step "5 · lo que no existe"
req GET /process-templates/NOEXISTE --token "$T_OWNER"
problem "un código inventado es 404" 404 template-not-found

# Un código que no cabe en la columna no puede existir: contestar 422 sería
# contarle al cliente el ancho de una columna.
LARGO="$(printf 'A%.0s' {1..70})"
req GET "/process-templates/$LARGO" --token "$T_OWNER"
problem "y uno imposible, también 404" 404 template-not-found

# D-60, que cierra D-59. El listado no pagina —son seis— así que no lleva
# `parsePage`, y hasta este plan se tragaba `?limit=2` en silencio: era la única
# colección del contrato que no contestaba a una clave que no conoce.
req GET "/process-templates?limit=2" --token "$T_OWNER"
problem "una clave de query que no existe es 400, como en todo el contrato" 400 invalid-filter
req GET /process-templates --token "$T_OWNER"
body "y sin query siguen saliendo las seis" '.data | length' 6

# ─────────────────────────────────────────────────────────────────────────────
step "6 · la empresa de al lado tiene las suyas (I-6)"
SLUG2="procesos-vecina-$(date +%s)-$RANDOM"
ANA="ana-$SLUG2@esquina.co"
req POST /organizations --idem none --body "$(jq -nc --arg s "$SLUG2" --arg e "$ANA" --arg p "$PASSWORD" \
  '{name:"La Vecina", slug:$s, owner:{email:$e, name:"Ana", password:$p}}')"
ok "se registra otra organización" 201
req POST /auth/login --idem none --body "$(jq -nc --arg e "$ANA" --arg p "$PASSWORD" --arg s "$SLUG2" \
  '{email:$e, password:$p, slug:$s}')"
ok "Ana inicia sesión" 200
T_ANA="$(jqv '.accessToken')"

req GET /process-templates --token "$T_ANA"
body "ella nace con sus seis" '.data | length' 6

req GET /process-templates --token "$T_OWNER"
MIA="$(jqv '[.data[] | select(.code=="RECEPCION")][0].id')"
req GET /process-templates --token "$T_ANA"
SUYA="$(jqv '[.data[] | select(.code=="RECEPCION")][0].id')"
if [[ -n "$MIA" && "$MIA" != "$SUYA" ]]; then
  pass "y no son las mismas filas: cada organización tiene las suyas"
else
  fail "las dos organizaciones comparten la plantilla RECEPCION ($MIA)"
fi

# ─────────────────────────────────────────────────────────────────────────────
step "7 · una recepción guiada, de principio a asiento"
# Juan nunca consulta la plantilla: abre el proceso y va enviando lo que el
# servidor le indica en `nextStep`. Es lo que permite que un cliente sea
# genérico.
req POST /process-instances --token "$T_JUAN" --body '{"templateCode":"RECEPCION"}'
ok "Juan abre una recepción" 201
INST="$(jqv '.instance.id')"
body "y el servidor le dice por dónde empezar" '.nextStep.id' 'origen'
body "con la definición entera, no solo el id" '.nextStep.type' 'SELECT_NODE'
body "la instancia nace abierta" '.instance.state' 'OPEN'
body "y anota con qué versión de la plantilla (P-1)" '.instance.templateVersion' '1'
header "y deja su Location" location "/v1/process-instances/$INST"

paso() { # paso <stepId> <payload json> — y comprueba qué pide el servidor después
  req POST "/process-instances/$INST/steps/$1/complete" --token "$T_JUAN" \
    --body "$(jq -nc --argjson p "$2" '{payload:$p}')"
}

paso origen "$(jq -nc --arg n "$SUPPLIER" '{nodeId:$n}')"
ok "elige el proveedor" 200
body "y lo siguiente es escanear" '.nextStep.id' 'item'

paso item '{"code":"TOR-M8"}'
ok "escanea el tornillo por su SKU" 200
body "toca el lote" '.nextStep.id' 'lote'

# El tornillo se lleva por cantidad: el paso del lote se omite, y quien lo sabe
# es el manejador, no la plantilla.
paso lote 'null'
ok "omite el lote, que este producto no lleva" 200
body "y pide la cantidad" '.nextStep.id' 'cantidad'

paso cantidad '{"quantity":"500"}'
ok "cuenta 500" 200
paso foto 'null'
ok "no hay nada que fotografiar" 200
paso destino "$(jq -nc --arg n "$B2" '{nodeId:$n}')"
ok "y las ubica en B2" 200
body "solo queda confirmar" '.nextStep.id' 'confirmar'

paso confirmar '{}'
ok "confirma, y ahí sí se mueve el inventario (P-6)" 200
body "el proceso queda terminado" '.instance.state' 'COMPLETED'
body "sin paso siguiente que pedir" 'has("nextStep")' 'false'
body "y devuelve el asiento que produjo" '.movements | length' '1'
body "que apunta a la instancia que lo produjo" '.movements[0].processInstanceId' "$INST"
MOV="$(jqv '.movements[0].id')"

req GET "/stock?nodeId=$B2&productId=$TOR" --token "$T_DIEGO"
body "y las 500 están en B2" '.data[0].quantity' '500.000'

req GET "/process-instances/$INST" --token "$T_JUAN"
ok "la instancia se puede releer entera" 200
body "con sus siete pasos completados" '.completions | length' '7'
# La diferencia entre «este paso se omitió» y «este paso no existe» es la fila.
body "el de la foto está, y su payload es null" \
  '[.completions[] | select(.stepId=="foto")][0].payload' 'null'
body "y el del escaneo guarda lo que el motor entendió, no solo lo que llegó" \
  '[.completions[] | select(.stepId=="item")][0].payload.productId' "$TOR"
body "cerrada, no enseña paso actual" 'has("currentStep")' 'false'

# ─────────────────────────────────────────────────────────────────────────────
step "8 · el servidor manda"
req POST /process-instances --token "$T_JUAN" --body '{"templateCode":"RECEPCION"}'
INST="$(jqv '.instance.id')"

paso cantidad '{"quantity":"1"}'
problem "un paso que no toca es 409, y dice cuál toca" 409 wrong-step
body "nombrándolo en extensions" '.currentStepId' 'origen'

paso origen "$(jq -nc --arg n "$SUPPLIER" '{nodeId:$n}')"
ok "el que toca sí pasa" 200
paso origen "$(jq -nc --arg n "$SUPPLIER" '{nodeId:$n}')"
# Ya quedó atrás: sin la comprobación de P-3 esto sería `wrong-step`, que le
# diría al cliente que llegó tarde en vez de que eso ya lo hizo.
problem "repetirlo es step-already-completed, no wrong-step (P-3)" 409 step-already-completed

paso item '{"code":"NO-EXISTE-ESTE"}'
problem "un código que no resuelve es invalid-step-payload" 422 invalid-step-payload

paso item '{"code":"LECHE-1L"}'
ok "la leche sí" 200
# La leche se lleva por lote: aquí omitir no vale, y quien lo sabe es el
# manejador (D-54).
paso lote 'null'
problem "omitir el lote de un producto que lo lleva es batch-step-required" 422 batch-step-required

paso lote "$(jq -nc --arg v "$VENCE" '{lotCode:"L-NUEVO", expiresAt:$v}')"
ok "con su lote nuevo, sí" 200
paso cantidad '{"quantity":"2.5"}'
problem "una cantidad con decimales sobre UNIT es invalid-step-payload" 422 invalid-step-payload
body "y señala el campo" '.errors[0].pointer' '/quantity'
paso cantidad '{"quantity":"0"}'
problem "y cero tampoco" 422 invalid-step-payload

paso cantidad '{"quantity":"24"}'
ok "24 sí" 200
paso foto 'null'
paso destino "$(jq -nc --arg n "$SUPPLIER" '{nodeId:$n}')"
# El destino de una recepción es INTERNAL: un proveedor no es una ubicación.
problem "un destino del kind que no es, invalid-step-payload" 422 invalid-step-payload
paso destino "$(jq -nc --arg n "$B3" '{nodeId:$n}')"
ok "B3 sí" 200

paso confirmar '{}'
ok "y al confirmar se crea el lote y el asiento en la misma transacción" 200
body "un asiento" '.movements | length' '1'
LOTE_MOV="$(jqv '.movements[0].batchId')"

req GET "/products/$LECHE/batches" --token "$T_DIEGO"
body "el lote nuevo existe en el catálogo" '[.[] | select(.lotCode=="L-NUEVO")] | length' '1'
body "y es el que lleva el asiento" '[.[] | select(.lotCode=="L-NUEVO")][0].id' "$LOTE_MOV"

# ─────────────────────────────────────────────────────────────────────────────
step "9 · abandonar a la mitad no ensucia nada (P-6)"
req POST /process-instances --token "$T_JUAN" --body '{"templateCode":"RECEPCION"}'
ABANDONADA="$(jqv '.instance.id')"
INST="$ABANDONADA"
paso origen "$(jq -nc --arg n "$SUPPLIER" '{nodeId:$n}')"
paso item '{"code":"LECHE-1L"}'
paso lote "$(jq -nc --arg v "$VENCE" '{lotCode:"L-FANTASMA", expiresAt:$v}')"
ok "llega hasta el lote" 200

req POST "/process-instances/$ABANDONADA/cancel" --token "$T_JUAN"
ok "y lo abandona" 200
body "queda cancelada" '.state' 'CANCELLED'
# Dónde se abandonó es parte de lo que pasó.
body "recordando dónde se quedó" '.currentStepId' 'cantidad'

req GET "/products/$LECHE/batches" --token "$T_DIEGO"
body "el lote que iba a crear no existe" '[.[] | select(.lotCode=="L-FANTASMA")] | length' '0'

paso cantidad '{"quantity":"1"}'
problem "y no admite más pasos (P-4)" 409 instance-closed
req POST "/process-instances/$ABANDONADA/cancel" --token "$T_JUAN"
problem "ni cancelarla dos veces" 409 instance-closed

# ─────────────────────────────────────────────────────────────────────────────
step "10 · la bandeja de lo que quedó abierto"
req GET /process-instances --token "$T_DIEGO"
ok "Diego ve los procesos de la casa" 200
body "los tres que se abrieron" '.data | length' '3'
# D-62: lo último primero, que es lo que quiere quien abre la bandeja.
body "lo último primero" '.data[0].id' "$ABANDONADA"

req GET "/process-instances?state=CANCELLED" --token "$T_DIEGO"
body "filtra por estado" '.data | length' '1'
req GET "/process-instances?templateCode=RECEPCION" --token "$T_DIEGO"
body "y por plantilla" '.data | length' '3'
req GET "/process-instances?state=FOO" --token "$T_DIEGO"
problem "un estado que no existe es 400, no una página vacía" 400 invalid-filter
req GET "/process-instances?sort=createdAt" --token "$T_DIEGO"
ok "ordena por lo único indexado" 200
req GET "/process-instances?sort=actorId" --token "$T_DIEGO"
problem "y no por lo que invitaría a un seq scan" 400 invalid-filter


# ─────────────────────────────────────────────────────────────────────────────
step "11 · versionar una plantilla (P-9)"
SIN_FOTO="$(jq -nc '[
  {id:"origen",   type:"SELECT_NODE", required:true,  config:{role:"FROM", allowedKinds:["SOURCE"]},   transitions:[{to:"item"}]},
  {id:"item",     type:"SCAN_ITEM",   required:true,  transitions:[{to:"cantidad"}]},
  {id:"cantidad", type:"CAPTURE_QTY", required:true,  transitions:[{to:"destino"}]},
  {id:"destino",  type:"SELECT_NODE", required:true,  config:{role:"TO", allowedKinds:["INTERNAL"]},   transitions:[{to:"confirmar"}]},
  {id:"confirmar",type:"CONFIRM",     required:true,  transitions:[{to:null}]}
]')"

req POST /process-templates/RECEPCION/versions --token "$T_JUAN" \
  --body "$(jq -nc --argjson s "$SIN_FOTO" '{version:2, steps:$s}')"
problem "Juan opera procesos, no los redefine" 403 insufficient-role

req POST /process-templates/RECEPCION/versions --token "$T_DIEGO" \
  --body "$(jq -nc --argjson s "$SIN_FOTO" '{version:2, steps:$s}')"
ok "Diego publica la v2, sin el paso de la foto" 201
body "es la versión 2" '.version' '2'
body "y está activa" '.active' 'true'
body "con cinco pasos" '.steps | length' '5'

req GET /process-templates/RECEPCION --token "$T_DIEGO"
body "la activa pasa a ser la v2" '.version' '2'

req POST /process-templates/RECEPCION/versions --token "$T_DIEGO" \
  --body "$(jq -nc --argjson s "$SIN_FOTO" '{version:2, steps:$s}')"
problem "la misma versión otra vez es 409 (D-61)" 409 template-version-taken

req POST /process-templates/RECEPCION/versions --token "$T_DIEGO" \
  --body "$(jq -nc --argjson s "$SIN_FOTO" '{version:1, steps:$s}')"
problem "y una que ya existía, también" 409 template-version-taken

# P-8: una rama es el límite del MVP, y el mensaje tiene que decir que la
# capacidad está prevista.
RAMA="$(jq -nc '[
  {id:"item",     type:"SCAN_ITEM", required:true, transitions:[{to:"confirmar"},{to:null}]},
  {id:"confirmar",type:"CONFIRM",   required:true, transitions:[{to:null}]}
]')"
req POST /process-templates/RECEPCION/versions --token "$T_DIEGO" \
  --body "$(jq -nc --argjson s "$RAMA" '{version:3, steps:$s}')"
problem "dos transiciones en un paso es branching-not-supported" 422 branching-not-supported

RARO="$(jq -nc '[{id:"raro", type:"INSPECCION_CALIDAD", required:true, transitions:[{to:null}]}]')"
req POST /process-templates/RECEPCION/versions --token "$T_DIEGO" \
  --body "$(jq -nc --argjson s "$RARO" '{version:3, steps:$s}')"
problem "un tipo de paso que nadie sabe ejecutar es unknown-step-type" 422 unknown-step-type

req POST /process-templates/NOEXISTE/versions --token "$T_DIEGO" \
  --body "$(jq -nc --argjson s "$SIN_FOTO" '{version:2, steps:$s}')"
problem "versionar lo que no se puede ver es 404" 404 template-not-found

# Una instancia nueva ya no ve el paso de la foto; las abiertas en v1 siguen
# con sus reglas, que es de lo que trata el versionado.
req POST /process-instances --token "$T_JUAN" --body '{"templateCode":"RECEPCION"}'
ok "una recepción nueva nace en la v2" 201
body "con la versión nueva anotada" '.instance.templateVersion' '2'
NUEVA="$(jqv '.instance.id')"
req GET "/process-instances/$NUEVA" --token "$T_JUAN"
body "y su paso actual viene con definición, para poder retomarla (D-63)" '.currentStep.id' 'origen'

# ─────────────────────────────────────────────────────────────────────────────
step "12 · lo que no está, y quién no puede"
req POST /process-instances --token "$T_SOFIA" --body '{"templateCode":"RECEPCION"}'
problem "Sofía solo mira" 403 insufficient-role

req POST /process-instances --token "$T_JUAN" --body '{"templateCode":"NOEXISTE"}'
problem "abrir un proceso que no existe es 404" 404 template-not-found

FANTASMA='018f0000-0000-7000-8000-0000000000ff'
req GET "/process-instances/$FANTASMA" --token "$T_JUAN"
problem "una instancia inventada es 404" 404 process-instance-not-found
req POST "/process-instances/$FANTASMA/cancel" --token "$T_JUAN"
problem "y cancelarla, también" 404 process-instance-not-found
req POST "/process-instances/$FANTASMA/steps/origen/complete" --token "$T_JUAN" --body '{"payload":null}'
problem "y completarle un paso, igual" 404 process-instance-not-found

# I-6: la de la organización de al lado no está, y nunca es 403.
req GET "/process-instances/$NUEVA" --token "$T_ANA"
problem "la instancia de otra organización no está (I-6)" 404 process-instance-not-found

req GET /process-instances --token "$T_ANA"
body "y su bandeja está vacía" '.data | length' '0'

# ═════════════════════════════════════════════════════════════════════════════
resumen procesos
