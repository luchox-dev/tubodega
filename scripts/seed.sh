#!/usr/bin/env bash
# Siembra un mundo de ejemplo por HTTP: la organización de la narrativa, su
# gente, sus campos propios y su catálogo. Sirve para explorar la API con curl o
# con Postman sin construir antes diez peticiones de andamiaje, y para tener algo
# real contra lo que correr pruebas de caja negra cuando haga falta.
#
#   pnpm start:dev                 # en otra terminal
#   pnpm seed
#   BASE=http://localhost:3001 pnpm seed        # contra la pila de compose
#   SEED_SLUG=otra-esquina pnpm seed            # un segundo mundo
#   docker compose --profile seed up            # dentro de la red de compose
#
# ─────────────────────────────────────────────────────────────────────────────
# ESTE GUION SE ACTUALIZA EN CADA PLAN QUE AÑADA ENDPOINTS, igual que la
# colección de Postman. Un seed que se queda atrás es peor que no tenerlo: da la
# impresión de un mundo completo mientras le falta justo lo que acabas de
# construir. Hoy siembra todo lo que el contrato sabe crear —tenencia, catálogo
# y ubicaciones—; lo que todavía no existe, con el plan que lo traerá:
#
#   movimientos y existencias ................ plan 6
#   plantillas e instancias de proceso ....... plan 8
#   reglas de alerta ......................... plan 9
# ─────────────────────────────────────────────────────────────────────────────
#
# Escribe por HTTP y no contra la base a propósito: así respeta cada invariante
# sin reimplementar nada —argon2, UUIDv7, `version`, outbox, RLS— y no puede
# crear un estado que la aplicación nunca permitiría. Es el mismo principio de
# spec 06 §6: si algo no se puede montar por la API, es que a la API le falta algo.
#
# No vive en scripts/blackbox/ porque el runner descubre las suites con
# `blackbox/[0-9]*.sh`: ahí dentro, `pnpm blackbox` lo correría como una más.
set -uo pipefail

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/blackbox/lib.sh
source "$AQUI/blackbox/lib.sh"

# Fijo y no aleatorio: la gracia de un seed es poder volver mañana y entrar con
# las mismas credenciales. `alta()` compone los correos como <nombre>-$SLUG@…
SLUG="${SEED_SLUG:-la-esquina-demo}"
MARTA="marta-$SLUG@esquina.co"

exigir_servidor

step "1 · la organización"
req POST /organizations --idem none --body "$(jq -nc --arg s "$SLUG" --arg e "$MARTA" --arg p "$PASSWORD" \
  '{name:"Distribuidora La Esquina", slug:$s, owner:{email:$e, name:"Marta", password:$p}}')"

# Re-sembrar a medias chocaría contra la unicidad de códigos (C-2), series (C-5)
# y lotes (C-6), así que al segundo intento no se toca nada y se sale bien: el
# perfil de compose se puede levantar dos veces sin que explote.
if [[ "$ST" == 409 ]]; then
  printf '\n  El mundo «%s» ya está sembrado. No se toca nada.\n' "$SLUG"
  printf '  Para sembrar otro:  SEED_SLUG=otro-nombre pnpm seed\n\n'
  exit 0
fi
ok "queda registrada" 201
ORG_ID="$(jqv '.organization.id')"

req POST /auth/login --idem none --body "$(jq -nc --arg e "$MARTA" --arg p "$PASSWORD" --arg s "$SLUG" \
  '{email:$e, password:$p, slug:$s}')"
ok "Marta entra" 200
T_MARTA="$(jqv '.accessToken')"
T_OWNER="$T_MARTA"

step "2 · el equipo"
# `alta()` de lib.sh compone el correo a partir del nombre, y aquí los nombres
# van como los lee una persona: con mayúscula, y «Sofía» con tilde, que no tiene
# sitio en la parte local de un correo. Así que la siembra los pide por separado.
persona() { # persona <variable destino> <rol> <Nombre> <parte local del correo>
  local -n tok="$1"
  local role="$2" name="$3" mail="$4-$SLUG@esquina.co"
  req POST /users --token "$T_OWNER" --body "$(jq -nc --arg e "$mail" --arg n "$name" --arg p "$PASSWORD" --arg r "$role" \
    '{email:$e, name:$n, password:$p, roles:[$r]}')"
  ok "$name ($role)" 201
  req POST /auth/login --idem none --body "$(jq -nc --arg e "$mail" --arg p "$PASSWORD" --arg s "$SLUG" \
    '{email:$e, password:$p, slug:$s}')"
  ok "$name entra" 200
  tok="$(jqv '.accessToken')"
}

