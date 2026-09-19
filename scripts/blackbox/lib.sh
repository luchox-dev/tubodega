# El cliente HTTP del repositorio en shell, y los ayudantes que lo rodean. Se
# hace `source` desde cada suite de caja negra, desde el runner y desde
# scripts/seed.sh; no se ejecuta por sí solo. Tiene dos consumidores, así que un
# cambio en `req` o en `alta` puede romper la siembra además de las suites.
#
# Nada de `set -e`: una suite recorre entera y cuenta. Saber cuántas cosas se
# rompieron vale más que saber cuál se rompió primero.

# `alta()` usa namerefs (`local -n`), de bash 4.3. El bash 3.2 que trae macOS
# falla ahí con un mensaje que no ayuda a nadie.
if [[ -z "${BASH_VERSINFO:-}" ]] || ((BASH_VERSINFO[0] < 4)) ||
   { ((BASH_VERSINFO[0] == 4)) && ((BASH_VERSINFO[1] < 3)); }; then
  echo "Hace falta bash >= 4.3 (hay ${BASH_VERSION:-desconocido}). En macOS: brew install bash." >&2
  exit 2
fi

BASE="${BASE:-http://localhost:3000}"
# La base contra la que corre el servidor de $BASE. Solo la usa la comprobación
# del REVOKE sobre movement, que es la única que habla SQL: el resto del guion
# es caja negra de verdad. Hay que poder cambiarla porque la pila de compose
# corre sobre tubodega_docker y `pnpm start:dev` sobre tubodega, y comprobar la
# inmutabilidad del ledger en la base equivocada no comprueba nada.
DB="${DB:-tubodega}"
V="$BASE/v1"
PASSWORD='correcthorse1!'

command -v curl >/dev/null || { echo "hace falta curl"; exit 2; }
command -v jq   >/dev/null || { echo "hace falta jq"; exit 2; }

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
BODY_F="$TMP/body"; HDR_F="$TMP/headers"

OK=0; BAD=0
ST=''

# Dónde se anota la cobertura. El runner lo exporta para agregar entre suites;
# una suite suelta escribe en su propio temporal y no le estorba a nadie.
# Se crea si no está, pero NUNCA se trunca: si lo hiciera, cada suite borraría
# lo anotado por la anterior y el cruce final solo vería la última.
BB_COV="${BB_COV:-$TMP/cobertura}"
: >> "$BB_COV"; : >> "$BB_COV.resultados"

uuid() { cat /proc/sys/kernel/random/uuid 2>/dev/null || uuidgen | tr 'A-Z' 'a-z'; }

# ─────────────────────────────────────────────────────────────────────────────
# Normaliza una ruta concreta a su plantilla de OpenAPI, para poder cruzar lo
# que se pidió de verdad contra el inventario de endpoints. Las reglas más
# específicas van primero: /products/{id}/codes/{codeId} antes que /products/{id}.
# ─────────────────────────────────────────────────────────────────────────────
plantilla() {
  local p="${1%%\?*}"                      # fuera la query
  local u='[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}'
  p="$(sed -E "
    s#^/products/$u/codes/$u\$#/products/{id}/codes/{codeId}#;
    s#^/products/$u/media/$u\$#/products/{id}/media/{mediaId}#;
    s#^/products/$u/(codes|media|batches)\$#/products/{id}/\1#;
    s#^/products/$u\$#/products/{id}#;
    s#^/users/$u\$#/users/{id}#;
    s#^/custom-fields/$u\$#/custom-fields/{id}#;
    s#^/organizations/$u\$#/organizations/{id}#;
    s#^/codes/.+/resolve\$#/codes/{value}/resolve#;
    s#^/nodes/$u/(move|tree)\$#/nodes/{id}/\1#;
    s#^/nodes/$u\$#/nodes/{id}#;
    s#^/movements/batch\$#/movements/batch#;
    s#^/movements/$u/reverse\$#/movements/{id}/reverse#;
    s#^/movements/$u\$#/movements/{id}#;
    s#^/stock/custodies\$#/stock/custodies#;
    s#^/process-instances/$u/steps/[^/]+/complete\$#/process-instances/{id}/steps/{stepId}/complete#;
    s#^/process-instances/$u/cancel\$#/process-instances/{id}/cancel#;
    s#^/process-instances/$u\$#/process-instances/{id}#;
    s#^/process-templates/[^/]+/versions\$#/process-templates/{code}/versions#;
    s#^/process-templates/[^/]+\$#/process-templates/{code}#;
  " <<<"$p")"
  printf '/v1%s' "$p"
}

