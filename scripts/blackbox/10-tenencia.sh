#!/usr/bin/env bash
# Caja negra · WAVE 1 — «abrir el negocio». Marta registra «Distribuidora La
# Esquina», da de alta a Diego, Juan y Sofía, y el sistema demuestra sus
# garantías transversales: quién puede qué, qué pasa al revocar un acceso, y que
# una organización no ve a la de al lado. Los quince casos de la tabla «E2E
# WAVE 1» del plan maestro.
#
# Se invoca solo o a través de ./scripts/blackbox.sh.
set -uo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

SLUG="tenencia-$(date +%s)-$RANDOM"
MARTA="marta-$SLUG@esquina.co"
UUID_RE='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'

exigir_servidor

# ─────────────────────────────────────────────────────────────────────────────
step "1 · Marta registra el negocio"
# El correo va en mayúsculas a propósito: el dominio lo normaliza, y que lo haga
# es parte del contrato.
req POST /organizations --idem none --body "$(jq -nc --arg s "$SLUG" --arg e "Marta-$SLUG@Esquina.co" --arg p "$PASSWORD" \
  '{name:"Distribuidora La Esquina", slug:$s, owner:{email:$e, name:"Marta", password:$p}}')"
ok "queda registrada" 201
ORG_ID="$(jqv '.organization.id')"
header "y dice dónde quedó" location "/v1/organizations/$ORG_ID"
header "con su traza" x-request-id "~$UUID_RE"
body "la organización lleva el nombre y el slug que se pidieron" \
  '"\(.organization.name)/\(.organization.slug)"' "Distribuidora La Esquina/$SLUG"
body "el correo del dueño vuelve en minúsculas" '.owner.email' "$MARTA"
body "nace como OWNER y activo" '"\(.owner.roles | join(","))/\(.owner.active)"' 'OWNER/true'
body "y el hash de la contraseña no sale por el cable" '.owner | has("passwordHash")' 'false'

req POST /organizations --idem none --body "$(jq -nc --arg s "$SLUG" --arg p "$PASSWORD" \
  '{name:"Otra", slug:$s, owner:{email:"x@y.co", name:"X", password:$p}}')"
problem "el mismo slug otra vez" 409 slug-taken
body "y el problem dice sobre qué recurso" '.instance' '/v1/organizations'

req POST /organizations --idem none \
  --body '{"name":"X","slug":"La Esquina","owner":{"email":"a@b.co","name":"A"}}'
problem "un cuerpo incompleto" 400 validation-failed
pointer "señalando la contraseña que falta" /owner/password

# ─────────────────────────────────────────────────────────────────────────────
step "2 · Marta inicia sesión y ve su perfil"
req POST /auth/login --idem none --body "$(jq -nc --arg e "MARTA-$SLUG@ESQUINA.CO" --arg p "$PASSWORD" \
  '{email:$e, password:$p}')"
ok "el correo en mayúsculas sirve igual" 200
body "el token dura quince minutos" '.expiresIn' 900
body "y viene con quién es" '"\(.user.email)/\(.user.roles | join(","))"' "$MARTA/OWNER"
T_MARTA="$(jqv '.accessToken')"
RT_MARTA="$(jqv '.refreshToken')"

req GET /me --token "$T_MARTA"
ok "su perfil" 200
body "es ella" '.user.email' "$MARTA"
body "y es su empresa" '"\(.organization.id)/\(.organization.slug)"' "$ORG_ID/$SLUG"

req POST /auth/login --idem none --body "$(jq -nc --arg e "$MARTA" '{email:$e, password:"nope-nope-nope"}')"
problem "con la contraseña cambiada" 401 invalid-credentials
DETALLE_MALA="$(jqv '.detail')"
req POST /auth/login --idem none --body "$(jq -nc --arg p "$PASSWORD" '{email:"nadie@esquina.co", password:$p}')"
problem "con un correo que no existe" 401 invalid-credentials
# Si los dos mensajes se distinguieran, el login sería un oráculo de qué correos
# están dados de alta.
body "y el mensaje es el mismo: no se enumeran usuarios" ".detail == \"$DETALLE_MALA\"" 'true'

req GET /me
problem "sin token no se ve nada" 401 invalid-credentials
req GET /me --token 'firma-inventada'
problem "ni con una firma inventada" 401 invalid-credentials

