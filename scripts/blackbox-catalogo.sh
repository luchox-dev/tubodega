#!/usr/bin/env bash
# Caja negra del catálogo: la narrativa del plan 3 por HTTP, contra un servidor
# de verdad. No sustituye a `pnpm test:e2e` —que corre en proceso con
# fastify.inject()— sino que lo complementa: hay fallos que solo aparecen
# cuando la petición atraviesa un socket. El 413 de una foto de 11 MB es uno:
# @fastify/multipart corta el archivo mientras lo transmite y avisa lanzando un
# FastifyError, y durante el plan 3 el filtro lo convertía en un 500.
#
#   pnpm start:dev            # en otra terminal
#   ./scripts/blackbox-catalogo.sh
#   BASE=http://otra-maquina:3000 ./scripts/blackbox-catalogo.sh
#
# Recorre entero y cuenta: no se detiene en el primer fallo, porque saber
# cuántas cosas se rompieron vale más que saber cuál se rompió primero.
set -uo pipefail

BASE="${BASE:-http://localhost:3000}"
V="$BASE/v1"
PASSWORD='correcthorse1!'
SLUG="caja-negra-$(date +%s)-$RANDOM"
# Sku.of normaliza a mayúsculas: un SKU tecleado y uno pegado de una hoja son
# el mismo. Lo que se afirma sobre un SKU se afirma en mayúsculas.
SLUG_UP="${SLUG^^}"

command -v curl >/dev/null || { echo "hace falta curl"; exit 2; }
command -v jq   >/dev/null || { echo "hace falta jq"; exit 2; }

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
BODY_F="$TMP/body"; HDR_F="$TMP/headers"

OK=0; BAD=0
ST=''

uuid() { cat /proc/sys/kernel/random/uuid 2>/dev/null || uuidgen | tr 'A-Z' 'a-z'; }

# ─────────────────────────────────────────────────────────────────────────────
# req <método> <ruta> [--token T] [--body JSON] [--idem K|none] [--if-match N]
#                     [--file RUTA:TIPO] [--request-id UUID]
# Deja el estado en $ST, el cuerpo en $BODY_F y las cabeceras en $HDR_F.
#
# TRAMPA: `content-type: application/json` solo se envía cuando hay cuerpo. Con
# esa cabecera y sin cuerpo, Fastify responde 400 «Body cannot be empty» y
# parece un fallo de la API cuando es del guion.
# ─────────────────────────────────────────────────────────────────────────────
req() {
  local method="$1" path="$2"; shift 2
  local token='' body='' idem='' ifmatch='' file='' reqid=''
  while (($#)); do
    case "$1" in
      --token)      token="$2"; shift 2 ;;
      --body)       body="$2"; shift 2 ;;
      --idem)       idem="$2"; shift 2 ;;
      --if-match)   ifmatch="$2"; shift 2 ;;
      --file)       file="$2"; shift 2 ;;
      --request-id) reqid="$2"; shift 2 ;;
      *) echo "req: opción desconocida $1" >&2; return 2 ;;
    esac
  done

  local args=(-sS -o "$BODY_F" -D "$HDR_F" -w '%{http_code}' -X "$method" "$V$path")
  [[ -n "$token"   ]] && args+=(-H "authorization: Bearer $token")
  [[ -n "$ifmatch" ]] && args+=(-H "if-match: \"$ifmatch\"")
  [[ -n "$reqid"   ]] && args+=(-H "x-request-id: $reqid")

  # Todo POST autenticado exige Idempotency-Key; `--idem none` la omite a
  # propósito, y los endpoints @Public() no la piden.
  if [[ "$method" == POST && "$idem" != none ]]; then
    args+=(-H "idempotency-key: ${idem:-$(uuid)}")
  fi

  if [[ -n "$file" ]]; then
    # Multipart: el campo se llama `file` y lleva filename, como el cliente de
    # las pruebas. curl pone el content-type con su boundary.
    args+=(-F "file=@${file%%:*};type=${file##*:};filename=foto.bin")
  elif [[ -n "$body" ]]; then
    args+=(-H 'content-type: application/json' --data-raw "$body")
  fi

  ST="$(curl "${args[@]}")"
}

