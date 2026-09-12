# Ayudantes de las suites de caja negra. Se hace `source` desde cada suite y
# desde el runner; no se ejecuta por sí solo.
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
