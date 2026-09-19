#!/usr/bin/env bash
# ═════════════════════════════════════════════════════════════════════════════
# «La hoja de cálculo del proveedor»
#
# Llega un fichero con ciento veinte referencias, y viene como vienen siempre:
# con una fila repetida y otra sin SKU. El import no puede abortar el lote por
# eso —serían ciento dieciocho productos perdidos por dos erratas— pero tiene
# que decir exactamente qué fila falló.
#
# Y después se recorre el catálogo entero paginando, que es donde vivía D-67:
# mil filas escritas en una transacción comparten el `now()`, y un cursor que
# trunque el milisegundo se salta la segunda página en silencio.
# ═════════════════════════════════════════════════════════════════════════════
set -uo pipefail
AQUI="$(dirname "${BASH_SOURCE[0]}")"
source "$AQUI/lib.sh"
source "$AQUI/mundo.sh"

exigir_servidor
montar_mundo catalogo

# ─────────────────────────────────────────────────────────────────────────────
step "1 · ciento veinte referencias, dos de ellas malas"

MARCA="IMP$RANDOM$RANDOM"
FILAS="$(jq -nc --arg m "$MARCA" '
  [ range(1;121) | {sku: ($m + "-" + (.|tostring)), name: ("Referencia " + (.|tostring)),
                    trackingMode: "QUANTITY", uom: "UNIT"} ]
  + [ {sku: ($m + "-1"), name: "Referencia 1, que venía dos veces", trackingMode: "QUANTITY", uom: "UNIT"} ]
  + [ {sku: ($m + "-MALA"), name: "En docenas", trackingMode: "QUANTITY", uom: "DOCENA"} ]
  | {rows: .}')"
req POST /products/import --token "$T_DIEGO" --body "$FILAS"
ok "el fichero entra" 200
body "ciento veinte creadas" '.created' '120'
body "y una actualizada, la que venía repetida" '.updated' '1'
body "con un solo error" '.errors | length' '1'
body "señalando la fila 122" '.errors[0].line' '122'
body "y nombrando su SKU" '.errors[0].sku' "$MARCA-MALA"
body "sin abortar el lote por ella" '.created' '120'

# Una fila sin SKU no es una fila mala: es un cuerpo mal formado, y lo rechaza
# el borde entero antes de que el caso de uso vea nada.
req POST /products/import --token "$T_DIEGO" --body "$(jq -nc --arg m "$MARCA" \
  '{rows: [{sku: ($m + "-Z"), name:"Con código"}, {name:"Sin código"}]}')"
problem "una fila sin SKU la rechaza el borde" 400 validation-failed
pointer "señalando la fila que falta" /rows/1/sku
req GET "/products?q=$MARCA-Z&limit=5" --token "$T_DIEGO" --no-cov
body "y no entró ni la buena que la acompañaba" '.data | length' '0'

req GET "/products?q=$MARCA&limit=200" --token "$T_DIEGO" --no-cov
body "y las ciento veinte están en el catálogo" '.data | length' '120'

# ─────────────────────────────────────────────────────────────────────────────
step "2 · el catálogo entero, de cincuenta en cincuenta"

# La regresión de D-67/D-68 a escala de escenario: las 120 filas se escribieron
# en una transacción, así que comparten createdAt hasta el milisegundo.
recorrer_paginas GET "/products?q=$MARCA&sort=createdAt&limit=50" "$T_DIEGO"
ok "se recorre por fecha de alta" 200
paginas_sin_repetidos "sin perder ni repetir una referencia"
TOTAL="$(jq 'length' <<<"$PAGINAS")"
if [[ "$TOTAL" == 120 ]]; then
  pass "las ciento veinte, en tres páginas"
else
  fail "paginando por createdAt salieron $TOTAL de 120"
fi

recorrer_paginas GET "/products?q=$MARCA&sort=sku&limit=37" "$T_DIEGO"
paginas_sin_repetidos "y por SKU tampoco se pierde ninguna"

