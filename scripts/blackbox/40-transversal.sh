#!/usr/bin/env bash
# Caja negra · lo transversal. No pertenece a ninguna narrativa: son las
# garantías que el borde da a todos los endpoints por igual —idempotencia,
# trazas, el contrato de error, el documento publicado— más la inmutabilidad
# del ledger, que solo se ve desde la base.
#
# Se invoca solo o a través de ./scripts/blackbox.sh.
set -uo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

SLUG="transversal-$(date +%s)-$RANDOM"
ADMIN="ana-$SLUG@esquina.co"
UUID_RE='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'

exigir_servidor

step "0 · una organización para trabajar"
req POST /organizations --idem none --body "$(jq -nc --arg s "$SLUG" --arg e "$ADMIN" --arg p "$PASSWORD" \
  '{name:"Transversal", slug:$s, owner:{email:$e, name:"Ana", password:$p}}')"
ok "registrada" 201
ORG_ID="$(jqv '.organization.id')"
req POST /auth/login --idem none --body "$(jq -nc --arg e "$ADMIN" --arg p "$PASSWORD" --arg s "$SLUG" \
  '{email:$e, password:$p, slug:$s}')"
ok "y con sesión" 200
T="$(jqv '.accessToken')"
RT="$(jqv '.refreshToken')"

# ─────────────────────────────────────────────────────────────────────────────
step "1 · los cuatro endpoints exentos de Idempotency-Key"
# Son los que corren antes de que exista organización, más el cierre de sesión:
# la tabla de idempotencia se indexa por org_id, así que no tendrían dónde
# anotarse (spec 07 §5).
req POST /organizations --idem none --body "$(jq -nc --arg s "exento-$SLUG" --arg e "otro-$SLUG@esquina.co" --arg p "$PASSWORD" \
  '{name:"Exenta", slug:$s, owner:{email:$e, name:"Otra", password:$p}}')"
ok "POST /organizations sin la cabecera" 201

req POST /auth/login --idem none --body "$(jq -nc --arg e "$ADMIN" --arg p "$PASSWORD" --arg s "$SLUG" \
  '{email:$e, password:$p, slug:$s}')"
ok "POST /auth/login sin la cabecera" 200
RT_EXENTO="$(jqv '.refreshToken')"; AT_EXENTO="$(jqv '.accessToken')"

req POST /auth/refresh --idem none --body "$(jq -nc --arg t "$RT_EXENTO" '{refreshToken:$t}')"
ok "POST /auth/refresh sin la cabecera" 200
RT_EXENTO2="$(jqv '.refreshToken')"

req POST /auth/logout --idem none --token "$AT_EXENTO" --body "$(jq -nc --arg t "$RT_EXENTO2" '{refreshToken:$t}')"
ok "POST /auth/logout sin la cabecera" 204

# ─────────────────────────────────────────────────────────────────────────────
step "2 · la clave de idempotencia, por sus bordes"
NUEVO="$(jq -nc --arg e "borde-$SLUG@esquina.co" --arg p "$PASSWORD" \
  '{email:$e, name:"Borde", password:$p, roles:["VIEWER"]}')"

req POST /users --token "$T" --raw-idem '' --body "$NUEVO"
problem "una clave vacía no es una clave" 400 missing-idempotency-key
req POST /users --token "$T" --raw-idem "$(printf 'k%.0s' {1..129})" --body "$NUEVO"
problem "ni una de ciento veintinueve caracteres" 400 missing-idempotency-key

req GET /users --token "$T"
ok "un GET no pide ninguna: no cambia nada" 200

step "2b · el hash es del cuerpo canónico, no de su tipografía"
# Si el hash fuera del texto crudo, cambiar el orden de las claves haría de un
# reintento una petición distinta, y el cliente que serializa un objeto sin
# orden garantizado duplicaría sin saberlo.
K="$(uuid)"
req POST /users --token "$T" --idem "$K" \
  --body "$(jq -nc --arg e "canon-$SLUG@esquina.co" --arg p "$PASSWORD" \
    '{email:$e, name:"Canon", password:$p, roles:["VIEWER"]}')"
