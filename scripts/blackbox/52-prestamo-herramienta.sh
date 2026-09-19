#!/usr/bin/env bash
# ═════════════════════════════════════════════════════════════════════════════
# «El taladro de Juan»
#
# Prestar no es despachar. La herramienta sale del estante pero sigue siendo de
# la casa, con fecha de vuelta, y el sistema tiene que saber en todo momento
# cuánto falta por volver. Aquí se prueba I-17 (todo lo que sale de una custodia
# salda un préstamo) e I-18 (lo saldado nunca supera lo prestado), que son los
# dos invariantes que ninguna otra suite cruza con el saldo real.
# ═════════════════════════════════════════════════════════════════════════════
set -uo pipefail
AQUI="$(dirname "${BASH_SOURCE[0]}")"
source "$AQUI/lib.sh"
source "$AQUI/mundo.sh"

exigir_servidor
montar_mundo prestamo

# ─────────────────────────────────────────────────────────────────────────────
step "1 · Juan tiene dónde tener las cosas"

nodo_de CUST_JUAN "$T_DIEGO" juan '' CUSTODY
ok "se abre la custodia de Juan" 201
body "y no es una ubicación interna" '.kind' 'CUSTODY'

req GET "/nodes?kind=CUSTODY&limit=50" --token "$T_DIEGO"
ok "aparece entre las custodias" 200
body "ella sola" '[.data[] | select(.code=="juan")] | length' '1'

# Herramienta y consumible: una va por serie, el otro por cantidad.
req POST "/products/$P_TALADRO/batches" --token "$T_JUAN" --body '{"serial":"BSH-001"}'
ok "el taladro tiene su número de serie" 201
SERIE="$(jqv '.id')"

req POST /movements/batch --token "$T_JUAN" --body "$(jq -nc \
  --arg tal "$P_TALADRO" --arg s "$SERIE" --arg tor "$P_TOR" \
  --arg o "$OPENING" --arg b2 "$B2" --arg t "$(ahora)" '
  { movements: [
      {productId:$tal, fromNodeId:$o, toNodeId:$b2, quantity:"1.000",  occurredAt:$t, batchId:$s},
      {productId:$tor, fromNodeId:$o, toNodeId:$b2, quantity:"90.000", occurredAt:$t}
  ]}')"
ok "y ambos están en la bandeja" 201

# ─────────────────────────────────────────────────────────────────────────────
step "2 · el préstamo, con fecha de vuelta"

ejecutar_proceso PREST "$T_JUAN" CUSTODIA \
  "origen:$(jq -nc --arg n "$B2" '{nodeId:$n}')" \
  'item:{"code":"BSH-001"}' \
  'lote:null' \
  'cantidad:{"quantity":"1.000"}' \
  "tenedor:$(jq -nc --arg n "$CUST_JUAN" '{nodeId:$n}')" \
  "vencimiento:$(jq -nc --arg d "$(ahora '+7 days')" '{dueAt:$d}')" \
  'confirmar:{}'
body "sale un asiento" '.movements | length' '1'
CHECKOUT="$(jqv '.movements[0].id')"
body "con fecha de vuelta" '.movements[0].dueAt | type' 'string'
body "hacia la custodia de Juan" '.movements[0].toNodeId' "$CUST_JUAN"

saldo_es "el taladro ya no está en la bandeja" "$T_JUAN" "$B2" "$P_TALADRO" '0' "$SERIE"
saldo_es "lo tiene Juan" "$T_JUAN" "$CUST_JUAN" "$P_TALADRO" '1.000' "$SERIE"

req GET /stock/custodies --token "$T_JUAN"
ok "y figura como préstamo abierto" 200
body "uno" '.data | length' '1'
cantidad "con el taladro entero pendiente" '.data[0].pending' '1.000'
body "y sin vencer todavía" '.data[0].overdue' 'false'
body "guardando el préstamo original" '.data[0].checkOut.id' "$CHECKOUT"

req GET "/stock?custodialOnly=true&productId=$P_TALADRO" --token "$T_JUAN" --no-cov
ok "las custodias cuentan como existencias propias" 200
body "el taladro sigue siendo de la casa" '[.data[] | select(.nodeId=="'"$CUST_JUAN"'")] | length' '1'

