#!/usr/bin/env bash
# Caja negra · WAVE 3 — «mover mercancía». Diego carga el saldo inicial desde la
# hoja; Juan (OPERATOR) recibe, ubica, traslada y despacha; presta el taladro;
# se equivoca y Diego lo corrige. Sofía (VIEWER) solo mira.
#
# Las siete operaciones del ledger, cada una con su camino feliz y el de error,
# que es lo que exige el cruce de cobertura de spec 06 §6.
#
# Se invoca solo o a través de ./scripts/blackbox.sh.
set -uo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

SLUG="movimientos-$(date +%s)-$RANDOM"
AHORA="$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"
FUTURO="$(date -u -d '+1 hour' +%Y-%m-%dT%H:%M:%S.000Z 2>/dev/null || date -u -v+1H +%Y-%m-%dT%H:%M:%S.000Z)"
VENCE="$(date -u -d '+7 days' +%Y-%m-%dT%H:%M:%S.000Z 2>/dev/null || date -u -v+7d +%Y-%m-%dT%H:%M:%S.000Z)"
AYER="$(date -u -d '-1 day' +%Y-%m-%dT%H:%M:%S.000Z 2>/dev/null || date -u -v-1d +%Y-%m-%dT%H:%M:%S.000Z)"

# mov <token> <json extra> — un movimiento con los campos comunes ya puestos.
mov() {
  local token="$1" extra="$2"
  req POST /movements --token "$token" \
    --body "$(jq -nc --argjson extra "$extra" --arg t "$AHORA" '{occurredAt:$t} + $extra')"
}

# ═════════════════════════════════════════════════════════════════════════════
exigir_servidor

# ─────────────────────────────────────────────────────────────────────────────
step "1 · la organización, el equipo y la bodega"
MARTA="marta-$SLUG@esquina.co"
req POST /organizations --idem none --body "$(jq -nc --arg s "$SLUG" --arg e "$MARTA" --arg p "$PASSWORD" \
  '{name:"Distribuidora La Esquina", slug:$s, owner:{email:$e, name:"Marta", password:$p}}')"
ok "registra la organización" 201

req POST /auth/login --idem none --body "$(jq -nc --arg e "$MARTA" --arg p "$PASSWORD" --arg s "$SLUG" \
  '{email:$e, password:$p, slug:$s}')"
T_OWNER="$(jqv '.accessToken')"
alta T_DIEGO ADMIN diego
alta T_JUAN OPERATOR juan
alta T_SOFIA VIEWER sofia