# El único caso que no se puede probar a ciegas: hace falta el secreto de firma
# del servidor, o esperar quince minutos. Si el entorno lo trae, se prueba.
if [[ -n "${JWT_SECRET:-}" ]] && command -v openssl >/dev/null; then
  b64u() { openssl base64 -A | tr '+/' '-_' | tr -d '='; }
  MARTA_ID="$(req GET /me --token "$T_MARTA" --no-cov; jqv '.user.id')"
  AYER=$(( $(date +%s) - 3600 ))
  JH="$(printf '{"alg":"HS256","typ":"JWT"}' | b64u)"
  JP="$(jq -nc --arg s "$MARTA_ID" --arg o "$ORG_ID" --argjson i $((AYER - 900)) --argjson e "$AYER" \
        '{sub:$s, org:$o, roles:["OWNER"], iat:$i, exp:$e}' | b64u)"
  JS="$(printf '%s.%s' "$JH" "$JP" | openssl dgst -sha256 -hmac "$JWT_SECRET" -binary | b64u)"
  req GET /me --token "$JH.$JP.$JS"
  problem "y un token caducado se distingue de uno inválido" 401 token-expired
else
  skip "token caducado: exporta JWT_SECRET para probarlo (es la grieta de la caja negra)"
fi

# ─────────────────────────────────────────────────────────────────────────────
step "3 · Marta da de alta al equipo"
T_OWNER="$T_MARTA"
req POST /users --token "$T_MARTA" --body "$(jq -nc --arg e "diego-$SLUG@esquina.co" --arg p "$PASSWORD" \
  '{email:$e, name:"diego", password:$p, roles:["ADMIN"]}')"
ok "Diego, administrador" 201
DIEGO_ID="$(jqv '.id')"
header "y dice dónde quedó" location "/v1/users/$DIEGO_ID"
body "con su rol y activo" '"\(.roles | join(","))/\(.active)"' 'ADMIN/true'
body "y sin el hash de la contraseña" 'has("passwordHash")' 'false'
req POST /auth/login --idem none --body "$(jq -nc --arg e "diego-$SLUG@esquina.co" --arg p "$PASSWORD" --arg s "$SLUG" \
  '{email:$e, password:$p, slug:$s}')"
ok "Diego inicia sesión" 200
T_DIEGO="$(jqv '.accessToken')"

alta T_JUAN OPERATOR juan
alta T_SOFIA VIEWER sofia

req GET "/users?role=OPERATOR" --token "$T_MARTA"
ok "el listado filtra por rol" 200
body "y solo sale Juan" '[.data[].name] | join(",")' 'juan'

req GET "/users?sort=name" --token "$T_MARTA"
body "ordenado por nombre, están los cuatro" '[.data[].name] | join(",")' 'Marta,diego,juan,sofia'
body "y la página dice que no hay más" '.page | tojson' '{"hasMore":false}'

req GET "/users?foo=1" --token "$T_MARTA"
problem "un filtro que nadie declaró" 400 invalid-filter
pointer "y lo nombra" /foo
req GET "/users?limit=0" --token "$T_MARTA"
problem "un límite fuera de rango" 400 invalid-filter
pointer "también" /limit

req POST /users --token "$T_MARTA" --body "$(jq -nc --arg e "juan-$SLUG@esquina.co" --arg p "$PASSWORD" \
  '{email:$e, name:"Otro Juan", password:$p, roles:["VIEWER"]}')"
problem "el mismo correo dos veces en la misma empresa" 409 email-taken

# ─────────────────────────────────────────────────────────────────────────────
step "4 · Sofía (VIEWER) intenta administrar"
req POST /users --token "$T_SOFIA" --body "$(jq -nc --arg e "colado-$SLUG@esquina.co" --arg p "$PASSWORD" \
  '{email:$e, name:"Colado", password:$p, roles:["OWNER"]}')"
problem "y no puede" 403 insufficient-role

# ─────────────────────────────────────────────────────────────────────────────
step "5 · Diego cambia roles con control de versión"
req GET /me --token "$T_JUAN"; JUAN_ID="$(jqv '.user.id')"
req GET "/users/$JUAN_ID" --token "$T_DIEGO"
ok "Diego mira la ficha de Juan" 200

req GET "/users/$JUAN_ID" --token "$T_DIEGO"
body "la ficha trae la versión, que es lo que se manda en If-Match" '.version' '1'

req PATCH "/users/$JUAN_ID" --token "$T_DIEGO" --if-match 1 --body '{"roles":["OPERATOR","ADMIN"]}'
ok "le añade ADMIN con el If-Match que toca" 200
body "y quedan los dos roles" '[.roles] | flatten | sort | join(",")' 'ADMIN,OPERATOR'
# D-31 · la versión que vuelve es la que quedó en la fila, así que encadena
# la siguiente edición sin releer al usuario.
body "y devuelve la versión ya incrementada" '.version' '2'
V_JUAN="$(jqv '.version')"

