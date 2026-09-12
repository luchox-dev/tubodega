#!/usr/bin/env bash
# Caja negra completa: las tres suites contra un servidor de verdad, y el cruce
# que dice si quedó alguna operación del contrato sin tocar.
#
# No sustituye a `pnpm test:e2e`, lo complementa: la suite corre en proceso con
# fastify.inject(), que fabrica la petición en memoria; esto atraviesa un socket.
# El 413 de una foto de 11 MB es el ejemplo que costó descubrir —@fastify/multipart
# corta el archivo mientras lo transmite y avisa lanzando un FastifyError— y en
# proceso no se veía.
#
#   pnpm start:dev                 # en otra terminal
#   ./scripts/blackbox.sh
#   BASE=http://otra-maquina:3000 ./scripts/blackbox.sh
#   ./scripts/blackbox.sh --only tenencia
#
# Exporta JWT_SECRET si quieres que corra además la comprobación del token
# caducado, la única que necesita saber algo del interior del servidor.
set -uo pipefail

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export BASE="${BASE:-http://localhost:3000}"
SOLO=''

while (($#)); do
  case "$1" in
    --only) SOLO="$2"; shift 2 ;;
    -h|--help) sed -n '2,18p' "${BASH_SOURCE[0]}" | sed 's/^# \?//'; exit 0 ;;
    *) echo "opción desconocida: $1" >&2; exit 2 ;;
  esac
done

command -v jq   >/dev/null || { echo "hace falta jq"; exit 2; }
command -v curl >/dev/null || { echo "hace falta curl"; exit 2; }

if ! curl -sS -o /dev/null --max-time 5 "$BASE/v1/openapi.json"; then
  echo "No hay nadie en $BASE. Arranca con \`pnpm start:dev\`." >&2
  exit 2
fi

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
# Las suites anotan aquí lo que piden y cómo les responde: es lo que permite
# cruzar la cobertura al final sin que nadie mantenga una lista a mano.
export BB_COV="$TMP/cobertura"
: > "$BB_COV"; : > "$BB_COV.resultados"

CORRIDAS=0
for suite in "$AQUI"/blackbox/[0-9]*.sh; do
  nombre="$(basename "$suite" .sh)"; nombre="${nombre#*-}"
  [[ -n "$SOLO" && "$nombre" != "$SOLO" ]] && continue
  CORRIDAS=$((CORRIDAS + 1))
  printf '\n\033[1m══ %s ══\033[0m\n' "$nombre"
  bash "$suite"
done

if ((CORRIDAS == 0)); then
  echo "Ninguna suite se llama «$SOLO». Hay: $(cd "$AQUI/blackbox" && ls [0-9]*.sh | sed 's/^[0-9]*-//;s/\.sh$//' | tr '\n' ' ')" >&2
  exit 2
fi

# ═════════════════════════════════════════════════════════════════════════════
printf '\n\033[1m═══ resumen ═══\033[0m\n'
TOTAL_OK=0; TOTAL_BAD=0
while IFS=$'\t' read -r nombre o b; do
  printf '  %-14s %4d ok   %3d fallos\n' "$nombre" "$o" "$b"
  TOTAL_OK=$((TOTAL_OK + o)); TOTAL_BAD=$((TOTAL_BAD + b))
done < "$BB_COV.resultados"
printf '  %-14s %4d ok   %3d fallos\n' 'TOTAL' "$TOTAL_OK" "$TOTAL_BAD"

# ═════════════════════════════════════════════════════════════════════════════
# «Completo» no es una palabra: es este cruce. El inventario sale del contrato
# publicado, y de cada operación se exige lo que pide spec 06 §6 — al menos un
# camino feliz y uno de error.
printf '\n\033[1m═══ cobertura del contrato ═══\033[0m\n'
curl -sS "$BASE/v1/openapi.json" -o "$TMP/openapi.json"

# GET /v1/openapi.json lleva @ApiExcludeEndpoint() y no aparece en su propio
# documento; se añade a mano porque existe y se puede pedir.
{ jq -r '.paths | to_entries[] | .key as $p | (.value | keys[] | "\(.|ascii_upcase)\t\($p)")' "$TMP/openapi.json"
  printf 'GET\t/v1/openapi.json\n'; } | sort -u > "$TMP/inventario"

# La única operación sin camino de error posible: es @Public(), así que no da
# 401; no toma parámetros ni cuerpo, así que no da 400; y no hay recurso que
# no encontrar. Exigirle un 4xx sería exigir un error que no existe.
SIN_ERROR_POSIBLE=('GET /v1/openapi.json')

SIN_TOCAR=(); SIN_FELIZ=(); SIN_ERROR=()
while IFS=$'\t' read -r m ruta; do
  estados="$(awk -F'\t' -v m="$m" -v r="$ruta" '$1==m && $2==r {print $3}' "$BB_COV")"
  if [[ -z "$estados" ]]; then
    SIN_TOCAR+=("$m $ruta")
    continue
  fi
  grep -qE '^2[0-9][0-9]$' <<<"$estados" || SIN_FELIZ+=("$m $ruta")
  if ! grep -qE '^[45][0-9][0-9]$' <<<"$estados"; then
    exento=0
    for e in "${SIN_ERROR_POSIBLE[@]}"; do [[ "$m $ruta" == "$e" ]] && exento=1; done
    ((exento)) || SIN_ERROR+=("$m $ruta")
  fi
done < "$TMP/inventario"

TOTAL_OPS="$(wc -l < "$TMP/inventario")"
TOCADAS=$((TOTAL_OPS - ${#SIN_TOCAR[@]}))
printf '  operaciones del contrato: %d\n' "$TOTAL_OPS"
printf '  ejercitadas:              %d\n' "$TOCADAS"
printf '  con camino feliz:         %d\n' "$((TOTAL_OPS - ${#SIN_TOCAR[@]} - ${#SIN_FELIZ[@]}))"
printf '  con camino de error:      %d  (%d sin error posible)\n' \
  "$((TOTAL_OPS - ${#SIN_TOCAR[@]} - ${#SIN_ERROR[@]}))" "${#SIN_ERROR_POSIBLE[@]}"

lista() { printf '\n  %s\n' "$1"; printf '    %s\n' "${@:2}"; }
HUECOS=0
((${#SIN_TOCAR[@]})) && { lista 'sin ejercitar:'            "${SIN_TOCAR[@]}"; HUECOS=1; }
((${#SIN_FELIZ[@]}))  && { lista 'sin camino feliz (2xx):'  "${SIN_FELIZ[@]}";  HUECOS=1; }
((${#SIN_ERROR[@]}))  && { lista 'sin camino de error:'     "${SIN_ERROR[@]}";  HUECOS=1; }

if ((HUECOS)) && [[ -z "$SOLO" ]]; then
  printf '\n  El contrato no está cubierto entero (spec 06 §6).\n'
  exit 1
fi
((HUECOS)) && printf '\n  (con --only la cobertura es parcial por definición; no cuenta como fallo)\n'

[[ "$TOTAL_BAD" -eq 0 ]] || exit 1