pass() { OK=$((OK + 1)); printf '  ok   %s\n' "$1"; }
fail() { BAD=$((BAD + 1)); printf '  FALLA %s\n' "$1"; [[ -s "$BODY_F" ]] && sed 's/^/         /' <(head -c 400 "$BODY_F"; echo); }

step() { printf '\n\033[1m%s\033[0m\n' "$1"; }

# ok <descripción> <estado esperado>
ok() {
  if [[ "$ST" == "$2" ]]; then pass "$1"; else fail "$1 — esperaba $2, llegó $ST"; fi
}

# body <descripción> <filtro jq> <valor esperado>
body() {
  local got; got="$(jq -r "$2" < "$BODY_F" 2>/dev/null)"
  if [[ "$got" == "$3" ]]; then pass "$1"; else fail "$1 — $2 dio «$got», esperaba «$3»"; fi
}

# problem <descripción> <estado> <tipo>
# Comprueba el contrato entero de spec 03 §5, no solo el estado: el media type,
# la URI del tipo, y que el traceId del cuerpo sea el X-Request-Id de la
# respuesta. Un error que no se puede correlacionar con un log no sirve.
problem() {
  local desc="$1" want_status="$2" want_type="$3"
  local ct type trace reqid
  ct="$(grep -i '^content-type:' "$HDR_F" | tail -1 | tr -d '\r' | cut -d' ' -f2-)"
  reqid="$(grep -i '^x-request-id:' "$HDR_F" | tail -1 | tr -d '\r' | cut -d' ' -f2-)"
  type="$(jq -r '.type // ""' < "$BODY_F" 2>/dev/null)"
  trace="$(jq -r '.traceId // ""' < "$BODY_F" 2>/dev/null)"

  if [[ "$ST" != "$want_status" ]]; then fail "$desc — esperaba $want_status, llegó $ST"; return; fi
  case "$ct" in application/problem+json*) ;; *) fail "$desc — content-type «$ct»"; return ;; esac
  if [[ "$type" != "https://tubodega.app/errors/$want_type" ]]; then
    fail "$desc — type «$type», esperaba …/$want_type"; return
  fi
  if [[ "$trace" != "$reqid" || -z "$trace" ]]; then
    fail "$desc — traceId «$trace» ≠ X-Request-Id «$reqid»"; return
  fi
  pass "$desc"
}

jqv() { jq -r "$1" < "$BODY_F"; }

# ═════════════════════════════════════════════════════════════════════════════
step "0 · el servidor responde en $BASE"
if ! curl -sS -o /dev/null --max-time 5 "$V/openapi.json"; then
  echo "  No hay nadie en $BASE. Arranca con \`pnpm start:dev\`." >&2
  exit 2
fi
pass "hay servidor"

# ─────────────────────────────────────────────────────────────────────────────
step "1 · la organización y el equipo"
MARTA="marta-$SLUG@esquina.co"
req POST /organizations --idem none --body "$(jq -nc --arg s "$SLUG" --arg e "$MARTA" --arg p "$PASSWORD" \
  '{name:"Distribuidora La Esquina", slug:$s, owner:{email:$e, name:"Marta", password:$p}}')"
ok "registra la organización" 201
ORG_ID="$(jqv '.organization.id')"

req POST /auth/login --idem none --body "$(jq -nc --arg e "$MARTA" --arg p "$PASSWORD" --arg s "$SLUG" \
  '{email:$e, password:$p, slug:$s}')"
ok "Marta inicia sesión" 200
T_MARTA="$(jqv '.accessToken')"