# ─────────────────────────────────────────────────────────────────────────────
step "3 · un préstamo que sí admite devolución parcial"

ejecutar_proceso PREST2 "$T_JUAN" CUSTODIA \
  "origen:$(jq -nc --arg n "$B2" '{nodeId:$n}')" \
  "item:$(jq -nc --arg c "$EAN_TOR" '{code:$c}')" \
  'lote:null' \
  'cantidad:{"quantity":"30.000"}' \
  "tenedor:$(jq -nc --arg n "$CUST_JUAN" '{nodeId:$n}')" \
  "vencimiento:$(jq -nc --arg d "$(ahora '+3 days')" '{dueAt:$d}')" \
  'confirmar:{}'
CHECK_TOR="$(jqv '.movements[0].id')"
saldo_es "Juan se lleva treinta tornillos" "$T_JUAN" "$CUST_JUAN" "$P_TOR" '30.000'

# Devuelve doce.
req POST /movements --token "$T_JUAN" --body "$(jq -nc \
  --arg p "$P_TOR" --arg f "$CUST_JUAN" --arg t "$B2" --arg o "$(ahora)" --arg s "$CHECK_TOR" \
  '{productId:$p, fromNodeId:$f, toNodeId:$t, quantity:"12.000", occurredAt:$o, settlesId:$s}')"
ok "devuelve doce" 201
saldo_es "y le quedan dieciocho" "$T_JUAN" "$CUST_JUAN" "$P_TOR" '18.000'

req GET "/stock/custodies?limit=50" --token "$T_JUAN" --no-cov
body "el préstamo sigue abierto" "[.data[] | select(.checkOut.id==\"$CHECK_TOR\")] | length" '1'
cantidad "con dieciocho pendientes" "[.data[] | select(.checkOut.id==\"$CHECK_TOR\")][0].pending" '18.000'

# ─────────────────────────────────────────────────────────────────────────────
step "4 · lo que una devolución no puede hacer"

# Devolver más de lo que se llevó.
req POST /movements --token "$T_JUAN" --body "$(jq -nc \
  --arg p "$P_TOR" --arg f "$CUST_JUAN" --arg t "$B2" --arg o "$(ahora)" --arg s "$CHECK_TOR" \
  '{productId:$p, fromNodeId:$f, toNodeId:$t, quantity:"50.000", occurredAt:$o, settlesId:$s}')"
problem "devolver más de lo prestado, no" 422 settles-exceeded
saldo_es "y no se movió nada" "$T_JUAN" "$CUST_JUAN" "$P_TOR" '18.000'

# Salir de una custodia sin decir qué préstamo se salda.
req POST /movements --token "$T_JUAN" --body "$(jq -nc \
  --arg p "$P_TOR" --arg f "$CUST_JUAN" --arg t "$B2" --arg o "$(ahora)" \
  '{productId:$p, fromNodeId:$f, toNodeId:$t, quantity:"1.000", occurredAt:$o}')"
problem "salir de una custodia sin saldar un préstamo, tampoco (I-17)" 422 settles-required
pointer "y señala el campo" /settlesId

# Saldar el préstamo equivocado: el del taladro no es el de los tornillos.
req POST /movements --token "$T_JUAN" --body "$(jq -nc \
  --arg p "$P_TOR" --arg f "$CUST_JUAN" --arg t "$B2" --arg o "$(ahora)" --arg s "$CHECKOUT" \
  '{productId:$p, fromNodeId:$f, toNodeId:$t, quantity:"1.000", occurredAt:$o, settlesId:$s}')"
problem "ni saldar el préstamo de otra cosa" 422 settles-mismatch
saldo_es "y sigue sin moverse" "$T_JUAN" "$CUST_JUAN" "$P_TOR" '18.000'

# Fecha de vuelta hacia algo que no es una custodia.
req POST /movements --token "$T_JUAN" --body "$(jq -nc \
  --arg p "$P_TOR" --arg f "$B2" --arg t "$B3" --arg o "$(ahora)" --arg d "$(ahora '+2 days')" \
  '{productId:$p, fromNodeId:$f, toNodeId:$t, quantity:"1.000", occurredAt:$o, dueAt:$d}')"