req GET "/products?q=$MARCA&sort=name&limit=200" --token "$T_DIEGO" --no-cov
N_ASC="$(jqv '[.data[].name] | join("|")')"
req GET "/products?q=$MARCA&sort=-name&limit=200" --token "$T_DIEGO" --no-cov
N_DESC="$(jqv '[.data[].name] | join("|")')"
N_REV="$(jqv '[.data[].name] | reverse | join("|")')"
if [[ "$N_ASC" == "$N_REV" && "$N_ASC" != "$N_DESC" ]]; then
  pass "y pedirlo al revés lo devuelve al revés"
else
  fail "/products no invierte el orden por nombre"
fi

req GET "/products?limit=200&sort=precio" --token "$T_DIEGO"
problem "por un campo que no existe, no se ordena" 400 invalid-filter
req GET "/products?limit=200&color=rojo" --token "$T_DIEGO" --no-cov
problem "ni se filtra por uno inventado" 400 invalid-filter

# ─────────────────────────────────────────────────────────────────────────────
step "3 · el import tiene un techo"

GRANDE="$(jq -nc --arg m "$MARCA" '{rows: [range(1;1002) | {sku: ($m + "-G" + (.|tostring)), name:"X", trackingMode:"QUANTITY", uom:"UNIT"}]}')"
req POST /products/import --token "$T_DIEGO" --body "$GRANDE"
problem "mil una filas son demasiadas" 422 import-too-large
req GET "/products?q=$MARCA-G&limit=5" --token "$T_DIEGO" --no-cov
body "y no entró ninguna" '.data | length' '0'

# ─────────────────────────────────────────────────────────────────────────────
step "4 · los campos propios del proveedor"

req POST /custom-fields --token "$T_DIEGO" \
  --body '{"entity":"PRODUCT","key":"pasillo","label":"Pasillo","type":"SELECT","options":["A","B","C"]}'
ok "se define un campo de selección" 201
CF="$(jqv '.id')"
VER_CF="$(jqv '.version')"

req GET "/custom-fields?entity=PRODUCT" --token "$T_DIEGO"
ok "y aparece en la lista" 200
body "con sus tres opciones" '[.data[] | select(.key=="pasillo")][0].options | length' '3'

req GET "/products?q=$MARCA-1&limit=5" --token "$T_DIEGO" --no-cov
UNO="$(jqv '.data[0].id')"
VER_UNO="$(jqv '.data[0].version')"

req PATCH "/products/$UNO" --token "$T_DIEGO" --if-match "$VER_UNO" --body '{"customFields":{"pasillo":"D"}}'
problem "un valor fuera de la lista no se acepta" 422 invalid-custom-field
req PATCH "/products/$UNO" --token "$T_DIEGO" --if-match "$VER_UNO" --body '{"customFields":{"pasillo":"B"}}'
ok "uno de la lista sí" 200
body "y queda guardado" '.customFields.pasillo' 'B'

req PATCH "/custom-fields/$CF" --token "$T_DIEGO" --if-match "$VER_CF" --body '{"type":"NUMBER"}'
problem "y el tipo de un campo con datos no se cambia" 422 custom-field-type-locked

req GET "/custom-fields?entity=PRODUCT&limit=2" --token "$T_DIEGO" --no-cov
problem "esta colección no pagina, y lo dice (D-60)" 400 invalid-filter

# ─────────────────────────────────────────────────────────────────────────────
step "5 · las fotos del proveedor"

subir_foto F1 "$T_JUAN"
ok "sube una foto" 201
req POST "/products/$UNO/media" --token "$T_JUAN" --body "$(jq -nc --arg k "$F1" '{storageKeys:[$k]}')"
ok "y la engancha al producto" 201
MEDIA="$(jqv '.[0].id')"

req GET "/products/$UNO" --token "$T_JUAN" --no-cov
body "que la lleva" '.media | length' '1'
req DELETE "/products/$UNO/media/$MEDIA" --token "$T_DIEGO"
ok "y se puede quitar" 204

# Un cuerpo JSON que no es el que el endpoint espera es una petición mal
# formada, no un tipo de contenido no soportado: el content-type era correcto.
req POST "/products/$UNO/media" --token "$T_JUAN" --body '{"storageKeys":"no-es-un-array"}'
problem "un cuerpo JSON inválido es una petición inválida" 400 validation-failed

