#!/usr/bin/env bash
# ═════════════════════════════════════════════════════════════════════════════
# «El inventario del sábado»
#
# La bodega cierra y se cuenta. Sobran doce tornillos y faltan tres litros, y
# eso no se arregla editando un número: se asienta contra las fronteras de
# ajuste, con un motivo, y queda en el histórico para siempre.
#
# El corazón del escenario es lo que pasa DESPUÉS de cada 422: se relee el
# saldo. Un error que deja el inventario a medias es peor que no tener el
# endpoint, y es lo único que una suite de códigos de estado no ve.
# ═════════════════════════════════════════════════════════════════════════════
set -uo pipefail
AQUI="$(dirname "${BASH_SOURCE[0]}")"
source "$AQUI/lib.sh"
source "$AQUI/mundo.sh"

exigir_servidor
montar_mundo conteo

# ─────────────────────────────────────────────────────────────────────────────
step "1 · el saldo inicial, de un tirón"

# Ocho líneas en una transacción: o entran todas o no entra ninguna.
LOTE_BODY="$(jq -nc --arg f "$(ahora '+60 days')" '{lotCode:"L-SAB", expiresAt:$f}')"
req POST "/products/$P_LECHE/batches" --token "$T_JUAN" --body "$LOTE_BODY"
ok "se abre el lote de la leche" 201
LOTE="$(jqv '.id')"

APERTURA="$(jq -nc \
  --arg tor "$P_TOR" --arg leche "$P_LECHE" --arg lote "$LOTE" \
  --arg o "$OPENING" --arg b2 "$B2" --arg b3 "$B3" --arg z "$MUELLE" --arg t "$(ahora)" '
  { movements: [
      {productId:$tor,   fromNodeId:$o, toNodeId:$b2, quantity:"500.000", occurredAt:$t},
      {productId:$tor,   fromNodeId:$o, toNodeId:$b3, quantity:"300.000", occurredAt:$t},
      {productId:$tor,   fromNodeId:$o, toNodeId:$z,  quantity:"40.000",  occurredAt:$t},
      {productId:$leche, fromNodeId:$o, toNodeId:$b2, quantity:"120.000", occurredAt:$t, batchId:$lote},
      {productId:$leche, fromNodeId:$o, toNodeId:$b3, quantity:"80.000",  occurredAt:$t, batchId:$lote},
      {productId:$leche, fromNodeId:$o, toNodeId:$z,  quantity:"12.000",  occurredAt:$t, batchId:$lote},
      {productId:$tor,   fromNodeId:$o, toNodeId:$b2, quantity:"60.000",  occurredAt:$t},
      {productId:$leche, fromNodeId:$o, toNodeId:$b2, quantity:"8.000",   occurredAt:$t, batchId:$lote}
  ]}')"
req POST /movements/batch --token "$T_JUAN" --body "$APERTURA"
ok "el saldo de apertura entra de un tirón" 201
body "los ocho asientos" '.movements | length' '8'

saldo_es "B2 arranca con 560 tornillos" "$T_JUAN" "$B2" "$P_TOR" '560.000'
saldo_es "B3 con 300" "$T_JUAN" "$B3" "$P_TOR" '300.000'
saldo_es "y B2 con 128 litros del lote" "$T_JUAN" "$B2" "$P_LECHE" '128.000' "$LOTE"

# ─────────────────────────────────────────────────────────────────────────────
step "2 · el subárbol agrega lo que las hojas suman"

# E3 cuelga de Z1 y tiene a B2 y B3 debajo. Lo que ?under= devuelva tiene que
# ser exactamente la suma de sus hojas, o el agregado está mintiendo.
req GET "/stock?under=$Z1&productId=$P_TOR" --token "$T_JUAN"
ok "el subárbol de Z1 se agrega" 200
cantidad "y son los 860 de B2 más B3" '[.data[].quantity | tonumber] | add | tostring' '860.000'

req GET "/stock?under=$Z1&productId=$P_LECHE" --token "$T_JUAN" --no-cov
cantidad "y los 208 litros" '[.data[].quantity | tonumber] | add | tostring' '208.000'

# El muelle cuelga de la raíz, no de Z1: si apareciera aquí, `under` estaría
# tomando prefijos en vez de subárboles (BOD-A/Z1 no es ancestro de BOD-A/Z10).
req GET "/stock?under=$Z1&productId=$P_TOR" --token "$T_JUAN" --no-cov
body "sin arrastrar lo que cuelga fuera" '[.data[] | select(.quantity=="40.000")] | length' '0'

req GET "/nodes/$Z1/tree" --token "$T_JUAN"
ok "y el árbol confirma quién cuelga de quién" 200
body "Z1 solo tiene a E3" '.children | length' '1'

# ─────────────────────────────────────────────────────────────────────────────
step "3 · se cuenta: sobran doce tornillos"

ejecutar_proceso AJU_IN "$T_JUAN" AJUSTE_ENTRADA \
  "item:$(jq -nc --arg c "$EAN_TOR" '{code:$c}')" \
  'lote:null' \
  'cantidad:{"quantity":"12.000"}' \
  'motivo:{"reason":"conteo del sábado: aparecieron doce en el suelo"}' \
  "destino:$(jq -nc --arg n "$B2" '{nodeId:$n}')" \
  'confirmar:{}'
