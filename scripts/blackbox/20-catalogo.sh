#!/usr/bin/env bash
# Caja negra · WAVE 2 — «cargar el catálogo». Diego (ADMIN) migra la hoja de
# cálculo, define campos propios y pone fotos; Juan (OPERATOR) escanea en el
# pasillo y registra una remesa con lote. Los casos 1-11 y 16 de la tabla «E2E
# WAVE 2» del plan maestro (los 12-15 son de nodos y llegan con el plan 4).
#
# Se invoca solo o a través de ./scripts/blackbox.sh.
set -uo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

SLUG="catalogo-$(date +%s)-$RANDOM"
# Sku.of normaliza a mayúsculas: un SKU tecleado y uno pegado de una hoja son
# el mismo. Lo que se afirma sobre un SKU se afirma en mayúsculas.
SLUG_UP="${SLUG^^}"

# ═════════════════════════════════════════════════════════════════════════════
exigir_servidor

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

T_OWNER="$T_MARTA"
alta T_DIEGO ADMIN diego
alta T_JUAN OPERATOR juan
alta T_SOFIA VIEWER sofia

# ─────────────────────────────────────────────────────────────────────────────
step "2 · los campos propios de la empresa"
req POST /custom-fields --token "$T_DIEGO" \
  --body '{"entity":"PRODUCT","key":"proveedor","label":"Proveedor","type":"TEXT","position":0}'
ok "define proveedor (TEXT)" 201
CF_PROVEEDOR="$(jqv '.id')"
header "y dice dónde quedó" location "/v1/custom-fields/$CF_PROVEEDOR"

req POST /custom-fields --token "$T_DIEGO" \
  --body '{"entity":"PRODUCT","key":"familia","label":"Familia","type":"SELECT","options":["ferretería","aseo"],"position":1}'
ok "define familia (SELECT)" 201
CF_FAMILIA="$(jqv '.id')"

req GET /custom-fields?entity=PRODUCT --token "$T_DIEGO"
ok "los lista" 200
body "en el orden que les dio" '[.data[].key] | join(",")' 'proveedor,familia'

# La etiqueta cambia libremente; lo que no cambia es el tipo (eso, más abajo).
req PATCH "/custom-fields/$CF_FAMILIA" --token "$T_DIEGO" --if-match 1 --body '{"label":"Familia de producto"}'
ok "renombra la familia con If-Match" 200
body "y la etiqueta es la nueva" '.label' 'Familia de producto'

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
body "la primera, por su línea y su tipo" '"\(.errors[0].line)/\(.errors[0].type)"' '11/validation-failed'
body "la segunda, por su línea y su SKU" '"\(.errors[1].line)/\(.errors[1].sku)"' "26/MAL-$SLUG_UP"
body "la segunda, por su tipo" '.errors[1].type' 'invalid-custom-field'

# Importar no es de cualquiera, y una hoja no es infinita: pasadas mil filas
# deja de ser una importación y empieza a ser un trabajo por lotes (D-11).
req POST /products/import --token "$T_JUAN" --body '{"rows":[{"sku":"X-1"}]}'
problem "un OPERATOR no importa el catálogo" 403 insufficient-role
# Y una hoja no es infinita. OJO con lo que responde: el controlador declara
# `422 import-too-large` y D-11 dice lo mismo, pero el @ArrayMaxSize(1000) del
# DTO corta en el borde y devuelve `400 validation-failed` antes de que el caso
# de uso llegue a mirar. El 422 declarado es, por HTTP, inalcanzable. Aquí se
# afirma lo que el cliente recibe de verdad; corregir cuál de los dos sobra es
# una decisión de contrato, no de esta prueba.
req POST /products/import --token "$T_DIEGO" \
  --body "$(jq -nc --arg s "$SLUG" '{rows: [range(0;1001) | {sku: "BULK-\($s)-\(.)"}]}')"
problem "y mil una filas las corta el borde" 400 validation-failed
pointer "señalando las filas" /rows

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

