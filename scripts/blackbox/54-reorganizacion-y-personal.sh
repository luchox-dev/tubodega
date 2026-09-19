#!/usr/bin/env bash
# ═════════════════════════════════════════════════════════════════════════════
# «Se muda la zona y entra gente nueva»
#
# Dos cosas que pasan en toda bodega y que tocan sitios muy distintos: se
# reorganiza el árbol de ubicaciones (y el saldo NO se muda con él: el estante
# cambia de sitio, la mercancía sigue en el estante), y cambia el personal.
#
# Y la comprobación que importa por encima de todas: dos organizaciones en la
# misma base no se ven. No con un 403, que ya confesaría que el recurso existe,
# sino con un 404.
# ═════════════════════════════════════════════════════════════════════════════
set -uo pipefail
AQUI="$(dirname "${BASH_SOURCE[0]}")"
source "$AQUI/lib.sh"
source "$AQUI/mundo.sh"

exigir_servidor
montar_mundo mudanza

# ─────────────────────────────────────────────────────────────────────────────
step "1 · hay mercancía en los estantes"

req POST /movements/batch --token "$T_JUAN" --body "$(jq -nc \
  --arg tor "$P_TOR" --arg o "$OPENING" --arg b2 "$B2" --arg b3 "$B3" --arg t "$(ahora)" '
  { movements: [
      {productId:$tor, fromNodeId:$o, toNodeId:$b2, quantity:"200.000", occurredAt:$t},
      {productId:$tor, fromNodeId:$o, toNodeId:$b3, quantity:"50.000",  occurredAt:$t}
  ]}')"
ok "doscientos cincuenta tornillos entre B2 y B3" 201

nodo_de Z2 "$T_DIEGO" Z2 "$BODA"
ok "y se abre una zona nueva" 201

req GET "/stock?under=$Z1&productId=$P_TOR" --token "$T_JUAN" --no-cov
cantidad "Z1 agrega los 250" '[.data[].quantity | tonumber] | add | tostring' '250.000'
req GET "/stock?under=$Z2&productId=$P_TOR" --token "$T_JUAN" --no-cov
body "y Z2 está vacía" '.data | length' '0'

# ─────────────────────────────────────────────────────────────────────────────
step "2 · el estante se muda de zona"

req GET "/nodes/$E3" --token "$T_DIEGO"
ok "se lee el estante" 200
body "colgando de Z1" '.path' 'BOD-A/Z1/E3'
VER_E3="$(jqv '.version')"

req POST "/nodes/$E3/move" --token "$T_DIEGO" --if-match "$VER_E3" \
  --body "$(jq -nc --arg p "$Z2" '{parentId:$p}')"
ok "y se muda a Z2" 200
body "con el path reescrito" '.path' 'BOD-A/Z2/E3'

req GET "/nodes/$B2" --token "$T_DIEGO" --no-cov
body "y el de la bandeja también, que colgaba debajo" '.path' 'BOD-A/Z2/E3/B2'
req GET "/nodes/$B3" --token "$T_DIEGO" --no-cov
body "y el de la otra" '.path' 'BOD-A/Z2/E3/B3'

# La mercancía no se muda: el estante cambió de sitio, los tornillos siguen
# donde estaban.
saldo_es "los tornillos de B2 no se movieron" "$T_JUAN" "$B2" "$P_TOR" '200.000'

# Pero el agregado por subárbol sí cambia de dueño, y la suma es constante.
req GET "/stock?under=$Z1&productId=$P_TOR" --token "$T_JUAN" --no-cov
body "Z1 se queda sin nada" '.data | length' '0'
req GET "/stock?under=$Z2&productId=$P_TOR" --token "$T_JUAN" --no-cov
cantidad "y Z2 hereda los 250 enteros" '[.data[].quantity | tonumber] | add | tostring' '250.000'

# ─────────────────────────────────────────────────────────────────────────────
step "3 · lo que una mudanza no puede hacer"

req GET "/nodes/$Z2" --token "$T_DIEGO" --no-cov
VER_Z2="$(jqv '.version')"
req POST "/nodes/$Z2/move" --token "$T_DIEGO" --if-match "$VER_Z2" \
  --body "$(jq -nc --arg p "$E3" '{parentId:$p}')"