body "el ajuste deja un asiento" '.movements | length' '1'
MOV_AJU="$(jqv '.movements[0].id')"
body "que viene de la frontera de ajuste" '.movements[0].fromNodeId' "$ADJ_IN"

saldo_es "y B2 sube exactamente doce" "$T_JUAN" "$B2" "$P_TOR" '572.000'

req GET "/movements/$MOV_AJU" --token "$T_JUAN"
ok "el motivo llega hasta el histórico" 200
body "y se puede leer" '.reason' 'conteo del sábado: aparecieron doce en el suelo'

# ─────────────────────────────────────────────────────────────────────────────
step "4 · y faltan tres litros"

ejecutar_proceso AJU_OUT "$T_JUAN" AJUSTE_SALIDA \
  "origen:$(jq -nc --arg n "$B2" '{nodeId:$n}')" \
  "item:$(jq -nc --arg c "$EAN_LECHE" '{code:$c}')" \
  "lote:$(jq -nc --arg l "$LOTE" '{lotCode:"L-SAB"}')" \
  'cantidad:{"quantity":"3.000"}' \
  'motivo:{"reason":"tres briks rotos en el estante"}' \
  'confirmar:{}'
body "sale hacia la frontera de ajuste" '.movements[0].toNodeId' "$ADJ_OUT"
saldo_es "y B2 baja a 125 litros" "$T_JUAN" "$B2" "$P_LECHE" '125.000' "$LOTE"

req GET "/products/$P_LECHE/batches" --token "$T_JUAN"
ok "el lote sigue existiendo aunque se ajustara" 200
body "con su código" '[.[] | select(.lotCode=="L-SAB")] | length' '1'

# ─────────────────────────────────────────────────────────────────────────────
step "5 · lo que un ajuste no puede hacer"

# Un ajuste sin motivo no es un ajuste, es un descuadre sin explicar.
ANTES_B2="$(saldo "$T_JUAN" "$B2" "$P_TOR")"
req POST /movements --token "$T_JUAN" --body "$(jq -nc \
  --arg p "$P_TOR" --arg f "$B2" --arg t "$ADJ_OUT" --arg o "$(ahora)" \
  '{productId:$p, fromNodeId:$f, toNodeId:$t, quantity:"5.000", occurredAt:$o}')"
problem "ajustar sin decir por qué, no" 422 reason-required
pointer "y lo dice sobre el motivo" /reason
saldo_es "y el saldo no se movió" "$T_JUAN" "$B2" "$P_TOR" '572.000'

# Contra `consumption` sí: gastar no es corregir, es un hecho físico.
req POST /movements --token "$T_JUAN" --body "$(jq -nc \
  --arg p "$P_TOR" --arg f "$B2" --arg t "$CONSUMO" --arg o "$(ahora)" \
  '{productId:$p, fromNodeId:$f, toNodeId:$t, quantity:"2.000", occurredAt:$o}')"
ok "pero consumir sin motivo sí, que es un hecho y no una corrección" 201
saldo_es "y ahí sí baja" "$T_JUAN" "$B2" "$P_TOR" '570.000'

# Un ajuste que dejaría el bin en negativo.
req POST /movements --token "$T_JUAN" --body "$(jq -nc \
  --arg p "$P_TOR" --arg f "$B3" --arg t "$ADJ_OUT" --arg o "$(ahora)" \
  '{productId:$p, fromNodeId:$f, toNodeId:$t, quantity:"9000.000", occurredAt:$o, reason:"descuadre imposible"}')"
problem "no se puede ajustar hacia abajo lo que no hay" 422 insufficient-stock
body "y dice cuánto había de verdad" '[.errors[]?.code] | index("insufficient-stock") != null' 'true'
saldo_es "B3 sigue con sus 300" "$T_JUAN" "$B3" "$P_TOR" '300.000'

# ─────────────────────────────────────────────────────────────────────────────
step "6 · el histórico del conteo"

req GET "/movements?productId=$P_TOR&limit=100" --token "$T_JUAN"
ok "el histórico del tornillo se lee" 200
body "lo último, primero" '.data[0].occurredAt >= .data[1].occurredAt' 'true'

req GET "/movements?productId=$P_TOR&from=$(ahora '-1 hour')&to=$(ahora '+1 hour')" --token "$T_JUAN" --no-cov
ok "y se puede acotar por fecha" 200
body "con todo lo de hoy dentro" '.data | length >= 4' 'true'

req GET "/movements?from=el-sabado" --token "$T_JUAN"
problem "una fecha que no es fecha no se acepta" 400 invalid-filter

req GET "/movements?sort=quantity" --token "$T_JUAN" --no-cov
problem "ni un orden que no existe" 400 invalid-filter

# ─────────────────────────────────────────────────────────────────────────────
step "7 · el cierre"

arqueo "$T_JUAN" "$P_TOR:TOR-M8" "$P_LECHE:LECHE-1L"

printf '\n  organización de esta corrida: %s\n' "$SLUG"
resumen conteo-ciclico