req POST /uploads --token "$T_JUAN" --file "/etc/hostname:text/plain"
problem "un fichero de texto no es una foto" 415 unsupported-media-type

GRANDE_PNG="$TMP/grande.png"
head -c 11000000 /dev/urandom > "$GRANDE_PNG"
req POST /uploads --token "$T_JUAN" --file "$GRANDE_PNG:image/png"
problem "y once megas no caben" 413 media-too-large

# ─────────────────────────────────────────────────────────────────────────────
step "6 · los códigos de barras"

req POST "/products/$UNO/codes" --token "$T_DIEGO" --body "$(jq -nc --arg v "$MARCA-EAN" '{value:$v, kind:"EAN"}')"
ok "la referencia gana su código" 201
COD="$(jqv '.id')"
req POST "/products/$UNO/codes" --token "$T_DIEGO" --body "$(jq -nc --arg v "$MARCA-EAN" '{value:$v, kind:"EAN"}')"
problem "y el mismo código no vale para dos" 409 code-taken

req GET "/products/$UNO/codes" --token "$T_DIEGO"
ok "los códigos del producto se listan" 200
body "y está el nuestro" "[.[] | select(.value==\"$MARCA-EAN\")] | length" '1'

req GET "/codes/$MARCA-EAN/resolve" --token "$T_JUAN" --no-cov
ok "el escáner lo resuelve" 200
req DELETE "/products/$UNO/codes/$COD" --token "$T_DIEGO"
ok "se le quita la etiqueta" 204
req GET "/codes/$MARCA-EAN/resolve" --token "$T_JUAN" --no-cov
problem "y deja de resolver" 404 code-not-found

# ─────────────────────────────────────────────────────────────────────────────
step "7 · se recibe una parte del pedido: todo o nada"

recorrer_paginas GET "/products?q=$MARCA&sort=sku&limit=100" "$T_DIEGO"
VEINTICINCO="$(jq -c '[.[0:25][].id]' <<<"$PAGINAS")"

BUENAS="$(jq -nc --argjson ids "$VEINTICINCO" --arg o "$OPENING" --arg b "$B2" --arg t "$(ahora)" \
  '{movements: [$ids[] | {productId:., fromNodeId:$o, toNodeId:$b, quantity:"10.000", occurredAt:$t}]}')"
req POST /movements/batch --token "$T_JUAN" --body "$BUENAS"
ok "veinticinco referencias entran de un tirón" 201
body "los veinticinco asientos" '.movements | length' '25'

# La misma remesa, con una línea imposible en medio.
CON_MALA="$(jq -nc --argjson ids "$VEINTICINCO" --arg o "$OPENING" --arg b "$B3" --arg t "$(ahora)" \
  '{movements: ([$ids[] | {productId:., fromNodeId:$o, toNodeId:$b, quantity:"5.000", occurredAt:$t}]
                | .[12].quantity = "0")}')"
ANTES="$(saldo "$T_JUAN" "$B3" "$(jq -r '.[0]' <<<"$VEINTICINCO")")"
req POST /movements/batch --token "$T_JUAN" --body "$CON_MALA"
problem "una línea imposible tumba el lote entero" 422 non-positive-quantity
DESPUES="$(saldo "$T_JUAN" "$B3" "$(jq -r '.[0]' <<<"$VEINTICINCO")")"
if [[ "$ANTES" == "$DESPUES" && "$DESPUES" == 0 ]]; then
  pass "y no entró ni una sola de las veinticinco"
else
  fail "el lote dejó rastro: B3 pasó de $ANTES a $DESPUES milésimas"
fi

# ─────────────────────────────────────────────────────────────────────────────
step "8 · el cierre"

P1="$(jq -r '.[0]' <<<"$VEINTICINCO")"
P2="$(jq -r '.[1]' <<<"$VEINTICINCO")"
arqueo "$T_JUAN" "$P1:la primera importada" "$P2:la segunda importada" "$P_TOR:TOR-M8"

printf '\n  organización de esta corrida: %s\n' "$SLUG"
resumen catalogo-masivo
