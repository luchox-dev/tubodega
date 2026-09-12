#!/usr/bin/env bash
# Caja negra · WAVE 2 — «las ubicaciones». Diego (ADMIN) dibuja el árbol de la
# bodega, lo reorganiza y retira un bin; Juan (OPERATOR) comprueba que no puede
# tocarlo. Los casos 12-15 de la tabla «E2E WAVE 2» del plan maestro.
#
# Las siete operaciones de nodos, cada una con su camino feliz y el de error,
# que es lo que exige el cruce de cobertura de spec 06 §6.
#
# Se invoca solo o a través de ./scripts/blackbox.sh.
set -uo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

SLUG="ubicaciones-$(date +%s)-$RANDOM"

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

# ─────────────────────────────────────────────────────────────────────────────
step "2 · la frontera ya estaba, y nadie la creó"
# Los ocho nodos de spec 04 §6 los siembra el provisioner dentro de la
# transacción que da de alta la organización. Si faltaran, la partida doble de
# la WAVE 3 no tendría contra qué asentar.
req GET "/nodes?kind=SOURCE" --token "$T_DIEGO"
ok "lista las fuentes" 200
body "tres fuentes sembradas" '.data | length' 3
body "la del proveedor por defecto está" '[.data[].code] | index("supplier-default") != null' true
body "y es raíz: su path es su código" '[.data[] | select(.code=="supplier-default")][0].path' 'supplier-default'

req GET "/nodes?kind=TERMINAL" --token "$T_DIEGO"
body "cinco sumideros sembrados" '.data | length' 5

req GET "/nodes?limit=200" --token "$T_DIEGO"
body "ocho en total, y ni uno más" '.data | length' 8

# El filtro no declarado se rechaza en el borde (spec 03 §8).
req GET "/nodes?color=azul" --token "$T_DIEGO"
problem "un filtro que nadie declaró" 400 invalid-filter

# ─────────────────────────────────────────────────────────────────────────────
step "3 · Diego dibuja la bodega"
# El id sale por referencia y no por stdout, como `alta` en lib.sh: por stdout
# va el informe, y una sustitución de comando se lo tragaría entero junto con
# el id — que es justo lo que pasó la primera vez que se escribió esto.
nodo() { # nodo <variable destino> <código> [idPadre]
  local -n out="$1"
  local code="$2" parent="${3:-}"
  if [[ -n "$parent" ]]; then
    req POST /nodes --token "$T_DIEGO" --body "$(jq -nc --arg c "$code" --arg p "$parent" \
      '{kind:"INTERNAL", code:$c, name:$c, parentId:$p}')"
  else
    req POST /nodes --token "$T_DIEGO" --body "$(jq -nc --arg c "$code" '{kind:"INTERNAL", code:$c, name:$c}')"
  fi
  ok "crea $code" 201
  out="$(jqv '.id')"
}

nodo N_BODA BOD-A
nodo N_MUELLE MUELLE "$N_BODA"
nodo N_Z1 Z1 "$N_BODA"
nodo N_E3 E3 "$N_Z1"
nodo N_B2 B2 "$N_E3"
nodo N_B3 B3 "$N_E3"
nodo N_BODB BOD-B
nodo N_Z2 Z2 "$N_BODB"

req GET "/nodes/$N_B2" --token "$T_DIEGO"
ok "lee un bin por id" 200
body "el path es la cadena entera" '.path' 'BOD-A/Z1/E3/B2'
body "y nace en la versión 1" '.version' 1

# El código es único por organización, no por padre: el escáner no sabe bajo qué
# bodega está.
req POST /nodes --token "$T_DIEGO" --body "$(jq -nc '{kind:"INTERNAL", code:"B2", name:"Otro B2"}')"
problem "repetir un código choca" 409 node-code-taken

req GET "/nodes/018f0000-0000-7000-8000-00000000dead" --token "$T_DIEGO"
problem "un nodo que no existe" 404 not-found