problem "colgar una zona de su propio nieto, no (I-10)" 422 node-cycle
req GET "/nodes/$E3" --token "$T_DIEGO" --no-cov
body "y el árbol no se tocó" '.path' 'BOD-A/Z2/E3'

req GET "/nodes/$E3" --token "$T_DIEGO" --no-cov
VER_E3B="$(jqv '.version')"
req POST "/nodes/$E3/move" --token "$T_DIEGO" --if-match "$((VER_E3B - 1))" \
  --body "$(jq -nc --arg p "$Z1" '{parentId:$p}')"
problem "ni mudarlo con una versión vieja" 409 stale-version

req POST "/nodes/$E3/move" --token "$T_DIEGO" --body "$(jq -nc --arg p "$Z1" '{parentId:$p}')"
problem "ni sin decir qué versión se vio" 400 missing-if-match

req DELETE "/nodes/$B2" --token "$T_DIEGO"
problem "y no se retira un estante con mercancía dentro" 422 node-has-stock
req GET "/nodes/$B2" --token "$T_DIEGO" --no-cov
body "que sigue activo" '.active' 'true'

req DELETE "/nodes/$Z1" --token "$T_DIEGO" --no-cov
ok "la zona que quedó vacía sí se retira" 204
req GET "/nodes/$Z1" --token "$T_DIEGO" --no-cov
body "y queda inactiva" '.active' 'false'

req POST /movements --token "$T_JUAN" --body "$(jq -nc \
  --arg p "$P_TOR" --arg f "$B2" --arg t "$Z1" --arg o "$(ahora)" \
  '{productId:$p, fromNodeId:$f, toNodeId:$t, quantity:"1.000", occurredAt:$o}')"
problem "y a un nodo retirado no entra nada (I-16)" 422 node-inactive

# ─────────────────────────────────────────────────────────────────────────────
step "4 · entra gente nueva y sale gente vieja"

req POST /users --token "$T_OWNER" --body "$(jq -nc --arg e "ana-$SLUG@esquina.co" --arg p "$PASSWORD" \
  '{email:$e, name:"Ana", password:$p, roles:["OPERATOR"]}')"
ok "entra Ana como operaria" 201
ANA="$(jqv '.id')"
VER_ANA="$(jqv '.version')"

req GET "/users?role=OPERATOR&limit=50" --token "$T_OWNER"
ok "y aparece en la plantilla" 200
body "con Juan" '[.data[] | select(.name=="Ana" or .name=="juan")] | length' '2'

req PATCH "/users/$ANA" --token "$T_OWNER" --if-match "$VER_ANA" --body '{"roles":["ADMIN"]}'
ok "la ascienden a administradora" 200
body "y el rol cambió" '.roles[0]' 'ADMIN'
NUEVA_VER="$(jqv '.version')"

req PATCH "/users/$ANA" --token "$T_OWNER" --if-match "$VER_ANA" --body '{"roles":["VIEWER"]}'
problem "con la versión vieja, no" 409 stale-version

req PATCH "/users/$ANA" --token "$T_OWNER" --body '{"roles":["VIEWER"]}'
problem "y sin decir qué versión se vio, tampoco" 400 missing-if-match

req POST /auth/login --idem none --body "$(jq -nc --arg e "ana-$SLUG@esquina.co" --arg p "$PASSWORD" --arg s "$SLUG" \
  '{email:$e, password:$p, slug:$s}')"
ok "Ana entra" 200
T_ANA="$(jqv '.accessToken')"
R_ANA="$(jqv '.refreshToken')"

req POST /me/password --token "$T_ANA" --body "$(jq -nc --arg c "$PASSWORD" '{current:$c, next:"otracontrasena9!"}')"
ok "y cambia su contraseña" 204

req POST /auth/login --idem none --body "$(jq -nc --arg e "ana-$SLUG@esquina.co" --arg p "$PASSWORD" --arg s "$SLUG" \
  '{email:$e, password:$p, slug:$s}')"
problem "la vieja ya no abre" 401 invalid-credentials
req POST /auth/login --idem none --body "$(jq -nc --arg e "ana-$SLUG@esquina.co" --arg s "$SLUG" \
  '{email:$e, password:"otracontrasena9!", slug:$s}')"
ok "la nueva sí" 200
T_ANA="$(jqv '.accessToken')"
R_ANA="$(jqv '.refreshToken')"