alta() { # alta <variable destino> <rol> <nombre>
  # El token sale por referencia y no por stdout: por ahí va el informe, y una
  # sustitución de comando se lo tragaría entero junto con el token.
  local -n out="$1"
  local role="$2" name="$3" mail="$3-$SLUG@esquina.co"
  req POST /users --token "$T_MARTA" --body "$(jq -nc --arg e "$mail" --arg n "$name" --arg p "$PASSWORD" --arg r "$role" \
    '{email:$e, name:$n, password:$p, roles:[$r]}')"
  ok "da de alta a $name ($role)" 201
  req POST /auth/login --idem none --body "$(jq -nc --arg e "$mail" --arg p "$PASSWORD" --arg s "$SLUG" \
    '{email:$e, password:$p, slug:$s}')"
  ok "$name inicia sesión" 200
  out="$(jqv '.accessToken')"
}
alta T_DIEGO ADMIN diego
alta T_JUAN OPERATOR juan
alta T_SOFIA VIEWER sofia

# ─────────────────────────────────────────────────────────────────────────────
step "2 · los campos propios de la empresa"
req POST /custom-fields --token "$T_DIEGO" \
  --body '{"entity":"PRODUCT","key":"proveedor","label":"Proveedor","type":"TEXT","position":0}'
ok "define proveedor (TEXT)" 201
CF_PROVEEDOR="$(jqv '.id')"

req POST /custom-fields --token "$T_DIEGO" \
  --body '{"entity":"PRODUCT","key":"familia","label":"Familia","type":"SELECT","options":["ferretería","aseo"],"position":1}'
ok "define familia (SELECT)" 201

req GET /custom-fields?entity=PRODUCT --token "$T_DIEGO"
ok "los lista" 200
body "en el orden que les dio" '[.data[].key] | join(",")' 'proveedor,familia'

req POST /custom-fields --token "$T_DIEGO" \
  --body '{"entity":"PRODUCT","key":"marca","label":"Marca","type":"SELECT"}'
problem "un SELECT sin opciones no es una definición" 422 invalid-custom-field

# ─────────────────────────────────────────────────────────────────────────────
step "3 · la hoja de cálculo"
# Veinticinco filas buenas y dos malas entre medias, como cualquier hoja real.
ROWS="$(jq -nc --arg s "$SLUG" '
  def good($i): {
    sku: "IMP-\($s)-\(100 + $i)", name: "Artículo \($i)",
    trackingMode: ["QUANTITY","LOT","SERIAL"][$i % 3], uom: "UNIT",
    codes: ["EAN-\($s)-\($i)"], customFields: {proveedor: "Ferretería Mundial"}
  };
  { rows:
      [range(0;10)  | good(.)]
    + [{sku: "", name: "Sin SKU"}]
    + [range(10;24) | good(.)]
    + [{sku: "MAL-\($s)", name: "Familia inventada", customFields: {familia: "lácteos"}}]
    + [good(24)]
  }')"
req POST /products/import --token "$T_DIEGO" --body "$ROWS"
ok "importa" 200
body "crea las veinticinco buenas" '.created' 25
body "no actualiza ninguna" '.updated' 0
body "y reporta dos filas malas" '.errors | length' 2
body "la primera, por su línea" '.errors[0].line' 11
body "la segunda, por su línea y su SKU" '"\(.errors[1].line)/\(.errors[1].sku)"' "26/MAL-$SLUG_UP"
body "la segunda, por su tipo" '.errors[1].type' 'invalid-custom-field'

step "4 · paginar por cursor sin repetir ni saltar"
SEEN=''; CURSOR=''; PAGES=0
while :; do
  url="/products?limit=10&sort=sku"
  [[ -n "$CURSOR" ]] && url="$url&cursor=$(jq -rn --arg c "$CURSOR" '$c|@uri')"
  req GET "$url" --token "$T_DIEGO"
  [[ "$ST" == 200 ]] || { fail "la página $((PAGES + 1)) devolvió $ST"; break; }
  SEEN="$SEEN$(jqv '.data[].sku')"$'\n'
  CURSOR="$(jqv '.page.nextCursor // ""')"
  PAGES=$((PAGES + 1))
  [[ -z "$CURSOR" || $PAGES -ge 10 ]] && break
done
DISTINCT="$(printf '%s' "$SEEN" | grep -c . )"
UNIQUE="$(printf '%s' "$SEEN" | grep . | sort -u | wc -l)"
[[ "$PAGES" == 3 ]] && pass "tres páginas de diez" || fail "esperaba 3 páginas, dio $PAGES"
[[ "$DISTINCT" == 25 && "$UNIQUE" == 25 ]] \
  && pass "veinticinco SKU, ni repetidos ni saltados" \
  || fail "vio $DISTINCT SKU, $UNIQUE distintos; esperaba 25 y 25"