# ─────────────────────────────────────────────────────────────────────────────
step "4 · el árbol, anidado (D-11)"
req GET "/nodes/$N_BODA/tree" --token "$T_DIEGO"
ok "el subárbol de BOD-A" 200
body "cuelga MUELLE y Z1" '[.children[].node.code] | sort | join(",")' 'MUELLE,Z1'
body "y por debajo, E3" '[.children[] | select(.node.code=="Z1")][0].children[0].node.code' 'E3'
body "y los dos bins" '[[.children[] | select(.node.code=="Z1")][0].children[0].children[].node.code] | sort | join(",")' 'B2,B3'
body "una hoja no tiene hijos" '[[.children[] | select(.node.code=="Z1")][0].children[0].children[] | select(.node.code=="B2")][0].children | length' 0

req GET "/nodes/018f0000-0000-7000-8000-00000000dead/tree" --token "$T_DIEGO"
problem "el árbol de un nodo que no existe" 404 not-found

# El listado por subárbol da lo mismo en plano, y es estricto.
req GET "/nodes?under=$N_Z1" --token "$T_DIEGO"
ok "el subárbol de Z1, en plano" 200
body "tres descendientes, sin incluirse a sí misma" '[.data[].code] | sort | join(",")' 'B2,B3,E3'

# Un `under` que no nombra a nadie es un filtro malo — no un 404, que diría que
# /v1/nodes se esfumó, ni una página vacía, que escondería el error de tecleo.
req GET "/nodes?under=018f0000-0000-7000-8000-00000000dead" --token "$T_DIEGO"
problem "un under que no existe" 400 invalid-filter
pointer "y señala el filtro que falla" '/under'

# ─────────────────────────────────────────────────────────────────────────────
step "5 · reorganizar mueve el subárbol entero (N-1, N-2)"
# Mientras B2 cuelga de Z1, colgar Z1 de B2 cerraría el árbol sobre sí mismo.
req POST "/nodes/$N_Z1/move" --token "$T_DIEGO" --if-match 1 --body "$(jq -nc --arg p "$N_B2" '{parentId:$p}')"
problem "un ciclo a tres niveles" 422 node-cycle

req POST "/nodes/$N_E3/move" --token "$T_DIEGO" --if-match 1 --body "$(jq -nc --arg p "$N_Z2" '{parentId:$p}')"
ok "mueve E3 bajo Z2" 200
body "E3 tiene el path nuevo" '.path' 'BOD-B/Z2/E3'

# Lo que prueba N-2: nadie tocó B2 ni B3, y los dos se movieron.
req GET "/nodes/$N_B2" --token "$T_DIEGO"
body "B2 se movió con su padre" '.path' 'BOD-B/Z2/E3/B2'
req GET "/nodes/$N_B3" --token "$T_DIEGO"
body "y B3 también" '.path' 'BOD-B/Z2/E3/B3'

req POST "/nodes/$N_E3/move" --token "$T_DIEGO" --if-match 1 --body "$(jq -nc --arg p "$N_Z2" '{parentId:$p}')"
problem "con la versión vieja, conflicto" 409 stale-version

# ─────────────────────────────────────────────────────────────────────────────
step "6 · las reglas del árbol (I-10)"
req POST /nodes --token "$T_DIEGO" --body "$(jq -nc --arg p "$N_Z1" '{kind:"CUSTODY", code:"juan", name:"Juan", parentId:$p}')"
problem "un tenedor no cuelga de una zona" 422 parent-not-internal

req POST /nodes --token "$T_DIEGO" --body "$(jq -nc '{kind:"CUSTODY", code:"juan", name:"Juan"}')"
ok "pero sí existe por su cuenta" 201
N_JUAN="$(jqv '.id')"
body "y es raíz" '.path' 'juan'

req POST /nodes --token "$T_DIEGO" --body "$(jq -nc '{kind:"INTERNAL", code:"X", name:"X", parentId:"018f0000-0000-7000-8000-00000000dead"}')"
problem "un padre que no existe" 422 parent-not-found

# ─────────────────────────────────────────────────────────────────────────────
step "7 · renombrar, con control de versión"
req GET "/nodes/$N_B2" --token "$T_DIEGO"
V_B2="$(jqv '.version')"
req PATCH "/nodes/$N_B2" --token "$T_DIEGO" --if-match "$V_B2" --body '{"name":"Bin 2 · refrigerado"}'
ok "cambia el nombre" 200
body "y lo devuelve cambiado" '.name' 'Bin 2 · refrigerado'