ok "se crea" 201
CANON_ID="$(jqv '.id')"
req POST /users --token "$T" --idem "$K" \
  --body "$(jq -nc --arg e "canon-$SLUG@esquina.co" --arg p "$PASSWORD" \
    '{roles:["VIEWER"], password:$p, name:"Canon", email:$e}')"
ok "y con las mismas claves en otro orden es el mismo reintento" 201
body "el mismo usuario" '.id' "$CANON_ID"
header "y se anuncia como replay" idempotency-replayed 'true'

step "2c · un 204 replica su propio 204"
KP="$(uuid)"
req POST /me/password --token "$T" --idem "$KP" \
  --body "$(jq -nc --arg c "$PASSWORD" '{current:$c, next:"otracontrasena9"}')"
ok "la contraseña cambia" 204
req POST /me/password --token "$T" --idem "$KP" \
  --body "$(jq -nc --arg c "$PASSWORD" '{current:$c, next:"otracontrasena9"}')"
ok "y el reintento devuelve el mismo 204, no un 401 por la contraseña ya cambiada" 204
header "anunciado como replay" idempotency-replayed 'true'
# Se deja como estaba, que abajo se vuelve a iniciar sesión.
req POST /me/password --token "$T" --body "$(jq -nc --arg n "$PASSWORD" '{current:"otracontrasena9", next:$n}')"
ok "y se devuelve la contraseña original" 204

step "2d · dos peticiones a la vez con la misma clave (I-7)"
# Esta es la comprobación que pide un socket de verdad: en proceso, la
# concurrencia hay que fabricarla; aquí basta con lanzar dos curl a la vez.
KC="$(uuid)"
CUERPO="$(jq -nc --arg e "carrera-$SLUG@esquina.co" --arg p "$PASSWORD" \
  '{email:$e, name:"Carrera", password:$p, roles:["VIEWER"]}')"
carrera() {
  curl -sS -o "$TMP/c$1" -w '%{http_code}' -X POST "$V/users" \
    -H "authorization: Bearer $T" -H "idempotency-key: $KC" \
    -H 'content-type: application/json' --data-raw "$CUERPO" > "$TMP/st$1"
}
carrera a & carrera b & wait
STA="$(cat "$TMP/sta")"; STB="$(cat "$TMP/stb")"
GANA=0; ESPERA=0
for st in "$STA" "$STB"; do
  [[ "$st" == 201 ]] && GANA=$((GANA + 1))
  [[ "$st" == 409 ]] && ESPERA=$((ESPERA + 1))
done
if ((GANA == 1 && ESPERA == 1)); then
  pass "una pasa y la otra espera ($STA y $STB)"
else
  fail "esperaba un 201 y un 409; llegaron $STA y $STB"
fi
TIPO_409="$(jq -r '.type // ""' < "$TMP/c$([[ "$STA" == 409 ]] && echo a || echo b)" 2>/dev/null)"
if [[ "$TIPO_409" == 'https://tubodega.app/errors/idempotency-key-in-flight' ]]; then
  pass "y la que espera lo dice: idempotency-key-in-flight"
else
  fail "la segunda dijo «$TIPO_409», esperaba …/idempotency-key-in-flight"
fi
# Y una vez terminada la primera, la clave replica en vez de volver a crear.
req POST /users --token "$T" --idem "$KC" --body "$CUERPO"
ok "terminada la carrera, la clave replica" 201
header "anunciada como replay" idempotency-replayed 'true'

# ─────────────────────────────────────────────────────────────────────────────
step "3 · trazabilidad, también cuando todo va bien"
req GET /me --token "$T" --request-id 'req-123'
ok "una petición con un X-Request-Id que no es UUID" 200
header "se sustituye por uno que sí lo es" x-request-id "~$UUID_RE"
if [[ "$(hdr x-request-id)" != 'req-123' ]]; then
  pass "y no se devuelve el que mandó el cliente"
else
  fail "devolvió el req-123 del cliente tal cual"
fi

MIO="$(uuid)"
req GET /me --token "$T" --request-id "$MIO"
header "un UUID sí se respeta" x-request-id "$MIO"

req GET "/users?foo=1" --token "$T" --request-id "$MIO"
problem "y en el error, el traceId es ese mismo" 400 invalid-filter
body "correlacionable con el log" '.traceId' "$MIO"