req POST /products --token "$T_DIEGO" \
  --body "$(jq -nc --arg s "$SLUG" '{sku:"IMP-\($s)-100", name:"Repetido", trackingMode:"QUANTITY", uom:"UNIT"}')"
problem "un SKU ya importado no se crea otra vez (C-1)" 409 sku-taken

# ─────────────────────────────────────────────────────────────────────────────
step "5 · los productos de la narrativa"
req POST /products --token "$T_DIEGO" --body "$(jq -nc --arg s "$SLUG" \
  '{sku:"TOR-\($s)", name:"Tornillo M8 galvanizado", description:"Rosca fina",
    trackingMode:"QUANTITY", uom:"UNIT",
    codes:[{value:"7501-\($s)", kind:"EAN"}],
    customFields:{proveedor:"Ferretería Mundial", familia:"ferretería"}}')"
ok "el tornillo" 201
P_TOR="$(jqv '.id')"
body "nace activo y en la versión 1" '"\(.active)/\(.version)"' 'true/1'

req POST /products --token "$T_DIEGO" --body "$(jq -nc --arg s "$SLUG" \
  '{sku:"TAL-\($s)", name:"Taladro Bosch", trackingMode:"SERIAL", uom:"UNIT"}')"
ok "el taladro (por serie)" 201
P_TAL="$(jqv '.id')"

req POST /products --token "$T_DIEGO" --body "$(jq -nc --arg s "$SLUG" \
  '{sku:"LEC-\($s)", name:"Leche entera", trackingMode:"LOT", uom:"L"}')"
ok "la leche (por lote)" 201
P_LEC="$(jqv '.id')"

req POST /products --token "$T_DIEGO" --body "$(jq -nc --arg s "$SLUG" \
  '{sku:"RARO-\($s)", name:"Raro", trackingMode:"QUANTITY", uom:"UNIT", customFields:{color:"azul"}}')"
problem "un campo que nadie definió no se cuela (C-7)" 422 invalid-custom-field
body "y el puntero señala cuál" '[.errors[].pointer] | index("/customFields/color") != null' 'true'

# ─────────────────────────────────────────────────────────────────────────────
step "6 · fotos: la zona de espera y D-14"
PNG="$TMP/foto.png"
printf 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==' | base64 -d > "$PNG"

# Clave nueva en cada subida: con multipart el req.body está vacío cuando se
# calcula el hash de idempotencia, así que repetir la clave devuelve un replay
# en vez de subir de nuevo (D-17).
req POST /uploads --token "$T_JUAN" --file "$PNG:image/png"
ok "Juan sube a la zona de espera" 201
KEY="$(jqv '.storageKey')"
body "y le dan una caducidad" '.expiresAt | type' 'string'

req POST "/products/$P_TOR/media" --token "$T_JUAN" --body "$(jq -nc --arg k "$KEY" '{storageKeys:[$k]}')"
ok "Juan (OPERATOR) reclama su propia clave" 201
MEDIA_ID="$(jqv '.[0].id')"

req GET "/products/$P_TOR" --token "$T_DIEGO"
body "la foto ya está en el producto" '.media | length' 1

req POST "/products/$P_TOR/media" --token "$T_JUAN" --body "$(jq -nc --arg k "$KEY" '{storageKeys:[$k]}')"
problem "reclamarla dos veces ya no se puede" 422 upload-not-found

req POST "/products/$P_TOR/media" --token "$T_JUAN" --file "$PNG:image/png"
problem "un OPERATOR no sube multipart directo (D-14)" 403 insufficient-role

req POST "/products/$P_TOR/media" --token "$T_DIEGO" --file "$PNG:image/png"
ok "Diego (ADMIN) sí" 201

req DELETE "/products/$P_TOR/media/$MEDIA_ID" --token "$T_DIEGO"
ok "y quita una" 204