req PATCH "/nodes/$N_B2" --token "$T_DIEGO" --if-match "$V_B2" --body '{"name":"Otro"}'
problem "repetir la versión es un conflicto" 409 stale-version

# El tipo no se cambia, y decirlo en voz alta es un 400: si el borde lo borrara
# en silencio, el cliente recibiría un 200 que no cambió nada.
req GET "/nodes/$N_B2" --token "$T_DIEGO"
V_B2="$(jqv '.version')"
req PATCH "/nodes/$N_B2" --token "$T_DIEGO" --if-match "$V_B2" --body '{"kind":"CUSTODY"}'
problem "el tipo de un nodo no se cambia" 400 validation-failed
pointer "y el error señala /kind" '/kind'

req PATCH "/nodes/$N_B2" --token "$T_DIEGO" --if-match "$V_B2" --body '{"code":"B9"}'
problem "el código tampoco" 400 validation-failed
pointer "y señala /code" '/code'

# ─────────────────────────────────────────────────────────────────────────────
step "8 · retirar un nodo"
req DELETE "/nodes/$N_B3" --token "$T_DIEGO"
ok "retira un bin vacío" 204
req GET "/nodes/$N_B3" --token "$T_DIEGO"
body "queda inactivo, no borrado" '.active' false

# Ni cascada ni silencio: un estante activo bajo una zona retirada seguiría
# admitiendo mercancía (D-30).
req DELETE "/nodes/$N_E3" --token "$T_DIEGO"
problem "una zona con estantes activos, no" 422 node-has-children

# ─────────────────────────────────────────────────────────────────────────────
step "9 · Juan mira pero no toca"
req GET "/nodes?limit=200" --token "$T_JUAN"
ok "un OPERATOR sí lee la bodega" 200

req POST /nodes --token "$T_JUAN" --body "$(jq -nc '{kind:"INTERNAL", code:"PIRATA", name:"Pirata"}')"
problem "pero no la dibuja" 403 insufficient-role

req PATCH "/nodes/$N_B2" --token "$T_JUAN" --if-match 1 --body '{"name":"Mío"}'
problem "ni la renombra" 403 insufficient-role

req POST "/nodes/$N_B2/move" --token "$T_JUAN" --if-match 1 --body "$(jq -nc --arg p "$N_BODA" '{parentId:$p}')"
problem "ni la reorganiza" 403 insufficient-role

req DELETE "/nodes/$N_JUAN" --token "$T_JUAN"
problem "ni retira nada" 403 insufficient-role

# ─────────────────────────────────────────────────────────────────────────────
step "10 · la bodega de al lado no se ve (I-6)"
OTRO="otra-$SLUG"
req POST /organizations --idem none --body "$(jq -nc --arg s "$OTRO" --arg e "ana-$OTRO@otra.co" --arg p "$PASSWORD" \
  '{name:"Otra", slug:$s, owner:{email:$e, name:"Ana", password:$p}}')"
ok "otra empresa se registra" 201
req POST /auth/login --idem none --body "$(jq -nc --arg e "ana-$OTRO@otra.co" --arg p "$PASSWORD" --arg s "$OTRO" \
  '{email:$e, password:$p, slug:$s}')"
ok "Ana inicia sesión" 200
T_ANA="$(jqv '.accessToken')"

req GET "/nodes/$N_B2" --token "$T_ANA"
problem "un nodo ajeno: 404, nunca 403" 404 not-found
req GET "/nodes/$N_B2/tree" --token "$T_ANA"
problem "su árbol tampoco" 404 not-found
req DELETE "/nodes/$N_B2" --token "$T_ANA"
problem "ni se retira desde fuera" 404 not-found
req POST "/nodes/$N_B2/move" --token "$T_ANA" --if-match 1 --body "$(jq -nc --arg p "$N_BODA" '{parentId:$p}')"
problem "ni se mueve desde fuera" 404 not-found

req GET "/nodes?limit=200" --token "$T_ANA"
body "ella tiene sus ocho, y solo los suyos" '.data | length' 8

# Y «Z1» está libre para ella: el código es único por organización.
req POST /nodes --token "$T_ANA" --body "$(jq -nc '{kind:"INTERNAL", code:"Z1", name:"Su zona"}')"
ok "el mismo código, en otra empresa, entra" 201

resumen ubicaciones