req POST /auth/refresh --idem none --body "$(jq -nc --arg r "$R_ANA" '{refreshToken:$r}')"
ok "y su sesión se renueva" 200
R_ANA2="$(jqv '.refreshToken')"
req POST /auth/refresh --idem none --body "$(jq -nc --arg r "$R_ANA" '{refreshToken:$r}')"
problem "el refresh viejo ya no vale: es de un solo uso" 401 refresh-token-invalid

req POST /auth/logout --token "$T_ANA" --body "$(jq -nc --arg r "$R_ANA2" '{refreshToken:$r}')"
ok "Ana cierra sesión" 204

req DELETE "/users/$ANA" --token "$T_OWNER"
ok "y se le da de baja" 204
req GET /me --token "$T_ANA"
problem "su token deja de abrir en el acto" 401 invalid-credentials

req GET /users --token "$T_OWNER" --no-cov
body "y no queda en la plantilla activa" '[.data[] | select(.name=="Ana" and .active==true)] | length' '0'

req GET /users --token "$T_JUAN"
problem "un operario no administra personal" 403 insufficient-role

# La casa no se queda sin dueño.
req GET /me --token "$T_OWNER" --no-cov
MARTA_ID="$(jqv '.user.id')"
req GET "/users/$MARTA_ID" --token "$T_OWNER"
ok "Marta es la única dueña" 200
VER_MARTA="$(jqv '.version')"
req PATCH "/users/$MARTA_ID" --token "$T_OWNER" --if-match "$VER_MARTA" --body '{"roles":["VIEWER"]}'
problem "y la organización no se queda sin dueño" 422 last-owner

# ─────────────────────────────────────────────────────────────────────────────
step "5 · la vecina de al lado no ve nada de esto"

VSLUG="vecina-$(date +%s)-$RANDOM"
VMAIL="rosa-$VSLUG@vecina.co"
req POST /organizations --idem none --body "$(jq -nc --arg s "$VSLUG" --arg e "$VMAIL" --arg p "$PASSWORD" \
  '{name:"Abarrotes La Vecina", slug:$s, owner:{email:$e, name:"Rosa", password:$p}}')"
ok "Rosa abre su propia tienda" 201
req POST /auth/login --idem none --body "$(jq -nc --arg e "$VMAIL" --arg p "$PASSWORD" --arg s "$VSLUG" \
  '{email:$e, password:$p, slug:$s}')"
T_ROSA="$(jqv '.accessToken')"

# 404 y no 403: un 403 confesaría que el recurso existe, y eso ya es una fuga.
req GET "/nodes/$B2" --token "$T_ROSA"
problem "el estante de la otra no existe para ella" 404 not-found
req GET "/products/$P_TOR" --token "$T_ROSA"
problem "ni su tornillo" 404 not-found
req GET "/users/$MARTA_ID" --token "$T_ROSA"
problem "ni su dueña" 404 not-found

req GET "/movements?productId=$P_TOR&limit=50" --token "$T_ROSA" --no-cov
body "su histórico está vacío" '.data | length' '0'
req GET "/stock?nonZeroOnly=false&limit=50" --token "$T_ROSA" --no-cov
body "y su bodega también" '.data | length' '0'
req GET "/nodes?limit=50" --token "$T_ROSA" --no-cov
body "salvo las ocho fronteras que le sembraron a ella" '[.data[] | select(.kind=="SOURCE" or .kind=="TERMINAL")] | length' '8'

req POST /movements --token "$T_ROSA" --body "$(jq -nc \
  --arg p "$P_TOR" --arg f "$B2" --arg t "$B3" --arg o "$(ahora)" \
  '{productId:$p, fromNodeId:$f, toNodeId:$t, quantity:"1.000", occurredAt:$o}')"
problem "y no puede mover mercancía ajena" 404 not-found
saldo_es "que sigue donde estaba" "$T_JUAN" "$B2" "$P_TOR" '200.000'

# ─────────────────────────────────────────────────────────────────────────────
step "6 · el cierre, de las dos casas por separado"

arqueo "$T_JUAN" "$P_TOR:TOR-M8"
reconciliar_custodias "$T_ROSA"

printf '\n  organizaciones de esta corrida: %s · %s\n' "$SLUG" "$VSLUG"
resumen reorganizacion-y-personal