nodo() { # nodo <var> <code> [parentId]
  local -n dest="$1"
  local extra='{}'
  [[ $# -ge 3 ]] && extra="$(jq -nc --arg p "$3" '{parentId:$p}')"
  req POST /nodes --token "$T_DIEGO" \
    --body "$(jq -nc --arg c "$2" --argjson e "$extra" '{kind:"INTERNAL", code:$c, name:$c} + $e')"
  dest="$(jqv '.id')"
}
nodo BODA BOD-A
nodo Z1 Z1 "$BODA"
nodo E3 E3 "$Z1"
nodo B2 B2 "$E3"
nodo B3 B3 "$E3"
nodo MUELLE MUELLE
ok "la bodega queda dibujada" 201

frontera() { # frontera <var> <kind> <code>
  local -n dest="$1"
  req GET "/nodes?kind=$2" --token "$T_DIEGO" --no-cov
  dest="$(jq -r --arg c "$3" '[.data[] | select(.code==$c)][0].id' < "$BODY_F")"
}
frontera SUPPLIER SOURCE supplier-default
frontera OPENING SOURCE opening-balance
frontera SHRINK TERMINAL shrinkage
frontera SALE TERMINAL sale
frontera ADJ_IN SOURCE adjustment-in
frontera ADJ_OUT TERMINAL adjustment-out

req POST /products --token "$T_DIEGO" \
  --body '{"sku":"TOR-M8","name":"Tornillo M8 galvanizado","trackingMode":"QUANTITY","uom":"UNIT"}'
ok "crea el tornillo" 201
TOR="$(jqv '.id')"

req POST /products --token "$T_DIEGO" \
  --body '{"sku":"TAL-BOSCH","name":"Taladro Bosch GSB 13 RE","trackingMode":"SERIAL","uom":"UNIT"}'
TAL="$(jqv '.id')"
req POST "/products/$TAL/batches" --token "$T_DIEGO" --body '{"serial":"BSH-001"}'
ok "da de alta la serie BSH-001" 201
BSH="$(jqv '.id')"

req POST /products --token "$T_DIEGO" \
  --body '{"sku":"LECHE-1L","name":"Leche entera 1 L","trackingMode":"LOT","uom":"L"}'
LECHE="$(jqv '.id')"

# ─────────────────────────────────────────────────────────────────────────────
step "2 · Diego carga el saldo inicial desde la hoja"
linea() { jq -nc --arg p "$TOR" --arg f "$OPENING" --arg t "$1" --arg q "$2" --arg w "$AHORA" \
  '{productId:$p, fromNodeId:$f, toNodeId:$t, quantity:$q, occurredAt:$w}'; }
req POST /movements/batch --token "$T_DIEGO" \
  --body "$(jq -nc --argjson a "$(linea "$B2" 40)" --argjson b "$(linea "$B3" 20)" '{movements:[$a,$b]}')"
ok "carga dos líneas de una vez" 201
body "devuelve los dos movimientos" '.movements | length' 2

req GET "/stock?custodialOnly=true&productId=$TOR" --token "$T_DIEGO"
ok "y el inventario propio ya suma" 200
body "sesenta tornillos repartidos" '[.data[].quantity | tonumber] | add | floor' 60

# Todo o nada: una línea inválida en medio y no entra ninguna.
req POST /movements/batch --token "$T_DIEGO" \
  --body "$(jq -nc --argjson a "$(linea "$B2" 5)" --argjson b "$(linea "$B2" 0)" '{movements:[$a,$b]}')"
problem "una línea inválida tumba el lote entero" 422 non-positive-quantity
req GET "/stock?custodialOnly=true&productId=$TOR" --token "$T_DIEGO" --no-cov
body "y el saldo no se movió" '[.data[].quantity | tonumber] | add | floor' 60

# ─────────────────────────────────────────────────────────────────────────────
step "3 · llega el proveedor, y Juan lo ubica (criterio 3)"
mov "$T_JUAN" "$(jq -nc --arg p "$TOR" --arg f "$SUPPLIER" --arg t "$MUELLE" \
  '{productId:$p, fromNodeId:$f, toNodeId:$t, quantity:"100"}')"
ok "recibe 100 en el muelle" 201
RECEPCION="$(jqv '.movement.id')"
body "el asiento trae sus dos relojes" '(.movement.occurredAt != null) and (.movement.recordedAt != null)' true

req GET "/movements/$RECEPCION" --token "$T_JUAN"
ok "y se puede leer por id" 200
body "registrado no es anterior a ocurrido" '.recordedAt >= .occurredAt' true

mov "$T_JUAN" "$(jq -nc --arg p "$TOR" --arg f "$MUELLE" --arg t "$B2" \
  '{productId:$p, fromNodeId:$f, toNodeId:$t, quantity:"100"}')"
ok "y las ubica en B2" 201

req GET "/stock?nodeId=$MUELLE&custodialOnly=true" --token "$T_JUAN" --no-cov
body "el muelle queda vacío" '.data | length' 0

# ─────────────────────────────────────────────────────────────────────────────
step "4 · traslado que cuadra (criterio 4) y venta (criterio 6)"
mov "$T_JUAN" "$(jq -nc --arg p "$TOR" --arg f "$B2" --arg t "$B3" \
  '{productId:$p, fromNodeId:$f, toNodeId:$t, quantity:"40"}')"
ok "traslada 40 de B2 a B3" 201

req GET "/stock?under=$Z1&productId=$TOR" --token "$T_JUAN"
ok "la zona entera se agrega" 200
body "y sigue sumando 160" '[.data[].quantity | tonumber] | add | floor' 160

mov "$T_JUAN" "$(jq -nc --arg p "$TOR" --arg f "$B3" --arg t "$SALE" \
  '{productId:$p, fromNodeId:$f, toNodeId:$t, quantity:"15"}')"
ok "despacha 15" 201
req GET "/stock?custodialOnly=true&productId=$TOR" --token "$T_JUAN" --no-cov
body "el inventario propio baja a 145" '[.data[].quantity | tonumber] | add | floor' 145
req GET "/stock?nodeId=$SALE&custodialOnly=false&nonZeroOnly=false" --token "$T_JUAN" --no-cov
body "y la venta acumula 15" '.data[0].quantity' '15.000'

# ─────────────────────────────────────────────────────────────────────────────
step "5 · la merma exige motivo; el consumo no es un ajuste"
mov "$T_JUAN" "$(jq -nc --arg p "$TOR" --arg f "$B3" --arg t "$SHRINK" \
  '{productId:$p, fromNodeId:$f, toNodeId:$t, quantity:"1"}')"
problem "sin motivo, no" 422 reason-required
pointer "y el puntero señala el motivo" '/reason'

mov "$T_JUAN" "$(jq -nc --arg p "$TOR" --arg f "$B3" --arg t "$SHRINK" \
  '{productId:$p, fromNodeId:$f, toNodeId:$t, quantity:"1", reason:"se mojó"}')"
ok "con motivo, sí" 201

# ─────────────────────────────────────────────────────────────────────────────
step "6 · no se despacha lo que no hay (I-4)"
mov "$T_JUAN" "$(jq -nc --arg p "$TOR" --arg f "$B3" --arg t "$SALE" \
  '{productId:$p, fromNodeId:$f, toNodeId:$t, quantity:"999"}')"
problem "insufficient-stock" 422 insufficient-stock
body "el detalle nombra el bin por su path" '.detail | test("BOD-A/Z1/E3/B3")' true
body "y dice cuánto hay" '.errors[0].available != null' true
body "y cuánto se pidió" '.errors[0].requested' '999.000'

req GET "/stock?nodeId=$B3&custodialOnly=true" --token "$T_JUAN" --no-cov
SALDO_B3="$(jqv '.data[0].quantity')"

# ─────────────────────────────────────────────────────────────────────────────
step "7 · las reglas del asiento"
mov "$T_JUAN" "$(jq -nc --arg p "$TOR" --arg f "$B2" '{productId:$p, fromNodeId:$f, toNodeId:$f, quantity:"1"}')"
problem "mismo origen y destino" 422 same-node

mov "$T_JUAN" "$(jq -nc --arg p "$TOR" --arg f "$B2" --arg t "$B3" \
  '{productId:$p, fromNodeId:$f, toNodeId:$t, quantity:"0"}')"
problem "cantidad cero" 422 non-positive-quantity

req POST /movements --token "$T_JUAN" --body "$(jq -nc --arg p "$TOR" --arg f "$B2" --arg t "$B3" --arg w "$FUTURO" \
  '{productId:$p, fromNodeId:$f, toNodeId:$t, quantity:"1", occurredAt:$w}')"
problem "una hora en el futuro" 422 future-occurrence

mov "$T_JUAN" "$(jq -nc --arg p "$LECHE" --arg f "$SUPPLIER" --arg t "$B2" \
  '{productId:$p, fromNodeId:$f, toNodeId:$t, quantity:"6"}')"
problem "la leche se lleva por lote" 422 batch-required

mov "$T_JUAN" "$(jq -nc --arg p "$TOR" --arg b "$BSH" --arg f "$SUPPLIER" --arg t "$B2" \
  '{productId:$p, batchId:$b, fromNodeId:$f, toNodeId:$t, quantity:"1"}')"
problem "el tornillo no tiene lotes" 422 batch-not-allowed

mov "$T_JUAN" "$(jq -nc --arg p "$TOR" --arg f "$B2" --arg t "$B3" --arg d "$VENCE" \
  '{productId:$p, fromNodeId:$f, toNodeId:$t, quantity:"1", dueAt:$d}')"
problem "fecha de devolución sin custodia" 422 due-date-not-allowed

# ─────────────────────────────────────────────────────────────────────────────
step "8 · el préstamo del taladro (I-9, I-17, I-18)"
req POST /nodes --token "$T_DIEGO" --no-cov --body '{"kind":"CUSTODY","code":"juan","name":"Juan Pérez"}'
JUAN_NODO="$(jqv '.id')"

mov "$T_JUAN" "$(jq -nc --arg p "$TAL" --arg b "$BSH" --arg f "$SUPPLIER" --arg t "$B2" \
  '{productId:$p, batchId:$b, fromNodeId:$f, toNodeId:$t, quantity:"1"}')"
ok "recibe el taladro" 201

mov "$T_JUAN" "$(jq -nc --arg p "$TAL" --arg b "$BSH" --arg f "$SUPPLIER" --arg t "$B3" \
  '{productId:$p, batchId:$b, fromNodeId:$f, toNodeId:$t, quantity:"1"}')"
problem "y recibirlo otra vez, no: una serie es una sola cosa" 422 serial-already-placed

mov "$T_JUAN" "$(jq -nc --arg p "$TAL" --arg b "$BSH" --arg f "$B2" --arg t "$JUAN_NODO" --arg d "$VENCE" \
  '{productId:$p, batchId:$b, fromNodeId:$f, toNodeId:$t, quantity:"1", dueAt:$d}')"
ok "se lo presta a Juan" 201
PRESTAMO_TAL="$(jqv '.movement.id')"

req GET /stock/custodies --token "$T_DIEGO"
ok "y aparece en los préstamos abiertos" 200
body "con su pendiente" '[.data[] | select(.checkOut.id=="'"$PRESTAMO_TAL"'")][0].pending' '1.000'
body "y todavía no está vencido" '[.data[] | select(.checkOut.id=="'"$PRESTAMO_TAL"'")][0].overdue' false

mov "$T_JUAN" "$(jq -nc --arg p "$TAL" --arg b "$BSH" --arg f "$JUAN_NODO" --arg t "$B2" \
  '{productId:$p, batchId:$b, fromNodeId:$f, toNodeId:$t, quantity:"1"}')"
problem "devolver sin decir qué préstamo salda, no" 422 settles-required

mov "$T_JUAN" "$(jq -nc --arg p "$TAL" --arg b "$BSH" --arg f "$JUAN_NODO" --arg t "$B2" --arg s "$PRESTAMO_TAL" \
  '{productId:$p, batchId:$b, fromNodeId:$f, toNodeId:$t, quantity:"1", settlesId:$s}')"
ok "devolverlo saldando el préstamo, sí" 201

req GET /stock/custodies --token "$T_DIEGO" --no-cov
body "y el préstamo se cierra" '[.data[] | select(.checkOut.id=="'"$PRESTAMO_TAL"'")] | length' 0

step "9 · un préstamo por cantidad, vencido"
mov "$T_JUAN" "$(jq -nc --arg p "$TOR" --arg f "$B2" --arg t "$JUAN_NODO" --arg d "$AYER" --arg w "$AYER" \
  '{productId:$p, fromNodeId:$f, toNodeId:$t, quantity:"5", dueAt:$d, occurredAt:$w}')"
ok "le presta 5 tornillos con fecha de ayer" 201
PRESTAMO_TOR="$(jqv '.movement.id')"

mov "$T_JUAN" "$(jq -nc --arg p "$TOR" --arg f "$JUAN_NODO" --arg t "$B2" --arg s "$PRESTAMO_TOR" \
  '{productId:$p, fromNodeId:$f, toNodeId:$t, quantity:"2", settlesId:$s}')"
ok "devuelve 2" 201

req GET "/stock/custodies?overdueOnly=true" --token "$T_DIEGO" --no-cov
body "el filtro devuelve solo el vencido" '[.data[] | select(.checkOut.id=="'"$PRESTAMO_TOR"'")][0].overdue' true
body "con el pendiente que queda" '[.data[] | select(.checkOut.id=="'"$PRESTAMO_TOR"'")][0].pending' '3.000'

mov "$T_JUAN" "$(jq -nc --arg p "$TOR" --arg f "$JUAN_NODO" --arg t "$B2" --arg s "$PRESTAMO_TOR" \
  '{productId:$p, fromNodeId:$f, toNodeId:$t, quantity:"4", settlesId:$s}')"
problem "devolver más de lo que debe, no" 422 settles-exceeded
body "y el error dice el pendiente real" '.errors[0].pending' '3.000'

# ─────────────────────────────────────────────────────────────────────────────
step "10 · el error y su compensación (criterio 7)"
mov "$T_JUAN" "$(jq -nc --arg p "$TOR" --arg f "$SUPPLIER" --arg t "$B2" \
  '{productId:$p, fromNodeId:$f, toNodeId:$t, quantity:"100"}')"
ok "Juan registra 100 donde eran 10" 201
ERROR_MOV="$(jqv '.movement.id')"

req POST "/movements/$ERROR_MOV/reverse" --token "$T_JUAN" --body '{"reason":"eran 10"}'
problem "el OPERATOR no compensa" 403 insufficient-role

req POST "/movements/$ERROR_MOV/reverse" --token "$T_DIEGO" --body '{"reason":"eran 10, no 100"}'
ok "Diego sí, y la compensación es un asiento nuevo" 201
body "que apunta al original" '.movement.reversesId' "$ERROR_MOV"
header "con su propio Location" location "~/v1/movements/"

req POST "/movements/$ERROR_MOV/reverse" --token "$T_DIEGO" --body '{"reason":"otra vez"}'
problem "y no se compensa dos veces" 409 already-reversed

req GET "/movements?nodeId=$B2" --token "$T_DIEGO"
ok "el histórico muestra los dos asientos" 200
body "el original sigue ahí" '[.data[] | select(.id=="'"$ERROR_MOV"'")] | length' 1
body "y su compensación también" '[.data[] | select(.reversesId=="'"$ERROR_MOV"'")] | length' 1

# ─────────────────────────────────────────────────────────────────────────────
step "11 · los filtros declarados, y los que no"
req GET "/movements?sort=-occurredAt&limit=5" --token "$T_DIEGO" --no-cov
ok "ordena por occurredAt" 200
body "lo último primero" '.data[0].occurredAt >= .data[-1].occurredAt' true

req GET "/movements?sort=quantity" --token "$T_DIEGO"
problem "ordenar por cantidad, no" 400 invalid-filter

req GET "/movements?orgId=otra" --token "$T_DIEGO"
problem "un filtro que no se declaró tampoco" 400 invalid-filter

req GET "/stock?under=$(uuid)" --token "$T_DIEGO"
problem "un subárbol que no existe es invalid-filter, no una página vacía" 400 invalid-filter

req GET "/movements/$(uuid)" --token "$T_DIEGO"
problem "un movimiento que no existe" 404 not-found

req GET "/stock/custodies?sort=pending" --token "$T_DIEGO"
problem "ordenar las custodias por pendiente, no" 400 invalid-filter

# ─────────────────────────────────────────────────────────────────────────────
step "12 · Sofía solo mira, y el catálogo respeta el ledger"
req POST /movements --token "$T_SOFIA" --body "$(jq -nc --arg p "$TOR" --arg f "$B2" --arg t "$B3" --arg w "$AHORA" \
  '{productId:$p, fromNodeId:$f, toNodeId:$t, quantity:"1", occurredAt:$w}')"
problem "Sofía no registra" 403 insufficient-role

req GET /movements --token "$T_SOFIA" --no-cov
ok "pero lee el histórico" 200

req PATCH "/products/$TOR" --token "$T_DIEGO" --if-match 1 --no-cov --body '{"trackingMode":"LOT"}'
problem "un producto con movimientos no cambia de modo (I-15)" 422 tracking-mode-locked

req DELETE "/nodes/$B2" --token "$T_DIEGO" --no-cov
problem "ni se retira un bin con saldo (N-3)" 422 node-has-stock

# ─────────────────────────────────────────────────────────────────────────────
step "13 · reintentos (criterio 9)"
CLAVE="$(uuid)"
CUERPO="$(jq -nc --arg p "$TOR" --arg f "$SUPPLIER" --arg t "$B2" --arg w "$AHORA" \
  '{productId:$p, fromNodeId:$f, toNodeId:$t, quantity:"3", occurredAt:$w}')"
req POST /movements --token "$T_JUAN" --raw-idem "$CLAVE" --body "$CUERPO" --no-cov
ok "el primer intento entra" 201
PRIMERO="$(jqv '.movement.id')"
req POST /movements --token "$T_JUAN" --raw-idem "$CLAVE" --body "$CUERPO" --no-cov
ok "el reintento replica" 201
body "el mismo movimiento, no uno nuevo" '.movement.id' "$PRIMERO"
header "y lo dice" idempotency-replayed true

req POST /movements --token "$T_JUAN" --body "$(jq -nc --arg i "$PRIMERO" --argjson c "$CUERPO" '$c + {id:$i}')" --no-cov
problem "el mismo id de cliente con otra clave, no" 409 movement-id-taken

# Lo que de verdad prueba I-7 sobre un ledger: no que la respuesta se repita,
# sino que el saldo no subiera dos veces.
req GET "/stock?nodeId=$B2&productId=$TOR&nonZeroOnly=false" --token "$T_JUAN" --no-cov
body "y el saldo no sumó dos veces" '.data[0].quantity' '100.000'

# ─────────────────────────────────────────────────────────────────────────────
step "14 · lo que el primer día también trae"

# Los ajustes exigen motivo por los dos lados; el consumo no, porque no es una
# corrección (D-10, D-36).
mov "$T_JUAN" "$(jq -nc --arg p "$TOR" --arg f "$B2" --arg t "$ADJ_OUT" \
  '{productId:$p, fromNodeId:$f, toNodeId:$t, quantity:"1"}')"
problem "el ajuste negativo sin motivo tampoco" 422 reason-required

mov "$T_DIEGO" "$(jq -nc --arg p "$TOR" --arg f "$ADJ_IN" --arg t "$B2" \
  '{productId:$p, fromNodeId:$f, toNodeId:$t, quantity:"5", reason:"aparecieron en el conteo"}')"
ok "con motivo, el ajuste positivo entra" 201

# I-8 por su tercer lado: el lote existe, pero es de otro producto.
mov "$T_JUAN" "$(jq -nc --arg p "$LECHE" --arg b "$BSH" --arg f "$SUPPLIER" --arg t "$B2" \
  '{productId:$p, batchId:$b, fromNodeId:$f, toNodeId:$t, quantity:"6"}')"
problem "un lote de otro producto" 422 batch-product-mismatch

# I-17: el préstamo que se dice saldar tiene que ser de lo mismo.
mov "$T_JUAN" "$(jq -nc --arg p "$TAL" --arg b "$BSH" --arg f "$JUAN_NODO" --arg t "$B2" --arg s "$PRESTAMO_TOR" \
  '{productId:$p, batchId:$b, fromNodeId:$f, toNodeId:$t, quantity:"1", settlesId:$s}')"
problem "saldar el préstamo equivocado" 422 settles-mismatch

# Una compensación puede quedarse sin saldo, y entonces falla como cualquier
# movimiento: el sistema no inventa existencias para cuadrar una corrección.
mov "$T_JUAN" "$(jq -nc --arg p "$TOR" --arg f "$SUPPLIER" --arg t "$B3" \
  '{productId:$p, fromNodeId:$f, toNodeId:$t, quantity:"10"}')"
ok "entra una remesa en B3" 201
REMESA_B3="$(jqv '.movement.id')"

req GET "/stock?nodeId=$B3&productId=$TOR&nonZeroOnly=false" --token "$T_JUAN" --no-cov
mov "$T_JUAN" "$(jq -nc --arg p "$TOR" --arg f "$B3" --arg t "$B2" --arg q "$(jqv '.data[0].quantity')" \
  '{productId:$p, fromNodeId:$f, toNodeId:$t, quantity:$q}')"
ok "y se vacía B3 entero" 201

req POST "/movements/$REMESA_B3/reverse" --token "$T_DIEGO" --no-cov --body '{"reason":"el proveedor se la lleva"}'
problem "compensar lo que ya no está, no" 422 insufficient-stock
body "y dice dónde faltaba" '.detail | test("BOD-A/Z1/E3/B3")' true

# C-9: no se retira del catálogo lo que sigue en una estantería.
req DELETE "/products/$TOR" --token "$T_DIEGO" --no-cov
problem "un producto con existencias no se retira" 422 product-has-stock
body "y el detalle dice en qué sitios está" '.nodes | length > 0' true

# I-16, con un DELETE de verdad por delante.
req POST /nodes --token "$T_DIEGO" --no-cov --body "$(jq -nc --arg p "$E3" '{kind:"INTERNAL", code:"B4", name:"B4", parentId:$p}')"
B4="$(jqv '.id')"
req DELETE "/nodes/$B4" --token "$T_DIEGO" --no-cov
ok "un bin vacío sí se desactiva" 204
mov "$T_JUAN" "$(jq -nc --arg p "$TOR" --arg f "$B2" --arg t "$B4" \
  '{productId:$p, fromNodeId:$f, toNodeId:$t, quantity:"1"}')"
problem "y ya no admite movimientos" 422 node-inactive

# La hoja de cálculo de verdad: doscientas líneas por el socket, no por inject.
req POST /nodes --token "$T_DIEGO" --no-cov --body "$(jq -nc --arg p "$E3" '{kind:"INTERNAL", code:"B5", name:"B5", parentId:$p}')"
B5="$(jqv '.id')"
req POST /movements/batch --token "$T_DIEGO" --no-cov \
  --body "$(jq -nc --argjson l "$(linea "$B5" 1)" '{movements: [range(200) | $l]}')"
ok "doscientas líneas de una vez" 201
body "y son doscientos asientos" '.movements | length' 200
req GET "/stock?nodeId=$B5&productId=$TOR" --token "$T_DIEGO" --no-cov
body "que suman doscientos en el bin" '.data[0].quantity' '200.000'

# 501 clavados: con 502 respondería el @ArrayMaxSize del DTO con un 400 pelado,
# y lo que se quiere ver es la respuesta de negocio.
req POST /movements/batch --token "$T_DIEGO" --no-cov \
  --body "$(jq -nc --argjson l "$(linea "$B5" 1)" '{movements: [range(501) | $l]}')"
problem "quinientas una, no" 422 batch-too-large
body "y el detalle dice cuál es el tope" '.detail | test("500")' true

resumen "movimientos"