step "4b · re-importar actualiza, no duplica"
# La hoja se vuelve a subir con diez nombres cambiados: es lo que hace de
# verdad quien migra un catálogo, y el upsert por SKU es lo que se prueba.
REIMPORT="$(jq -nc --arg s "$SLUG" \
  '{rows: [range(0;10) | {sku: "IMP-\($s)-\(100 + .)", name: "Artículo NUEVO \(.)"}]}')"
req POST /products/import --token "$T_DIEGO" --body "$REIMPORT"
ok "re-importa" 200
body "no crea nada" '.created' 0
body "actualiza los diez" '.updated' 10
body "y sin un solo error" '.errors | length' 0

req GET "/products?q=NUEVO&limit=200" --token "$T_DIEGO"
ok "el filtro q los encuentra" 200
body "los diez, ni uno más" '.data | length' 10

req GET "/products?limit=200&sort=sku" --token "$T_DIEGO"
body "y el total no creció: veinticinco siguen siendo veinticinco" '.data | length' 25

# ─────────────────────────────────────────────────────────────────────────────
step "5 · los productos de la narrativa"
req POST /products --token "$T_DIEGO" --body "$(jq -nc --arg s "$SLUG" \
  '{sku:"TOR-\($s)", name:"Tornillo M8 galvanizado", description:"Rosca fina",
    trackingMode:"QUANTITY", uom:"UNIT",
    codes:[{value:"7501-\($s)", kind:"EAN"}],
    customFields:{proveedor:"Ferretería Mundial", familia:"ferretería"}}')"
ok "el tornillo" 201
P_TOR="$(jqv '.id')"
header "y dice dónde quedó" location "/v1/products/$P_TOR"
body "nace activo y en la versión 1" '"\(.active)/\(.version)"' 'true/1'
body "y los campos propios vuelven tal cual se mandaron" \
  '.customFields | "\(.proveedor)/\(.familia)"' 'Ferretería Mundial/ferretería'

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
pointer "y el puntero señala cuál" /customFields/color

req POST /products --token "$T_DIEGO" --body "$(jq -nc --arg s "$SLUG" \
  '{sku:"RARO2-\($s)", name:"Raro", trackingMode:"QUANTITY", uom:"DOCENA"}')"
problem "ni una unidad de medida inventada" 422 validation-failed
pointer "señalando el campo" /uom

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
body "con el tipo que se subió" '.media[0].contentType' 'image/png'

req POST "/products/$P_TOR/media" --token "$T_JUAN" --body "$(jq -nc --arg k "$KEY" '{storageKeys:[$k]}')"
problem "reclamarla dos veces ya no se puede" 422 upload-not-found

req POST "/products/$P_TOR/media" --token "$T_JUAN" --file "$PNG:image/png"
problem "un OPERATOR no sube multipart directo (D-14)" 403 insufficient-role

req POST "/products/$P_TOR/media" --token "$T_DIEGO" --file "$PNG:image/png"
ok "Diego (ADMIN) sí" 201
body "y la segunda foto va detrás de la primera" '.[0].position' 1

req DELETE "/products/$P_TOR/media/$MEDIA_ID" --token "$T_DIEGO"
ok "y quita una" 204

req GET "/products/$P_TOR" --token "$T_DIEGO"
body "queda la otra" '.media | length' 1
body "y es la otra, no la borrada" ".media[0].id != \"$MEDIA_ID\"" 'true'

req DELETE "/products/$P_TOR/media/$MEDIA_ID" --token "$T_DIEGO"
problem "quitarla dos veces es un 404, no un 204 silencioso" 404 not-found

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

req GET "/products/$P_TAL/codes" --token "$T_DIEGO"
ok "los lista" 200
body "el que se acaba de añadir" '. | length' 1

req DELETE "/products/$P_TAL/codes/$CODE_ID" --token "$T_DIEGO"
ok "lo quita" 204
req DELETE "/products/$P_TAL/codes/$CODE_ID" --token "$T_DIEGO"
problem "quitarlo dos veces es un 404" 404 code-not-found