req PATCH "/users/$JUAN_ID" --token "$T_DIEGO" --if-match 1 --body '{"roles":["VIEWER"]}'
problem "con la versión vieja, no" 409 stale-version
req PATCH "/users/$JUAN_ID" --token "$T_DIEGO" --body '{"roles":["VIEWER"]}'
problem "y sin la cabecera, tampoco" 400 missing-if-match

# El contrato acepta la forma débil del ETag, y conviene que se note.
req PATCH "/users/$JUAN_ID" --token "$T_DIEGO" --if-match-raw "W/\"$V_JUAN\"" --body '{"roles":["OPERATOR"]}'
ok "un ETag débil vale igual que uno fuerte" 200

# ─────────────────────────────────────────────────────────────────────────────
step "6 · nadie deja la empresa sin dueño"
req GET /me --token "$T_MARTA"; MARTA_ID="$(jqv '.user.id')"
req DELETE "/users/$MARTA_ID" --token "$T_DIEGO"
problem "al último OWNER no se le retira el acceso" 422 last-owner

# ─────────────────────────────────────────────────────────────────────────────
step "7 · se revoca un acceso, y surte efecto de inmediato (T-6)"
req GET /me --token "$T_SOFIA"; SOFIA_ID="$(jqv '.user.id')"
req DELETE "/users/$SOFIA_ID" --token "$T_DIEGO"
ok "Sofía deja la empresa" 204
# El token de Sofía sigue siendo criptográficamente válido; lo que ya no vale es
# ella. Por eso los roles se releen de la base en cada petición.
req GET /me --token "$T_SOFIA"
problem "y su token deja de servir en la siguiente petición" 401 invalid-credentials
req GET "/users?active=false" --token "$T_DIEGO"
body "aparece entre los inactivos: se desactiva, no se borra" '[.data[].name] | join(",")' 'sofia'

# ─────────────────────────────────────────────────────────────────────────────
step "8 · sesión larga: refresco y cierre"
req POST /auth/refresh --idem none --body "$(jq -nc --arg t "$RT_MARTA" '{refreshToken:$t}')"
ok "el par se rota" 200
body "y el token de refresco es otro" ".refreshToken != \"$RT_MARTA\"" 'true'
RT2="$(jqv '.refreshToken')"; AT2="$(jqv '.accessToken')"

req POST /auth/refresh --idem none --body "$(jq -nc --arg t "$RT_MARTA" '{refreshToken:$t}')"
problem "el viejo ya no vale: es de un solo uso" 401 refresh-token-invalid

req POST /auth/logout --idem none --body "$(jq -nc --arg t "$RT2" '{refreshToken:$t}')"
problem "cerrar sesión exige estar dentro" 401 invalid-credentials
req POST /auth/logout --idem none --token "$AT2" --body '{}'
problem "y decir qué sesión se cierra" 400 validation-failed

req POST /auth/logout --idem none --token "$AT2" --body "$(jq -nc --arg t "$RT2" '{refreshToken:$t}')"
ok "cierra sesión" 204
req POST /auth/refresh --idem none --body "$(jq -nc --arg t "$RT2" '{refreshToken:$t}')"
problem "y después del cierre no se refresca nada" 401 refresh-token-invalid

# ─────────────────────────────────────────────────────────────────────────────
step "9 · Juan cambia su contraseña"
NUEVA='unmejorsecreto9'
req POST /me/password --token "$T_JUAN" --body "$(jq -nc --arg n "$NUEVA" '{current:"no-es-esa-1", next:$n}')"
problem "con la actual equivocada, no" 401 invalid-credentials
req POST /me/password --token "$T_JUAN" --body "$(jq -nc --arg c "$PASSWORD" --arg n "$NUEVA" '{current:$c, next:$n}')"
ok "con la actual correcta, sí" 204

req POST /auth/login --idem none --body "$(jq -nc --arg e "juan-$SLUG@esquina.co" --arg p "$NUEVA" --arg s "$SLUG" \
  '{email:$e, password:$p, slug:$s}')"
ok "entra con la nueva" 200
req POST /auth/login --idem none --body "$(jq -nc --arg e "juan-$SLUG@esquina.co" --arg p "$PASSWORD" --arg s "$SLUG" \
  '{email:$e, password:$p, slug:$s}')"
problem "y ya no con la vieja" 401 invalid-credentials

# ─────────────────────────────────────────────────────────────────────────────
step "10 · otra empresa no ve nada: 404 y nunca 403 (I-6)"
# El mismo correo de Marta, a propósito: la unicidad del correo es por
# organización (T-1), no global.
OTRO_SLUG="norte-$SLUG"
req POST /organizations --idem none --body "$(jq -nc --arg s "$OTRO_SLUG" --arg e "$MARTA" --arg p "$PASSWORD" \
  '{name:"Ferretería del Norte", slug:$s, owner:{email:$e, name:"Marta", password:$p}}')"
