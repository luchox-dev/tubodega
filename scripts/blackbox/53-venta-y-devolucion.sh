#!/usr/bin/env bash
# ═════════════════════════════════════════════════════════════════════════════
# «La venta del martes y el cliente que devuelve»
#
# La mercancía sale por una frontera TERMINAL y deja de ser inventario, pero no
# desaparece del mundo: el acumulado de `sale` la recuerda, y por eso la suma de
# todos los saldos sigue siendo cero. Cuando el cliente devuelve, no se «suma»
# stock: se compensa el asiento, y el histórico conserva las dos caras.
#
# Es también el escenario donde se recorre la paginación de verdad y se le
# manda un cursor roto, que es lo único que un cliente hace mal de continuo.
# ═════════════════════════════════════════════════════════════════════════════
set -uo pipefail
AQUI="$(dirname "${BASH_SOURCE[0]}")"
source "$AQUI/lib.sh"
source "$AQUI/mundo.sh"

exigir_servidor
montar_mundo venta

# ─────────────────────────────────────────────────────────────────────────────
step "1 · hay qué vender"

req POST /movements/batch --token "$T_JUAN" --body "$(jq -nc \
  --arg tor "$P_TOR" --arg o "$OPENING" --arg b2 "$B2" --arg b3 "$B3" --arg t "$(ahora)" '
  { movements: [
      {productId:$tor, fromNodeId:$o, toNodeId:$b2, quantity:"400.000", occurredAt:$t},
      {productId:$tor, fromNodeId:$o, toNodeId:$b3, quantity:"100.000", occurredAt:$t}
  ]}')"
ok "quinientos tornillos en dos bandejas" 201

# ─────────────────────────────────────────────────────────────────────────────
step "2 · la venta del martes"

ejecutar_proceso VENTA "$T_JUAN" SALIDA \
  "origen:$(jq -nc --arg n "$B2" '{nodeId:$n}')" \
  "item:$(jq -nc --arg c "$EAN_TOR" '{code:$c}')" \
  'lote:null' \
  'cantidad:{"quantity":"60.000"}' \
  "destino:$(jq -nc --arg n "$SALE" '{nodeId:$n}')" \
  'confirmar:{}'
MOV_VENTA="$(jqv '.movements[0].id')"
saldo_es "B2 baja sesenta" "$T_JUAN" "$B2" "$P_TOR" '340.000'

req GET "/stock?nodeId=$SALE&productId=$P_TOR&custodialOnly=false&nonZeroOnly=false" --token "$T_JUAN"
ok "la frontera de venta lleva la cuenta" 200
cantidad "acumulando en positivo lo que salió por ella" '.data[0].quantity' '60.000'

reconciliar_conservacion "$T_JUAN" "$P_TOR" 'TOR-M8 tras la venta'

# ─────────────────────────────────────────────────────────────────────────────
step "3 · el cliente devuelve"

req POST "/movements/$MOV_VENTA/reverse" --token "$T_DIEGO" --body '{"reason":"el cliente devolvió la caja sin abrir"}'
ok "la venta se compensa" 201
header "con su Location" location '~^/v1/movements/'
body "y el asiento nuevo apunta al viejo" '.movement.reversesId' "$MOV_VENTA"
saldo_es "los sesenta vuelven a B2" "$T_JUAN" "$B2" "$P_TOR" '400.000'

req GET "/movements/$MOV_VENTA" --token "$T_JUAN"
ok "la venta original sigue ahí, intacta" 200
cantidad "con su cantidad de siempre" '.quantity' '60.000'

req POST "/movements/$MOV_VENTA/reverse" --token "$T_DIEGO" --body '{"reason":"otra vez"}'
problem "y no se compensa dos veces (I-13)" 409 already-reversed

# ─────────────────────────────────────────────────────────────────────────────
step "4 · las otras cuatro puertas de salida"

for par in "$CONSUMO:7.000:se gastó en el taller" "$SHRINK:3.000:rotura en el estante" \
           "$DEVOL:5.000:devolución al proveedor por defecto de fábrica"; do
  N="${par%%:*}"; RESTO="${par#*:}"; Q="${RESTO%%:*}"; R="${RESTO#*:}"
  req POST /movements --token "$T_JUAN" --body "$(jq -nc \
    --arg p "$P_TOR" --arg f "$B2" --arg t "$N" --arg o "$(ahora)" --arg q "$Q" --arg r "$R" \
    '{productId:$p, fromNodeId:$f, toNodeId:$t, quantity:$q, occurredAt:$o, reason:$r}')"
  ok "sale por $N" 201
done
saldo_es "B2 queda con 385" "$T_JUAN" "$B2" "$P_TOR" '385.000'
reconciliar_conservacion "$T_JUAN" "$P_TOR" 'TOR-M8 con las cuatro fronteras'

# ─────────────────────────────────────────────────────────────────────────────
step "5 · quién puede hacer qué"

CUERPO_VENTA="$(jq -nc --arg p "$P_TOR" --arg f "$B2" --arg t "$SALE" --arg o "$(ahora)" \
  '{productId:$p, fromNodeId:$f, toNodeId:$t, quantity:"1.000", occurredAt:$o}')"
req POST /movements --token "$T_SOFIA" --body "$CUERPO_VENTA"
problem "Sofía no vende" 403 insufficient-role
saldo_es "y no vendió" "$T_JUAN" "$B2" "$P_TOR" '385.000'