step "9 · el escaneo en el pasillo"
req GET "/codes/7501-$SLUG/resolve" --token "$T_JUAN"
ok "por código de barras" 200
body "devuelve el tornillo" '.product.sku' "TOR-$SLUG_UP"
body "y ningún lote: un código de producto no identifica una remesa" '.batch == null' 'true'

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
pointer "que es el campo que señala" /lotCode

req GET "/products/$P_LEC/batches" --token "$T_JUAN"
ok "los lotes se listan" 200
body "y está el que se creó" '. | length' 1

# Un código de lote no se resuelve: sin saber de qué producto es, «L-2026-09»
# puede ser la remesa de cualquiera.
req GET /codes/L-2026-09/resolve --token "$T_JUAN"
problem "un código de lote no resuelve: sin producto es ambiguo" 404 code-not-found

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

# C-8 · sin movimientos todavía, el modo de seguimiento sí se puede cambiar.
# (Con movimientos se bloquea, pero el ledger llega en la WAVE 3.)
req PATCH "/products/$P_TOR" --token "$T_DIEGO" --if-match 2 --body '{"trackingMode":"LOT"}'
ok "sin movimientos, el modo de seguimiento cambia (C-8)" 200
body "y es el nuevo" '.trackingMode' 'LOT'
req PATCH "/products/$P_TOR" --token "$T_DIEGO" --if-match 3 --body '{"trackingMode":"QUANTITY"}'
ok "y se deshace, que el resto del relato lo ve por cantidad" 200

step "12b · C-9 · sin existencias, el producto se retira del catálogo"
req POST /products --token "$T_DIEGO" --body "$(jq -nc --arg s "$SLUG" \
  '{sku:"RETIRO-\($s)", name:"Para retirar", trackingMode:"QUANTITY", uom:"UNIT"}')"
ok "un producto de sobra" 201
P_RETIRO="$(jqv '.id')"

req DELETE "/products/$P_RETIRO" --token "$T_DIEGO"
ok "se retira" 204
req GET "/products/$P_RETIRO" --token "$T_DIEGO"
body "y queda inactivo, no borrado: el histórico lo sigue nombrando" '.active' 'false'
req GET "/products?active=false&limit=200" --token "$T_DIEGO"
body "y aparece entre los retirados" \
  "[.data[].sku] | index(\"RETIRO-$SLUG_UP\") != null" 'true'

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

# Y lo declarado tiene que funcionar: un filtro que rechaza lo inválido pero no
# filtra lo válido no sirve de nada.
req GET "/products?trackingMode=SERIAL&limit=200" --token "$T_DIEGO"
ok "el filtro por modo de seguimiento" 200
body "devuelve solo SERIAL" '[.data[].trackingMode] | unique | join(",")' 'SERIAL'
body "y devuelve alguno" '.data | length > 0' 'true'

req GET "/products?sort=-sku&limit=3" --token "$T_DIEGO"
body "y el orden descendente lo es de verdad" \
  '[.data[].sku] as $d | ($d == ($d | sort | reverse))' 'true'

# ─────────────────────────────────────────────────────────────────────────────
step "16 · otra empresa no ve nada: 404 y nunca 403 (I-6)"
OTRO_SLUG="otra-$SLUG"; OTRO_MAIL="ana-$OTRO_SLUG@ferreteria.co"
req POST /organizations --idem none --body "$(jq -nc --arg s "$OTRO_SLUG" --arg e "$OTRO_MAIL" --arg p "$PASSWORD" \
  '{name:"Ferretería del Norte", slug:$s, owner:{email:$e, name:"Ana", password:$p}}')"
ok "se registra una segunda organización" 201
req POST /auth/login --idem none --body "$(jq -nc --arg e "$OTRO_MAIL" --arg p "$PASSWORD" --arg s "$OTRO_SLUG" \
  '{email:$e, password:$p, slug:$s}')"
# Sin este `ok`, un login fallido dejaría T_ANA vacío y los siete 404 de abajo
# pasarían por la razón equivocada.
ok "Ana inicia sesión" 200
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

# ═════════════════════════════════════════════════════════════════════════════
printf '\n  organización de esta corrida: %s\n' "$SLUG"
resumen catalogo