ok "el mismo correo abre una segunda empresa" 201
req POST /auth/login --idem none --body "$(jq -nc --arg e "$MARTA" --arg p "$PASSWORD" --arg s "$OTRO_SLUG" \
  '{email:$e, password:$p, slug:$s}')"
ok "y entra en ella" 200
T_NORTE="$(jqv '.accessToken')"

req GET "/users/$JUAN_ID" --token "$T_NORTE";  problem "no ve a Juan" 404 not-found
req PATCH "/users/$JUAN_ID" --token "$T_NORTE" --if-match 1 --body '{"roles":["VIEWER"]}'
                                               problem "no le cambia los roles" 404 not-found
req DELETE "/users/$JUAN_ID" --token "$T_NORTE"; problem "no le quita el acceso" 404 not-found
req GET /users --token "$T_NORTE"
body "y en su listado solo está ella" '.data | length' 1

step "10b · un correo en dos empresas exige decir en cuál"
req POST /auth/login --idem none --body "$(jq -nc --arg e "$MARTA" --arg p "$PASSWORD" '{email:$e, password:$p}')"
problem "sin slug, la petición es ambigua" 409 ambiguous-login
req POST /auth/login --idem none --body "$(jq -nc --arg e "$MARTA" --arg p "$PASSWORD" --arg s "$SLUG" \
  '{email:$e, password:$p, slug:$s}')"
ok "con el slug de La Esquina" 200
req GET /me --token "$(jqv '.accessToken')"
body "entra en La Esquina" '.organization.slug' "$SLUG"

# ─────────────────────────────────────────────────────────────────────────────
step "11 · nadie elige su organización (T-4)"
# El `orgId` del cuerpo no da error: `whitelist: true` lo descarta en silencio,
# que es más seguro que rechazarlo —un cliente no puede provocar un 400 colando
# un campo de más—. Lo que importa es dónde acaba el usuario.
req GET /me --token "$T_NORTE"; ORG_NORTE="$(jqv '.organization.id')"
req POST /users --token "$T_MARTA" --body "$(jq -nc --arg e "colado-$SLUG@esquina.co" --arg p "$PASSWORD" --arg o "$ORG_NORTE" \
  '{email:$e, name:"Colado", password:$p, roles:["VIEWER"], orgId:$o}')"
ok "un orgId ajeno en el cuerpo no rompe la petición" 201
COLADO_ID="$(jqv '.id')"
req GET "/users/$COLADO_ID" --token "$T_MARTA"
ok "el usuario se creó aquí" 200
req GET "/users/$COLADO_ID" --token "$T_NORTE"
problem "y no allí: el campo se descartó en silencio" 404 not-found

req GET "/users?orgId=$ORG_NORTE" --token "$T_MARTA"
problem "y por la query tampoco se elige" 400 invalid-filter
pointer "que es un filtro no declarado" /orgId

# ─────────────────────────────────────────────────────────────────────────────
step "12 · reintentos seguros (I-7)"
K="$(uuid)"
RETRY="$(jq -nc --arg e "retry-$SLUG@esquina.co" --arg p "$PASSWORD" \
  '{email:$e, name:"Retry", password:$p, roles:["VIEWER"]}')"
req POST /users --token "$T_MARTA" --idem "$K" --body "$RETRY"
ok "la primera vez" 201
RETRY_ID="$(jqv '.id')"
req POST /users --token "$T_MARTA" --idem "$K" --body "$RETRY"
ok "la segunda, replay" 201
body "el mismo usuario" '.id' "$RETRY_ID"
header "y lo dice" idempotency-replayed 'true'
# Que el id coincida no demuestra que no se duplicó: eso lo demuestra contarlos.
req GET "/users?limit=200" --token "$T_MARTA"
body "y en el listado hay uno solo, no dos" '[.data[] | select(.name == "Retry")] | length' 1

req POST /users --token "$T_MARTA" --idem "$K" --body "$(jq -nc --arg e "retry-$SLUG@esquina.co" --arg p "$PASSWORD" \
  '{email:$e, name:"Otro", password:$p, roles:["VIEWER"]}')"
problem "la misma clave con otro cuerpo es un error, no un reintento" 409 idempotency-key-reuse
req POST /users --token "$T_MARTA" --idem none --body "$RETRY"
problem "y sin clave no se escribe" 400 missing-idempotency-key

# ═════════════════════════════════════════════════════════════════════════════
printf '\n  organización de esta corrida: %s\n' "$SLUG"
resumen tenencia