# ─────────────────────────────────────────────────────────────────────────────
# req <método> <ruta> [--token T] [--body JSON] [--idem K|none] [--if-match N]
#                     [--file RUTA:TIPO] [--request-id ID] [--raw-idem S]
#                     [--no-cov]
# Deja el estado en $ST, el cuerpo en $BODY_F y las cabeceras en $HDR_F, y anota
# la operación en $BB_COV.
#
# TRAMPA: `content-type: application/json` solo se envía cuando hay cuerpo. Con
# esa cabecera y sin cuerpo, Fastify responde 400 «Body cannot be empty» y
# parece un fallo de la API cuando es del guion.
# ─────────────────────────────────────────────────────────────────────────────
req() {
  local method="$1" path="$2"; shift 2
  local token='' body='' idem='' ifmatch='' file='' reqid='' cov=1
  local rawidem='' rawidem_set=0
  while (($#)); do
    case "$1" in
      --token)        token="$2"; shift 2 ;;
      --body)         body="$2"; shift 2 ;;
      --idem)         idem="$2"; shift 2 ;;
      # Clave literal, tal cual, incluso vacía o de trescientos caracteres: es
      # lo que hace falta para probar que el borde la rechaza.
      --raw-idem)     rawidem="$2"; rawidem_set=1; shift 2 ;;
      --if-match)     ifmatch="\"$2\""; shift 2 ;;
      --if-match-raw) ifmatch="$2"; shift 2 ;;   # W/"2", basura, lo que sea
      --file)         file="$2"; shift 2 ;;
      --request-id)   reqid="$2"; shift 2 ;;
      --no-cov)       cov=0; shift ;;
      *) echo "req: opción desconocida $1" >&2; return 2 ;;
    esac
  done

  local args=(-sS -o "$BODY_F" -D "$HDR_F" -w '%{http_code}' -X "$method" "$V$path")
  [[ -n "$token"   ]] && args+=(-H "authorization: Bearer $token")
  [[ -n "$ifmatch" ]] && args+=(-H "if-match: $ifmatch")
  [[ -n "$reqid"   ]] && args+=(-H "x-request-id: $reqid")

  # Todo POST autenticado exige Idempotency-Key; `--idem none` la omite a
  # propósito, y los endpoints @Public() o exentos no la piden.
  if ((rawidem_set)); then
    args+=(-H "idempotency-key: $rawidem")
  elif [[ "$method" == POST && "$idem" != none ]]; then
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
  ((cov)) && printf '%s\t%s\t%s\n' "$method" "$(plantilla "$path")" "$ST" >> "$BB_COV"
  return 0
}

pass() { OK=$((OK + 1)); printf '  ok   %s\n' "$1"; }
fail() {
  BAD=$((BAD + 1)); printf '  FALLA %s\n' "$1"
  [[ -s "$BODY_F" ]] && { head -c 400 "$BODY_F" | sed 's/^/         /'; echo; }
  return 0
}
skip() { printf '  (salto) %s\n' "$1"; }
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