step "7 · el tipo y el tamaño, que es donde fastify.inject no llega"
TXT="$TMP/no-es-foto.txt"; printf 'hola' > "$TXT"
req POST /uploads --token "$T_JUAN" --file "$TXT:text/plain"
problem "un texto no es una foto" 415 unsupported-media-type

GRANDE="$TMP/grande.png"; head -c $((11 * 1024 * 1024)) /dev/zero > "$GRANDE"
req POST /uploads --token "$T_JUAN" --file "$GRANDE:image/png"
problem "once megabytes en /uploads" 413 media-too-large
req POST "/products/$P_TOR/media" --token "$T_DIEGO" --file "$GRANDE:image/png"
problem "once megabytes en /products/{id}/media" 413 media-too-large

# ─────────────────────────────────────────────────────────────────────────────
step "8 · códigos"
req POST "/products/$P_TAL/codes" --token "$T_DIEGO" \
  --body "$(jq -nc --arg s "$SLUG" '{value:"QR-\($s)", kind:"INTERNAL_QR"}')"
ok "añade un QR al taladro" 201
CODE_ID="$(jqv '.id')"

req POST "/products/$P_LEC/codes" --token "$T_DIEGO" \
  --body "$(jq -nc --arg s "$SLUG" '{value:"QR-\($s)", kind:"INTERNAL_QR"}')"
problem "el mismo código en otro producto (C-2)" 409 code-taken
body "y el detalle nombra a quien lo tiene" ".detail | test(\"TAL-$SLUG_UP\")" 'true'

req DELETE "/products/$P_TAL/codes/$CODE_ID" --token "$T_DIEGO"
ok "lo quita" 204
req DELETE "/products/$P_TAL/codes/$CODE_ID" --token "$T_DIEGO"
problem "quitarlo dos veces es un 404" 404 code-not-found

step "9 · el escaneo en el pasillo"
req GET "/codes/7501-$SLUG/resolve" --token "$T_JUAN"
ok "por código de barras" 200
body "devuelve el tornillo" '.product.sku' "TOR-$SLUG_UP"

req GET "/codes/TOR-$SLUG/resolve" --token "$T_JUAN"
body "por SKU tecleado" '.product.id' "$P_TOR"
req GET "/codes/tor-$SLUG/resolve" --token "$T_JUAN"
body "y en minúsculas, que un SKU es un SKU" '.product.id' "$P_TOR"

req GET "/codes/NO-EXISTE-$SLUG/resolve" --token "$T_JUAN"
problem "lo que no está, no está" 404 code-not-found

# ─────────────────────────────────────────────────────────────────────────────
step "10 · lotes y series"
req POST "/products/$P_TAL/batches" --token "$T_JUAN" --body '{"serial":"BSH-001"}'
ok "Juan registra la serie del taladro" 201

req GET /codes/BSH-001/resolve --token "$T_JUAN"
ok "y la serie resuelve" 200
body "al producto y a la unidad concreta" '"\(.product.sku)/\(.batch.serial)"' "TAL-$SLUG_UP/BSH-001"

req POST "/products/$P_TAL/batches" --token "$T_JUAN" --body '{"serial":"BSH-001"}'
problem "la misma serie dos veces (C-5)" 409 serial-taken

req POST "/products/$P_LEC/batches" --token "$T_JUAN" \
  --body '{"lotCode":"L-2026-09","expiresAt":"2026-10-01T00:00:00.000Z"}'
ok "el lote de leche con su vencimiento" 201
req POST "/products/$P_LEC/batches" --token "$T_JUAN" --body '{"lotCode":"L-2026-09"}'
problem "el mismo lote dos veces (C-6)" 409 lot-code-taken

req POST "/products/$P_TOR/batches" --token "$T_JUAN" --body '{"lotCode":"L-1"}'
problem "un producto por cantidad no tiene lotes (C-4)" 422 batch-not-allowed
req POST "/products/$P_LEC/batches" --token "$T_JUAN" --body '{}'
problem "y uno por lote no sabe qué remesa es sin lotCode (C-3)" 422 batch-required