# ─────────────────────────────────────────────────────────────────────────────
step "4 · una ruta que no existe sigue el mismo contrato"
req GET /nope --token "$T" --no-cov
problem "404 en problem+json, no la página de error de Fastify" 404 not-found
body "y dice sobre qué ruta" '.instance' '/v1/nope'

# ─────────────────────────────────────────────────────────────────────────────
step "5 · el contrato publicado"
req GET /openapi.json
ok "se sirve" 200
cp "$BODY_F" "$TMP/openapi-servido.json"
body "con su título" '.info.title' 'tubodega'

FALTAN="$(jq -r '[.paths | to_entries[] | .key as $p | (.value | to_entries[] |
  select((.value.responses // {}) | keys | map(tonumber? // 0) | any(. >= 400) | not) |
  "\(.key|ascii_upcase) \($p)")] | join(", ")' < "$TMP/openapi-servido.json")"
if [[ -z "$FALTAN" ]]; then
  pass "toda operación declara al menos una respuesta de error"
else
  fail "operaciones sin ningún 4xx/5xx declarado: $FALTAN"
fi

# El snapshot versionado es el que revisa quien lee un diff; si el servidor
# sirve otra cosa, el contrato que la gente lee no es el que se cumple.
SNAPSHOT="$(dirname "${BASH_SOURCE[0]}")/../../apps/tubodega/openapi.json"
if [[ -f "$SNAPSHOT" ]]; then
  if diff -q <(jq -S . "$SNAPSHOT") <(jq -S . "$TMP/openapi-servido.json") >/dev/null; then
    pass "y coincide con el snapshot versionado en el repositorio"
  else
    fail "el documento servido difiere de apps/tubodega/openapi.json (corre \`pnpm openapi:write\`)"
  fi
else
  skip "sin el repositorio delante no se puede comparar con el snapshot"
fi

# ─────────────────────────────────────────────────────────────────────────────
step "6 · lo append-only es inmutable desde la base (I-3, D-49)"
# TRAMPA: hay que fijar app.current_org antes del UPDATE. Sin él, RLS falla
# primero —current_setting() no encuentra el parámetro— y la respuesta no dice
# nada sobre el REVOKE, que es lo que se quiere comprobar.
if docker compose version >/dev/null 2>&1; then
  SQLOUT="$(docker compose exec -T db psql -U tubodega_app -d "$DB" -v ON_ERROR_STOP=0 \
    -c "SET app.current_org = '$ORG_ID'; UPDATE movement SET quantity = 1;" 2>&1)"
  if grep -q '42501\|permission denied' <<<"$SQLOUT"; then
    pass "UPDATE movement lo niega el permiso, no la aplicación"
  else
    fail "esperaba 42501; psql dijo: $(tr '\n' ' ' <<<"$SQLOUT" | head -c 200)"
  fi

  # D-49. La segunda capa de `step_completion`, prometida tres veces en prosa
  # desde [13 §2] y hasta el plan 8 en ningún SQL. El tipo del DAO es la
  # primera; esta es la que sobrevive a que alguien abra una consola.
  SQLOUT="$(docker compose exec -T db psql -U tubodega_app -d "$DB" -v ON_ERROR_STOP=0 \
    -c "SET app.current_org = '$ORG_ID'; UPDATE step_completion SET step_id = 'x';" 2>&1)"
  if grep -q '42501\|permission denied' <<<"$SQLOUT"; then
    pass "UPDATE step_completion, igual"
  else
    fail "esperaba 42501; psql dijo: $(tr '\n' ' ' <<<"$SQLOUT" | head -c 200)"
  fi

  SQLOUT="$(docker compose exec -T db psql -U tubodega_app -d "$DB" -v ON_ERROR_STOP=0 \
    -c "SET app.current_org = '$ORG_ID'; DELETE FROM step_completion;" 2>&1)"
  if grep -q '42501\|permission denied' <<<"$SQLOUT"; then
    pass "y borrarlo tampoco se puede"
  else
    fail "esperaba 42501; psql dijo: $(tr '\n' ' ' <<<"$SQLOUT" | head -c 200)"
  fi
else
  skip "sin docker compose no se puede hablar con la base"
fi

# ═════════════════════════════════════════════════════════════════════════════
printf '\n  organización de esta corrida: %s\n' "$SLUG"
resumen transversal