req POST "/movements/$MOV_VENTA/reverse" --token "$T_JUAN" --body '{"reason":"Juan lo intenta"}'
problem "Juan tampoco compensa" 403 insufficient-role

# ─────────────────────────────────────────────────────────────────────────────
step "6 · el histórico entero, página a página"

recorrer_paginas GET "/movements?productId=$P_TOR&limit=2" "$T_JUAN"
ok "el histórico se recorre de dos en dos" 200
paginas_sin_repetidos "sin repetir ni saltarse un asiento"

TOTAL_PAG="$(jq 'length' <<<"$PAGINAS")"
req GET "/movements?productId=$P_TOR&limit=200" --token "$T_JUAN" --no-cov
TOTAL_UNA="$(jqv '.data | length')"
if [[ "$TOTAL_PAG" == "$TOTAL_UNA" ]]; then
  pass "y de dos en dos salen los mismos $TOTAL_PAG que de golpe"
else
  fail "paginando salieron $TOTAL_PAG asientos y de golpe $TOTAL_UNA"
fi

req GET "/movements?productId=$P_TOR&limit=200" --token "$T_JUAN" --no-cov
body "la última página lo dice" '.page.hasMore' 'false'
body "y no manda cursor a ninguna parte" '.page.nextCursor // "" | length' '0'

# ─────────────────────────────────────────────────────────────────────────────
step "7 · el cliente que pagina mal"

# Un cursor es opaco, y un cliente lo va a mandar mangled tarde o temprano:
# copiado a medias, de otra ordenación, o de una sesión anterior. Lo que no
# puede es reventar el servidor: spec 03 §5 solo admite `internal` para lo
# imprevisto, y esto es de lo más previsto que hay.
req GET "/movements?cursor=no-es-un-cursor" --token "$T_JUAN"
problem "un cursor ilegible es culpa del cliente, no del servidor" 400 invalid-filter

req GET "/products?cursor=$(printf '%s' '["otra","ordenacion"]' | base64 -w0)" --token "$T_JUAN"
problem "y un cursor de otra ordenación, igual" 400 invalid-filter

# Y lo mismo con un identificador: el cliente que escribe mal un filtro, o que
# manda el literal «null» porque su variable venía vacía, está haciendo una
# petición inválida. Que un UUID mal escrito en la ruta dé 404 y en la query
# reviente el servidor es la misma pregunta con dos respuestas distintas.
req GET "/stock?productId=no-soy-uuid" --token "$T_JUAN" --no-cov
problem "un identificador que no lo es, tampoco" 400 invalid-filter
req GET "/movements?productId=null" --token "$T_JUAN" --no-cov
problem "ni el literal «null» de una variable vacía" 400 invalid-filter

req GET "/movements?limit=0" --token "$T_JUAN" --no-cov
problem "un límite de cero no es un límite" 400 invalid-filter
req GET "/movements?limit=500" --token "$T_JUAN" --no-cov
problem "ni uno de quinientos" 400 invalid-filter

# ─────────────────────────────────────────────────────────────────────────────
step "8 · el orden que se pide es el orden que se da"

req GET "/movements?productId=$P_TOR&sort=occurredAt&limit=50" --token "$T_JUAN" --no-cov
M_ASC="$(jqv '[.data[].id] | join(",")')"
req GET "/movements?productId=$P_TOR&sort=-occurredAt&limit=50" --token "$T_JUAN" --no-cov
M_DESC="$(jqv '[.data[].id] | join(",")')"
M_REV="$(jqv '[.data[].id] | reverse | join(",")')"
if [[ "$M_ASC" == "$M_REV" && "$M_ASC" != "$M_DESC" ]]; then
  pass "/movements invierte de verdad cuando se le pide"
else
  fail "/movements no invierte — asc=[${M_ASC:0:40}…] desc=[${M_DESC:0:40}…]"
fi

# La misma pregunta a /stock. Que una colección acepte `sort` y lo tire es peor
# que no aceptarlo: el cliente cree que ordenó.
req GET "/stock?productId=$P_TOR&custodialOnly=false&nonZeroOnly=false&sort=nodeId&limit=50" --token "$T_JUAN" --no-cov
S_ASC="$(jqv '[.data[].nodeId] | join(",")')"
req GET "/stock?productId=$P_TOR&custodialOnly=false&nonZeroOnly=false&sort=-nodeId&limit=50" --token "$T_JUAN" --no-cov
S_DESC="$(jqv '[.data[].nodeId] | join(",")')"
S_REV="$(jqv '[.data[].nodeId] | reverse | join(",")')"
if [[ "$S_ASC" == "$S_REV" && "$S_ASC" != "$S_DESC" ]]; then
  pass "/stock también invierte cuando se le pide"
else
  fail "/stock acepta ?sort= y lo ignora — asc y desc devuelven el mismo orden"
fi

req GET "/stock?sort=inventado" --token "$T_JUAN" --no-cov
problem "y un orden que no existe se rechaza" 400 invalid-filter

# ─────────────────────────────────────────────────────────────────────────────
step "9 · el cierre"

arqueo "$T_JUAN" "$P_TOR:TOR-M8"

printf '\n  organización de esta corrida: %s\n' "$SLUG"
resumen venta-y-devolucion