# ─────────────────────────────────────────────────────────────────────────────
step "11 · quién puede tocar el catálogo"
for who in JUAN SOFIA; do
  tok="T_$who"
  req POST /products --token "${!tok}" --body "$(jq -nc --arg s "$SLUG" \
    '{sku:"PROHIBIDO-\($s)", name:"x", trackingMode:"QUANTITY", uom:"UNIT"}')"
  problem "$who no define el catálogo" 403 insufficient-role
done
req GET "/products?limit=5" --token "$T_SOFIA"
ok "pero Sofía lee, que para eso es VIEWER" 200
req POST "/products/$P_LEC/batches" --token "$T_SOFIA" --body '{"lotCode":"L-X"}'
problem "y no crea lotes: CREATE_BATCH es de OPERATOR para arriba" 403 insufficient-role

step "12 · edición con control de versión"
req PATCH "/products/$P_TOR" --token "$T_DIEGO" --if-match 1 --body '{"name":"Tornillo M8 inoxidable"}'
ok "con el If-Match que toca" 200
req PATCH "/products/$P_TOR" --token "$T_DIEGO" --if-match 1 --body '{"name":"Otro"}'
problem "con uno viejo" 409 stale-version
req PATCH "/products/$P_TOR" --token "$T_DIEGO" --body '{"name":"Otro"}'
problem "y sin ninguno" 400 missing-if-match

step "13 · las dos reglas retroactivas de los campos propios"
req POST /custom-fields --token "$T_DIEGO" \
  --body '{"entity":"PRODUCT","key":"ubicacion_fiscal","label":"Ubicación fiscal","type":"TEXT","required":true}'
problem "un obligatorio con productos sin valor (C-10)" 422 required-field-would-invalidate
body "y el detalle dice cuántos quedarían inválidos" '.detail | test("[0-9]+ entidades")' 'true'

req PATCH "/custom-fields/$CF_PROVEEDOR" --token "$T_DIEGO" --if-match 1 --body '{"type":"NUMBER"}'
problem "cambiar el tipo de un campo con valores (D-10)" 422 custom-field-type-locked

# ─────────────────────────────────────────────────────────────────────────────
step "14 · reintentos seguros (I-7)"
K="$(uuid)"
IDEM_BODY="$(jq -nc --arg s "$SLUG" '{sku:"IDEM-\($s)", name:"Idempotente", trackingMode:"QUANTITY", uom:"UNIT"}')"
req POST /products --token "$T_DIEGO" --idem "$K" --body "$IDEM_BODY"
ok "la primera vez" 201
FIRST_ID="$(jqv '.id')"
req POST /products --token "$T_DIEGO" --idem "$K" --body "$IDEM_BODY"
ok "la segunda, replay" 201
body "el mismo producto, no otro" '.id' "$FIRST_ID"
if grep -qi '^idempotency-replayed: *true' "$HDR_F"; then
  pass "y lo dice en la cabecera"
else
  fail "falta Idempotency-Replayed: true"
fi
req POST /products --token "$T_DIEGO" --idem "$K" --body "$(jq -nc --arg s "$SLUG" \
  '{sku:"IDEM-\($s)", name:"Otro nombre", trackingMode:"QUANTITY", uom:"UNIT"}')"
problem "la misma clave con otro cuerpo es un error, no un reintento" 409 idempotency-key-reuse
req POST /products --token "$T_DIEGO" --idem none --body "$IDEM_BODY"
problem "y sin clave no se escribe" 400 missing-idempotency-key

step "15 · lo que no está declarado se rechaza"
req GET "/products?foo=1" --token "$T_DIEGO"
problem "un filtro inventado" 400 invalid-filter
body "y el puntero lo nombra" '[.errors[].pointer] | index("/foo") != null' 'true'
req GET "/products?trackingMode=MAGIA" --token "$T_DIEGO"
problem "un valor inventado" 400 invalid-filter
req GET "/custom-fields?entity=PLANETA" --token "$T_DIEGO"
problem "una entidad inventada" 400 invalid-filter

