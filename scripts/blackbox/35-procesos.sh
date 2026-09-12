#!/usr/bin/env bash
# Caja negra · WAVE 4 — «los procesos». Lo que el plan 7 publica: las seis
# plantillas de fábrica que toda organización trae puestas, visibles con curl.
#
# Nadie las crea aquí. Las siembra el provisioner dentro de la transacción que
# da de alta la organización, igual que los ocho nodos de frontera, así que lo
# que se comprueba es que estaban.
#
# Las dos operaciones de [13 §10] que existen hoy, cada una con su camino feliz
# y el de error, que es lo que exige el cruce de cobertura de spec 06 §6.
#
# Se invoca solo o a través de ./scripts/blackbox.sh.
set -uo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

SLUG="procesos-$(date +%s)-$RANDOM"

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

alta T_JUAN OPERATOR juan
alta T_SOFIA VIEWER sofia

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

# El listado no pagina —son seis—, así que no lleva `parsePage` y por tanto
# tampoco filtros: una query sobra, y se ignora.
req GET "/process-templates?limit=2" --token "$T_OWNER"
ok "una query que no existe no estorba" 200
body "siguen saliendo las seis" '.data | length' 6

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

# ═════════════════════════════════════════════════════════════════════════════
resumen procesos