persona T_DIEGO ADMIN    Diego diego
persona T_JUAN  OPERATOR Juan  juan
persona T_SOFIA VIEWER   Sofía sofia

step "3 · los campos propios"
req POST /custom-fields --token "$T_DIEGO" \
  --body '{"entity":"PRODUCT","key":"proveedor","label":"Proveedor","type":"TEXT","position":0}'
ok "proveedor (TEXT)" 201
req POST /custom-fields --token "$T_DIEGO" \
  --body '{"entity":"PRODUCT","key":"familia","label":"Familia","type":"SELECT","options":["ferretería","aseo","alimentación"],"position":1}'
ok "familia (SELECT)" 201

step "4 · el catálogo"
# Los cuatro SKU canónicos del reparto narrativo (plan maestro §5). Aquí van sin
# sufijo: la unicidad de SKU es por organización, y el slug ya distingue mundos.
req POST /products --token "$T_DIEGO" --body '{
  "sku":"TOR-M8", "name":"Tornillo M8 galvanizado", "description":"Rosca fina",
  "trackingMode":"QUANTITY", "uom":"UNIT",
  "codes":[{"value":"7501000000017","kind":"EAN"}],
  "customFields":{"proveedor":"Ferretería Mundial","familia":"ferretería"}}'
ok "el tornillo, con su código de barras" 201
P_TOR="$(jqv '.id')"

req POST /products --token "$T_DIEGO" --body '{
  "sku":"ARROZ-25", "name":"Saco de arroz 25 kg",
  "trackingMode":"QUANTITY", "uom":"KG",
  "customFields":{"proveedor":"Molinos del Valle","familia":"alimentación"}}'
ok "el arroz, por kilos" 201
P_ARR="$(jqv '.id')"

req POST /products --token "$T_DIEGO" --body '{
  "sku":"LECHE-1L", "name":"Leche entera 1 L",
  "trackingMode":"LOT", "uom":"L",
  "customFields":{"familia":"alimentación"}}'
ok "la leche, por lote" 201
P_LEC="$(jqv '.id')"

req POST /products --token "$T_DIEGO" --body '{
  "sku":"TAL-BOSCH", "name":"Taladro Bosch GSB 13 RE",
  "trackingMode":"SERIAL", "uom":"UNIT",
  "customFields":{"proveedor":"Bosch","familia":"ferretería"}}'
ok "el taladro, por serie" 201
P_TAL="$(jqv '.id')"

step "5 · la bodega"
# Los ocho nodos de frontera no se siembran aquí: los pone el provisioner dentro
# de la transacción que dio de alta la organización (spec 04 §6). Lo que se
# comprueba es que estaban.
req GET "/nodes?kind=SOURCE" --token "$T_DIEGO"
ok "las tres fuentes ya estaban" 200
body "sin que nadie las creara" '.data | length' 3
req GET "/nodes?kind=TERMINAL" --token "$T_DIEGO"
body "y los cinco sumideros" '.data | length' 5

# El id sale por referencia y no por stdout: por stdout va el informe, y una
# sustitución de comando se lo tragaría entero junto con el id.
nodo() { # nodo <variable destino> <código> <nombre> [idPadre]
  local -n out="$1"
  local code="$2" name="$3" parent="${4:-}"
  if [[ -n "$parent" ]]; then
    req POST /nodes --token "$T_DIEGO" --body "$(jq -nc --arg c "$code" --arg n "$name" --arg p "$parent" \
      '{kind:"INTERNAL", code:$c, name:$n, parentId:$p}')"
  else
    req POST /nodes --token "$T_DIEGO" --body "$(jq -nc --arg c "$code" --arg n "$name" \
      '{kind:"INTERNAL", code:$c, name:$n}')"
  fi
  ok "$name" 201
  out="$(jqv '.id')"
}

# BOD-B lleva Z2 y no otro Z1: el código es único por organización, no por
# padre — el escáner no sabe bajo qué bodega está.
nodo N_BODA BOD-A "la bodega principal"
nodo N_MUELLE MUELLE "el muelle de recepción" "$N_BODA"
nodo N_Z1 Z1 "la zona 1" "$N_BODA"
nodo N_E3 E3 "el estante 3" "$N_Z1"
nodo N_B2 B2 "el bin 2" "$N_E3"
nodo N_B3 B3 "el bin 3" "$N_E3"
nodo N_BODB BOD-B "la segunda bodega"
nodo N_Z2 Z2 "su zona" "$N_BODB"