problem "una fecha de vuelta a un estante no significa nada (I-11)" 422 due-date-not-allowed
pointer "y lo dice" /dueAt

# ─────────────────────────────────────────────────────────────────────────────
step "5 · lo que ya venció"

# Un préstamo de hace diez días que tenía que volver hace tres.
req POST /movements --token "$T_JUAN" --body "$(jq -nc \
  --arg p "$P_TOR" --arg f "$B2" --arg t "$CUST_JUAN" \
  --arg o "$(ahora '-10 days')" --arg d "$(ahora '-3 days')" \
  '{productId:$p, fromNodeId:$f, toNodeId:$t, quantity:"5.000", occurredAt:$o, dueAt:$d}')"
ok "un préstamo viejo que ya venció" 201

req GET "/stock/custodies?overdueOnly=true" --token "$T_JUAN"
ok "la bandeja de vencidos" 200
body "saca solo el que venció" '.data | length' '1'
body "y lo marca" '.data[0].overdue' 'true'

req GET "/stock/custodies?limit=50" --token "$T_JUAN" --no-cov
body "sin el filtro salen los tres" '.data | length' '3'

# El orden de una colección es contrato: si `sort` se acepta, tiene que ordenar.
req GET "/stock/custodies?sort=occurredAt&limit=50" --token "$T_JUAN" --no-cov
ASC="$(jqv '[.data[].checkOut.id] | join(",")')"
req GET "/stock/custodies?sort=-occurredAt&limit=50" --token "$T_JUAN" --no-cov
DESC="$(jqv '[.data[].checkOut.id] | join(",")')"
REV="$(jqv '[.data[].checkOut.id] | reverse | join(",")')"
if [[ "$ASC" == "$REV" && "$ASC" != "$DESC" ]]; then
  pass "y pedir el orden inverso lo invierte de verdad"
else
  fail "el sort de /stock/custodies no invierte — asc=[$ASC] desc=[$DESC]"
fi

# ─────────────────────────────────────────────────────────────────────────────
step "6 · deshacer un préstamo no inventa existencias"

# La herramienta sigue fuera: compensar el check-out tendría que sacarla de una
# custodia que ya no la tiene disponible para eso.
req POST "/movements/$CHECKOUT/reverse" --token "$T_DIEGO" --body '{"reason":"se anotó mal el préstamo"}'
ok "compensar el préstamo del taladro se acepta" 201
saldo_es "y el taladro vuelve a la bandeja" "$T_JUAN" "$B2" "$P_TALADRO" '1.000' "$SERIE"
req GET /stock/custodies --token "$T_JUAN" --no-cov
body "y el préstamo deja de figurar abierto" "[.data[] | select(.checkOut.id==\"$CHECKOUT\")] | length" '0'

req POST "/movements/$CHECKOUT/reverse" --token "$T_DIEGO" --body '{"reason":"otra vez"}'
problem "pero solo se compensa una vez (I-13)" 409 already-reversed

req POST "/movements/$CHECK_TOR/reverse" --token "$T_JUAN" --body '{"reason":"Juan no puede"}'
problem "y un operario no compensa" 403 insufficient-role

# ─────────────────────────────────────────────────────────────────────────────
step "7 · se devuelve el resto"

req POST /movements --token "$T_JUAN" --body "$(jq -nc \
  --arg p "$P_TOR" --arg f "$CUST_JUAN" --arg t "$B2" --arg o "$(ahora)" --arg s "$CHECK_TOR" \
  '{productId:$p, fromNodeId:$f, toNodeId:$t, quantity:"18.000", occurredAt:$o, settlesId:$s}')"
ok "Juan devuelve los dieciocho que le quedaban" 201
req GET "/stock/custodies?limit=50" --token "$T_JUAN" --no-cov
body "y ese préstamo se cierra" "[.data[] | select(.checkOut.id==\"$CHECK_TOR\")] | length" '0'

# ─────────────────────────────────────────────────────────────────────────────
step "8 · el cierre"

arqueo "$T_JUAN" "$P_TOR:TOR-M8" "$P_TALADRO:TAL-18V"

printf '\n  organización de esta corrida: %s\n' "$SLUG"
resumen prestamo-herramienta