# header <descripción> <nombre> <esperado>   — con `~` delante, el esperado es una regex
header() {
  local got; got="$(hdr "$2")"
  if [[ "$3" == '~'* ]]; then
    if [[ "$got" =~ ${3#\~} ]]; then pass "$1"; else fail "$1 — $2 dio «$got», no casa con ${3#\~}"; fi
  elif [[ "$got" == "$3" ]]; then pass "$1"; else fail "$1 — $2 dio «$got», esperaba «$3»"; fi
}

# hdr <nombre> — el valor de una cabecera de la última respuesta
hdr() { grep -i "^$1:" "$HDR_F" | tail -1 | tr -d '\r' | cut -d' ' -f2-; }

# problem <descripción> <estado> <tipo>
# Comprueba el contrato entero de spec 03 §5, no solo el estado: el media type,
# la URI del tipo, y que el traceId del cuerpo sea el X-Request-Id de la
# respuesta. Un error que no se puede correlacionar con un log no sirve.
problem() {
  local desc="$1" want_status="$2" want_type="$3"
  local ct type trace reqid
  ct="$(hdr content-type)"; reqid="$(hdr x-request-id)"
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

# pointer <descripción> <puntero JSON esperado dentro de errors[]>
pointer() {
  body "$1" "[.errors[]?.pointer] | index(\"$2\") != null" 'true'
}

jqv() { jq -r "$1" < "$BODY_F"; }

alta() { # alta <variable destino> <rol> <nombre> — usa $T_OWNER y $SLUG
  # El token sale por referencia y no por stdout: por ahí va el informe, y una
  # sustitución de comando se lo tragaría entero junto con el token.
  local -n out="$1"
  local role="$2" name="$3" mail="$3-$SLUG@esquina.co"
  req POST /users --token "$T_OWNER" --body "$(jq -nc --arg e "$mail" --arg n "$name" --arg p "$PASSWORD" --arg r "$role" \
    '{email:$e, name:$n, password:$p, roles:[$r]}')"
  ok "da de alta a $name ($role)" 201
  req POST /auth/login --idem none --body "$(jq -nc --arg e "$mail" --arg p "$PASSWORD" --arg s "$SLUG" \
    '{email:$e, password:$p, slug:$s}')"
  ok "$name inicia sesión" 200
  out="$(jqv '.accessToken')"
}

# Resumen de una suite. Lo legible va a stdout; la línea que el runner suma se
# anexa a un archivo, para no ensuciar el informe que lee una persona.
resumen() {
  printf '\n  aciertos: %d\n  fallos:   %d\n' "$OK" "$BAD"
  printf '%s\t%d\t%d\n' "${1:-suite}" "$OK" "$BAD" >> "$BB_COV.resultados"
  [[ "$BAD" -eq 0 ]]
}

# Aborta pronto si no hay nadie escuchando: cien fallos de conexión no informan
# más que uno.
exigir_servidor() {
  if ! curl -sS -o /dev/null --max-time 5 "$V/openapi.json"; then
    echo "  No hay nadie en $BASE. Arranca con \`pnpm start:dev\`." >&2
    exit 2
  fi
}

# ═════════════════════════════════════════════════════════════════════════════
# LOS ESCENARIOS (plan 8c)
#
# Todo lo de aquí abajo nació para las suites 50..56, que no prueban endpoints
# sino jornadas de trabajo. Es aditivo a propósito: lo de arriba lo sourcean las
# seis suites por endpoint y también scripts/seed.sh, así que cambiar una firma
# de `req`, `alta` u `ok` rompería la siembra sin que la caja negra se entere.
# ═════════════════════════════════════════════════════════════════════════════

# Como fail, pero el detalle lo pone quien llama. En una reconciliación el
# cuerpo de la última respuesta no dice nada y las filas que no cuadran lo dicen
# todo, así que imprimir el body sería tapar la única pista útil.
falla_detalle() {
  BAD=$((BAD + 1)); printf '  FALLA %s\n' "$1"
  [[ -n "${2:-}" ]] && sed 's/^/         /' <<<"$2"
  return 0
}

# ─────────────────────────────────────────────────────────────────────────────
# Las cantidades viajan como cadena con tres decimales ("12.500"), que es la
# forma exacta de un bigint de milésimas. Sumarlas con `tonumber` las pasa por
# un double y devuelve el problema que el contrato evitó a propósito, así que
# aquí se vuelven enteros. El signo va aparte: sin eso "-0.500" sale positivo,
# porque el "-" se lo come el split y 0*1000 no lo recuerda.
# ─────────────────────────────────────────────────────────────────────────────
JQ_MILI='def mili: tostring
  | (if startswith("-") then -1 else 1 end) as $s
  | (ltrimstr("-") | split("."))
  | $s * ((.[0] | tonumber) * 1000 + ((((.[1] // "0") + "000")[0:3]) | tonumber));'

# cantidad <descripción> <filtro jq> <esperado>
# Compara decimales por milésimas: "500" y "500.000" son la misma cantidad, y
# una aserción que los distinga está probando el formateo, no el inventario.
cantidad() {
  local got want
  got="$(jq -r "$JQ_MILI ($2) | mili" < "$BODY_F" 2>/dev/null)"
  want="$(jq -rn "$JQ_MILI \"$3\" | mili" 2>/dev/null)"
  # Dos vacíos son iguales y no son una comprobación: si jq no devolvió un
  # número, lo que falló fue la aserción, no el sistema.
  if [[ -z "$got" || -z "$want" ]]; then fail "$1 — no salió número de «$2» (got=«$got» want=«$want»)"; return; fi
  if [[ "$got" == "$want" ]]; then pass "$1"; else fail "$1 — $2 dio «$got» milésimas, esperaba «$want»"; fi
}

# ─────────────────────────────────────────────────────────────────────────────
# recorrer_paginas <método> <ruta> <token> [tope]
#
# Sigue nextCursor hasta el final y deja en $PAGINAS el array de todos los
# elementos. De paso comprueba lo único que un cursor puede romper y una sola
# página nunca enseña: que ninguna fila se repita ni se pierda entre páginas —
# que es exactamente lo que D-67/D-68 hacía en silencio.
#
# Solo la primera página cuenta para la cobertura: las siguientes son la misma
# operación, y contarlas N veces no la cubre más.
# ─────────────────────────────────────────────────────────────────────────────
recorrer_paginas() {
  local method="$1" path="$2" token="$3" tope="${4:-50}"
  local cursor='' vuelta=0 sep ruta cov='' acumulado="$TMP/paginas.jsonl"
  : > "$acumulado"
  PAGINAS='[]'
  while :; do
    vuelta=$((vuelta + 1))
    if ((vuelta > tope)); then
      falla_detalle "recorrer_paginas: $path pasó de $tope páginas; o hay un bucle o el cursor no avanza"
      return 1
    fi
    ruta="$path"; cov=''
    if [[ -n "$cursor" ]]; then
      sep='?'; [[ "$path" == *'?'* ]] && sep='&'
      ruta="$path${sep}cursor=$cursor"; cov='--no-cov'
    fi
    req "$method" "$ruta" --token "$token" ${cov:+$cov}
    if [[ "$ST" != 200 ]]; then
      falla_detalle "recorrer_paginas: $ruta devolvió $ST en la página $vuelta" "$(head -c 300 "$BODY_F")"
      return 1
    fi
    jq -c '.data[]' < "$BODY_F" >> "$acumulado"
    [[ "$(jq -r '.page.hasMore // false' < "$BODY_F")" == true ]] || break
    cursor="$(jq -r '.page.nextCursor // ""' < "$BODY_F")"
    if [[ -z "$cursor" ]]; then
      falla_detalle "recorrer_paginas: $ruta dice hasMore pero no manda nextCursor"
      return 1
    fi
  done
  PAGINAS="$(jq -sc . "$acumulado")"
  return 0
}

# paginas_sin_repetidos <descripción> [campo]
# La aserción que justifica recorrer entero en vez de pedir una página grande.
paginas_sin_repetidos() {
  local campo="${2:-id}" total unicos
  total="$(jq "length" <<<"$PAGINAS")"
  unicos="$(jq "[.[].$campo] | unique | length" <<<"$PAGINAS")"
  if [[ "$total" == "$unicos" ]]; then
    pass "$1 ($total sin repetir)"
  else
    falla_detalle "$1 — $total filas pero solo $unicos «$campo» distintos" \
      "$(jq -r "[.[].$campo] | group_by(.) | map(select(length>1)) | .[] | \"repetido: \(.[0])\"" <<<"$PAGINAS")"
  fi
}

# ═════════════════════════════════════════════════════════════════════════════
# EL ARQUEO
#
# Un escenario que solo mira códigos de estado afirma que la API contestó. Estas
# tres afirman que la bodega cuadra, que es lo que un jefe de almacén comprueba
# al cerrar. Son la forma HTTP de las propiedades de test/invariants/, y la
# única red que detecta que el saldo materializado y el ledger se separaron.
# ═════════════════════════════════════════════════════════════════════════════

# (a) Conservación: la suma de TODOS los saldos de un producto —estanterías,
#     custodias, y los acumulados de frontera con su signo— es exactamente cero.
#     nonZeroOnly=false es obligatorio: sin él desaparecen justo las filas que
#     cancelan, y la propiedad se cumpliría por no mirar.
reconciliar_conservacion() { # reconciliar_conservacion <token> <productId> [etiqueta]
  local token="$1" p="$2" etq="${3:-${2:0:8}}" malas
  recorrer_paginas GET "/stock?productId=$p&custodialOnly=false&nonZeroOnly=false&limit=200" "$token" || return 1
  malas="$(jq -r "$JQ_MILI"'
    group_by(.batchId // "—")
    | map({lote: (.[0].batchId // "sin lote"), suma: (map(.quantity | mili) | add)})
    | map(select(.suma != 0))
    | .[] | "lote \(.lote): sobran/faltan \(.suma) milésimas"' <<<"$PAGINAS")"
  if [[ -z "$malas" ]]; then
    pass "conservación · $etq cierra en cero"
  else
    falla_detalle "conservación · $etq NO cierra en cero" "$malas"
  fi
}

# (b) El saldo materializado es la suma del ledger. Se reconstruye el saldo
#     desde los asientos —restando en el origen, sumando en el destino, que es
#     la partida doble— y se compara clave a clave. Una compensación no necesita
#     trato especial: es un asiento más con sus dos extremos.
reconciliar_ledger() { # reconciliar_ledger <token> <productId> [etiqueta]
  local token="$1" p="$2" etq="${3:-${2:0:8}}" mov saldo malas
  recorrer_paginas GET "/movements?productId=$p&limit=200" "$token" || return 1
  mov="$PAGINAS"
  recorrer_paginas GET "/stock?productId=$p&custodialOnly=false&nonZeroOnly=false&limit=200" "$token" || return 1
  saldo="$PAGINAS"
  malas="$(jq -rn --argjson m "$mov" --argjson s "$saldo" "$JQ_MILI"'
      ($m | reduce .[] as $x ({};
            .[$x.fromNodeId + "|" + ($x.batchId // "—")] += -($x.quantity | mili)
          | .[$x.toNodeId   + "|" + ($x.batchId // "—")] +=  ($x.quantity | mili)
        )) as $esperado
    | ($s | reduce .[] as $x ({};
            .[$x.nodeId + "|" + ($x.batchId // "—")] += ($x.quantity | mili)
        )) as $real
    | (($esperado | keys) + ($real | keys) | unique)
    | map({k: ., ledger: ($esperado[.] // 0), saldo: ($real[.] // 0)})
    | map(select(.ledger != .saldo))
    | .[] | "\(.k): el ledger dice \(.ledger) y el saldo \(.saldo)"')"
  if [[ -z "$malas" ]]; then
    pass "ledger · $etq: el saldo es la suma de los asientos"
  else
    falla_detalle "ledger · $etq: el saldo y los asientos se separaron" "$malas"
  fi
}

# (c) Lo prestado y lo pendiente son la misma cosa vista de dos maneras. Es la
#     aserción discriminante: un check-in que baja el saldo sin bajar el
#     pendiente, o una compensación que borra el saldo y deja la deuda viva,
#     sale aquí y en ningún otro sitio de la suite.
reconciliar_custodias() { # reconciliar_custodias <token>
  local token="$1" custodias tenedores saldos='[]' n malas
  recorrer_paginas GET "/stock/custodies?limit=200" "$token" || return 1
  custodias="$PAGINAS"
  req GET "/nodes?kind=CUSTODY&limit=200" --token "$token" --no-cov
  tenedores="$(jq -c '[.data[].id]' < "$BODY_F")"
  for n in $(jq -r '.[]' <<<"$tenedores"); do
    req GET "/stock?nodeId=$n&nonZeroOnly=true&limit=200" --token "$token" --no-cov
    saldos="$(jq -c --argjson a "$saldos" '$a + .data' < "$BODY_F")"
  done

  # I-18 primero: cada préstamo debe tener entre cero y todo lo que salió.
  malas="$(jq -rn --argjson c "$custodias" "$JQ_MILI"'
    $c | map(select((.pending | mili) < 0 or (.pending | mili) > (.checkOut.quantity | mili)))
       | .[] | "préstamo \(.checkOut.id): pendiente \(.pending) de \(.checkOut.quantity)"')"
  if [[ -z "$malas" ]]; then
    pass "custodias · ningún pendiente fuera de [0, lo prestado] (I-18)"
  else
    falla_detalle "custodias · pendiente imposible (I-18)" "$malas"
  fi

  malas="$(jq -rn --argjson c "$custodias" --argjson s "$saldos" "$JQ_MILI"'
      ($c | reduce .[] as $x ({};
            .[$x.checkOut.productId + "|" + ($x.checkOut.batchId // "—")] += ($x.pending | mili)
        )) as $pendiente
    | ($s | reduce .[] as $x ({};
            .[$x.productId + "|" + ($x.batchId // "—")] += ($x.quantity | mili)
        )) as $enPoder
    | (($pendiente | keys) + ($enPoder | keys) | unique)
    | map({k: ., pendiente: ($pendiente[.] // 0), enPoder: ($enPoder[.] // 0)})
    | map(select(.pendiente != .enPoder))
    | .[] | "\(.k): pendiente \(.pendiente) pero en poder \(.enPoder)"')"
  if [[ -z "$malas" ]]; then
    pass "custodias · lo pendiente es lo que está en manos de alguien"
  else
    falla_detalle "custodias · lo pendiente y lo que hay en las custodias no casan" "$malas"
  fi
}

# arqueo <token> <productId:etiqueta>... — la última línea de cada escenario.
# La etiqueta importa: los UUIDv7 son ordenados en el tiempo, así que dos
# productos creados con segundos de diferencia comparten los primeros ocho
# caracteres y un informe que los recorte no distingue cuál no cuadra.
arqueo() {
  local token="$1"; shift
  printf '\n  \033[2m── arqueo ──\033[0m\n'
  local par p etq
  for par in "$@"; do
    p="${par%%:*}"; etq="${par#*:}"; [[ "$etq" == "$p" ]] && etq="${p:0:8}"
    reconciliar_conservacion "$token" "$p" "$etq"
    reconciliar_ledger "$token" "$p" "$etq"
  done
  reconciliar_custodias "$token"
}

# ═════════════════════════════════════════════════════════════════════════════
# PROCESOS
# ═════════════════════════════════════════════════════════════════════════════

# paso <instancia> <token> <stepId> <payload jq>
# El gesto suelto, con la instancia explícita, para los caminos de error.
paso() {
  req POST "/process-instances/$1/steps/$3/complete" --token "$2" \
    --body "$(jq -nc --argjson p "$4" '{payload:$p}')"
}

# ─────────────────────────────────────────────────────────────────────────────
# ejecutar_proceso <var> <token> <templateCode> <stepId:payload>...
#
# Recorre un proceso entero **exigiendo que el nextStep que anuncia el servidor
# sea el que el guion va a mandar**. Esa comprobación es el contrato de verdad
# del motor: un cliente genérico no consulta la plantilla, va detrás de
# nextStep, y una suite que mande los pasos de memoria no probaría eso nunca.
# ─────────────────────────────────────────────────────────────────────────────
# abrir_proceso <var> <token> <templateCode>
# Deja la instancia en la variable y en $PROC_SIGUIENTE el paso que el servidor
# pide a continuación.
abrir_proceso() {
  local -n inst_out="$1"
  local token="$2" code="$3"
  req POST /process-instances --token "$token" --body "$(jq -nc --arg c "$code" '{templateCode:$c}')"
  ok "$code · abre la instancia" 201
  inst_out="$(jqv '.instance.id')"
  PROC_SIGUIENTE="$(jqv '.nextStep.id // ""')"
}

# avanzar_proceso <instancia> <token> <etiqueta> <stepId:payload>...
# Recorre los pasos que se le den y para. No exige que el proceso termine: eso
# es lo que permite abandonar una instancia a la mitad, que es un caso real.
avanzar_proceso() {
  local inst="$1" token="$2" etq="$3"; shift 3
  local par id payload
  for par in "$@"; do
    id="${par%%:*}"; payload="${par#*:}"
    if [[ "$PROC_SIGUIENTE" != "$id" ]]; then
      falla_detalle "$etq · el servidor pedía «$PROC_SIGUIENTE» y el guion manda «$id»"
      return 1
    fi
    paso "$inst" "$token" "$id" "$payload"
    ok "$etq · $id" 200
    PROC_SIGUIENTE="$(jqv '.nextStep.id // ""')"
  done
  return 0
}

# ejecutar_proceso <var> <token> <templateCode> <stepId:payload>...
# El proceso entero, de punta a punta, y exige que termine: si el servidor
# sigue pidiendo algo cuando el guion se acabó, la plantilla cambió y esta
# suite tiene que enterarse.
ejecutar_proceso() {
  local -n inst_ref="$1"
  local token="$2" code="$3"; shift 3
  abrir_proceso inst_ref "$token" "$code"
  avanzar_proceso "$inst_ref" "$token" "$code" "$@" || return 1
  if [[ -n "$PROC_SIGUIENTE" ]]; then
    falla_detalle "$code · quedó pidiendo «$PROC_SIGUIENTE» y el guion se acabó"
    return 1
  fi
  return 0
}

# ═════════════════════════════════════════════════════════════════════════════
# CONCURRENCIA
#
# Lo único que no se puede fabricar con fastify.inject(): dos clientes de verdad
# a la vez sobre el mismo socket. Es donde viven la ventana de la idempotencia y
# la carrera por el último tornillo.
# ═════════════════════════════════════════════════════════════════════════════

# paralelo <n> -- <args de req>
# Lanza n peticiones idénticas a la vez y deja los estados en $PAR_ST[@].
paralelo() {
  local n="$1"; shift
  [[ "${1:-}" == -- ]] && shift
  local i pids=()
  PAR_ST=()
  for ((i = 0; i < n; i++)); do
    (
      BODY_F="$TMP/par.$i.body"; HDR_F="$TMP/par.$i.hdr"
      req "$@" --no-cov
      printf '%s' "$ST" > "$TMP/par.$i.st"
    ) &
    pids+=("$!")
  done
  wait "${pids[@]}" 2>/dev/null
  for ((i = 0; i < n; i++)); do PAR_ST+=("$(cat "$TMP/par.$i.st" 2>/dev/null)"); done
}

# reparto <descripción> <estado esperado>...
# «un 201 y un 409, en cualquier orden»: quién ganó la carrera no es parte del
# contrato, y una aserción que lo fije sería intermitente por construcción.
reparto() {
  local desc="$1"; shift
  local got want
  got="$(printf '%s\n' "${PAR_ST[@]}" | sort | tr '\n' ' ')"
  want="$(printf '%s\n' "$@" | sort | tr '\n' ' ')"
  if [[ "$got" == "$want" ]]; then pass "$desc"; else fail "$desc — llegaron [$got], esperaba [$want]"; fi
}

# reparto_legitimo <descripción> <alternativa>...
# Como `reparto`, pero admitiendo varias resoluciones. Una carrera de verdad no
# siempre se resuelve igual: si la primera petición terminó antes de que la
# segunda entrara, la segunda es un eco (201) y no un choque en vuelo (409), y
# las dos son correctas. Fijar una sola sería escribir una prueba intermitente
# por construcción y echarle después la culpa al sistema. Lo que no admite
# alternativa es el efecto, y eso se comprueba en el ledger.
reparto_legitimo() {
  local desc="$1"; shift
  local got alt want
  got="$(printf '%s\n' "${PAR_ST[@]}" | sort | tr '\n' ' ')"
  for alt in "$@"; do
    want="$(printf '%s\n' $alt | sort | tr '\n' ' ')"
    if [[ "$got" == "$want" ]]; then pass "$desc [${got% }]"; return; fi
  done
  fail "$desc — llegaron [${got% }] y no es ninguna forma legítima ($*)"
}

# par_body <índice> <filtro jq> — el cuerpo de una de las respuestas paralelas
par_body() { jq -r "$2" < "$TMP/par.$1.body" 2>/dev/null; }

# ═════════════════════════════════════════════════════════════════════════════
# LA BODEGA
# ═════════════════════════════════════════════════════════════════════════════

# nodo_de <var> <token> <code> [parentId] [kind]
nodo_de() {
  local -n dest="$1"
  local token="$2" code="$3" parent="${4:-}" kind="${5:-INTERNAL}" extra='{}'
  [[ -n "$parent" ]] && extra="$(jq -nc --arg p "$parent" '{parentId:$p}')"
  req POST /nodes --token "$token" \
    --body "$(jq -nc --arg c "$code" --arg k "$kind" --argjson e "$extra" '{kind:$k, code:$c, name:$c} + $e')"
  dest="$(jqv '.id')"
}

# frontera_de <var> <token> <kind> <code> — los ocho que siembra la organización
frontera_de() {
  local -n dest="$1"
  req GET "/nodes?kind=$3&limit=50" --token "$2" --no-cov
  dest="$(jq -r --arg c "$4" '[.data[] | select(.code==$c)][0].id' < "$BODY_F")"
}

# saldo <token> <nodeId> <productId> [batchId] — en milésimas, 0 si no hay fila
saldo() {
  local token="$1" n="$2" p="$3" b="${4:-}"
  req GET "/stock?nodeId=$n&productId=$p&nonZeroOnly=false&limit=200" --token "$token" --no-cov
  jq -r --arg b "$b" "$JQ_MILI"'
    [.data[] | select(($b == "") or (.batchId == $b))]
    | map(.quantity | mili) | add // 0' < "$BODY_F"
}

# saldo_es <descripción> <token> <nodeId> <productId> <esperado> [batchId]
saldo_es() {
  local got want
  got="$(saldo "$2" "$3" "$4" "${6:-}")"
  want="$(jq -rn --arg q "$5" "$JQ_MILI"'$q | mili')"
  if [[ -z "$got" || -z "$want" ]]; then fail "$1 — no salió número (got=«$got» want=«$want»)"; return; fi
  if [[ "$got" == "$want" ]]; then pass "$1"; else fail "$1 — hay $got milésimas, esperaba $want"; fi
}

# subir_foto <var> <token> — el PNG de un píxel a la zona de espera
subir_foto() {
  local -n dest="$1"
  local png="$TMP/pixel.png"
  [[ -s "$png" ]] || printf 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==' | base64 -d > "$png"
  req POST /uploads --token "$2" --file "$png:image/png"
  dest="$(jqv '.storageKey')"
}

# ahora [desplazamiento] — ISO 8601 en milisegundos, como los manda el contrato.
# `date -d` acepta "-3 days", "+2 hours"; sin argumento, este instante.
ahora() { date -u -d "${1:-now}" +%Y-%m-%dT%H:%M:%S.000Z; }