# ─────────────────────────────────────────────────────────────────────────────
step "16 · otra empresa no ve nada: 404 y nunca 403 (I-6)"
OTRO_SLUG="otra-$SLUG"; OTRO_MAIL="ana-$OTRO_SLUG@ferreteria.co"
req POST /organizations --idem none --body "$(jq -nc --arg s "$OTRO_SLUG" --arg e "$OTRO_MAIL" --arg p "$PASSWORD" \
  '{name:"Ferretería del Norte", slug:$s, owner:{email:$e, name:"Ana", password:$p}}')"
ok "se registra una segunda organización" 201
req POST /auth/login --idem none --body "$(jq -nc --arg e "$OTRO_MAIL" --arg p "$PASSWORD" --arg s "$OTRO_SLUG" \
  '{email:$e, password:$p, slug:$s}')"
T_ANA="$(jqv '.accessToken')"

req GET "/products/$P_TOR" --token "$T_ANA";                 problem "el producto ajeno" 404 not-found
req PATCH "/products/$P_TOR" --token "$T_ANA" --if-match 1 --body '{"name":"x"}'
                                                             problem "editarlo" 404 not-found
req DELETE "/products/$P_TOR" --token "$T_ANA";              problem "retirarlo" 404 not-found
req GET "/products/$P_TOR/batches" --token "$T_ANA";         problem "sus lotes" 404 not-found
req GET "/products/$P_TOR/codes" --token "$T_ANA";           problem "sus códigos" 404 not-found
req PATCH "/custom-fields/$CF_PROVEEDOR" --token "$T_ANA" --if-match 1 --body '{"label":"x"}'
                                                             problem "su campo propio" 404 not-found
req GET "/codes/7501-$SLUG/resolve" --token "$T_ANA";        problem "y su código no resuelve" 404 code-not-found

req GET "/products?limit=5" --token "$T_ANA"
body "su catálogo está vacío" '.data | length' 0
req POST /products --token "$T_ANA" --body "$(jq -nc --arg s "$SLUG" \
  '{sku:"TOR-\($s)", name:"Su propio tornillo", trackingMode:"QUANTITY", uom:"UNIT"}')"
ok "y el SKU ajeno está libre para ella" 201

# ─────────────────────────────────────────────────────────────────────────────
step "17 · trazabilidad"
MY_ID="$(uuid)"
req GET "/products?foo=1" --token "$T_DIEGO" --request-id "$MY_ID"
problem "el error sigue el contrato" 400 invalid-filter
body "y honra el X-Request-Id que le mandaron" '.traceId' "$MY_ID"

step "18 · el contrato publicado"
req GET /openapi.json
ok "se sirve" 200
body "con los caminos del catálogo" \
  '[.paths | keys[]] | (index("/v1/products") != null and index("/v1/codes/{value}/resolve") != null and index("/v1/uploads") != null)' \
  'true'

# ─────────────────────────────────────────────────────────────────────────────
step "19 · el ledger es inmutable desde la base (I-3)"
# TRAMPA: hay que fijar app.current_org antes del UPDATE. Sin él, RLS falla
# primero —current_setting() no encuentra el parámetro— y la respuesta no dice
# nada sobre el REVOKE, que es lo que se quiere comprobar.
if docker compose version >/dev/null 2>&1; then
  SQLOUT="$(docker compose exec -T db psql -U tubodega_app -d tubodega -v ON_ERROR_STOP=0 \
    -c "SET app.current_org = '$ORG_ID'; UPDATE movement SET quantity = 1;" 2>&1)"
  if grep -q '42501\|permission denied' <<<"$SQLOUT"; then
    pass "UPDATE movement lo niega el permiso, no la aplicación"
  else
    fail "esperaba 42501; psql dijo: $(tr '\n' ' ' <<<"$SQLOUT" | head -c 200)"
  fi
else
  printf '  (salto) sin docker compose no se puede hablar con la base\n'
fi

# ═════════════════════════════════════════════════════════════════════════════
printf '\n\033[1m%s\033[0m\n' "───────────────────────────────"
printf '  aciertos: %d\n  fallos:   %d\n' "$OK" "$BAD"
printf '  organización de esta corrida: %s\n' "$SLUG"
[[ "$BAD" -eq 0 ]] || exit 1