# Juan también es un sitio donde puede haber mercancía: los préstamos de la
# WAVE 3 van a un nodo CUSTODY, no a una tabla de personas.
req POST /nodes --token "$T_DIEGO" --body "$(jq -nc '{kind:"CUSTODY", code:"juan", name:"Juan (herramienta en préstamo)"}')"
ok "y Juan, que también es un nodo" 201

req GET "/nodes/$N_B2" --token "$T_DIEGO"
body "el path del bin es la cadena entera" '.path' 'BOD-A/Z1/E3/B2'

step "6 · una remesa y una unidad concreta"
# Lo que hace interesante a GET /v1/codes/{value}/resolve: con esto, escanear
# BSH-001 devuelve el taladro y la unidad, no solo el producto.
req POST "/products/$P_TAL/batches" --token "$T_JUAN" --body '{"serial":"BSH-001"}'
ok "la serie del taladro" 201
B_TAL="$(jqv '.id')"
req POST "/products/$P_LEC/batches" --token "$T_JUAN" \
  --body '{"lotCode":"L-2026-09","expiresAt":"2026-10-01T00:00:00.000Z"}'
ok "el lote de leche, con su vencimiento" 201
B_LEC="$(jqv '.id')"

step "7 · el saldo inicial, por HTTP como todo lo demás"
# Sin existencias, la bodega sembrada es un plano de una bodega vacía: ni GET
# /v1/stock ni un traslado ni un préstamo tienen nada que enseñar. Entra por
# `opening-balance`, que es el nodo SOURCE que existe justo para esto, y en un
# solo lote porque es exactamente lo que hace la carga desde una hoja.
frontera() { # frontera <var> <kind> <code>
  local -n dest="$1"
  req GET "/nodes?kind=$2" --token "$T_DIEGO" --no-cov
  dest="$(jq -r --arg c "$3" '[.data[] | select(.code==$c)][0].id' < "$BODY_F")"
}
frontera N_OPENING SOURCE opening-balance

AHORA="$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"
linea() { # linea <productId> <nodeId> <cantidad> [batchId]
  jq -nc --arg p "$1" --arg f "$N_OPENING" --arg t "$2" --arg q "$3" --arg w "$AHORA" --arg b "${4:-}" \
    '{productId:$p, fromNodeId:$f, toNodeId:$t, quantity:$q, occurredAt:$w}
     + (if $b == "" then {} else {batchId:$b} end)'
}
req POST /movements/batch --token "$T_DIEGO" --body "$(jq -nc \
  --argjson a "$(linea "$P_TOR" "$N_B2" 500)" \
  --argjson b "$(linea "$P_ARR" "$N_B3" 120)" \
  --argjson c "$(linea "$P_LEC" "$N_B3" 48 "$B_LEC")" \
  --argjson d "$(linea "$P_TAL" "$N_B2" 1 "$B_TAL")" \
  '{movements:[$a,$b,$c,$d]}')"
ok "las cuatro posiciones, en un solo lote" 201

req GET "/stock?custodialOnly=true" --token "$T_DIEGO"
body "y el inventario propio ya tiene cuatro posiciones" '.data | length' 4

# ─────────────────────────────────────────────────────────────────────────────
printf '\n  aciertos: %d\n  fallos:   %d\n' "$OK" "$BAD"
if ((BAD > 0)); then
  printf '\n  La siembra quedó a medias. Revisa lo de arriba.\n\n' >&2
  exit 1
fi

cat <<FIN

  ── sembrado en $BASE ──────────────────────────────────────────

  organización   Distribuidora La Esquina   ($SLUG)
  id             $ORG_ID

  Marta   OWNER      $MARTA
  Diego   ADMIN      diego-$SLUG@esquina.co
  Juan    OPERATOR   juan-$SLUG@esquina.co
  Sofía   VIEWER     sofia-$SLUG@esquina.co
  contraseña         $PASSWORD

  catálogo       TOR-M8 · ARROZ-25 · LECHE-1L · TAL-BOSCH
  escanea        7501000000017 (el tornillo) · BSH-001 (el taladro)
  bodega         BOD-A › MUELLE · BOD-A › Z1 › E3 › B2, B3 · BOD-B › Z2
  y además       juan (CUSTODY) y los ocho nodos de frontera
  existencias    B2: 500 TOR-M8 y el taladro · B3: 120 ARROZ-25 y 48 LECHE-1L

FIN
