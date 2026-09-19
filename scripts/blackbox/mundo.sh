# El prólogo común de los escenarios del plan 8c: una organización con su
# equipo, su bodega dibujada y su catálogo. Setenta líneas idénticas en siete
# ficheros son siete sitios donde arreglar el día que cambie el contrato.
#
# NO lleva prefijo numérico a propósito: el runner descubre las suites con
# blackbox/[0-9]*.sh, así que un fichero numerado aquí dentro se ejecutaría como
# suite y montaría un mundo sin comprobar nada. Es la misma razón por la que
# scripts/seed.sh vive un directorio más arriba.

# montar_mundo <prefijo>
#
# Deja puestas, para quien lo llame:
#   SLUG · MARTA                        la organización y el correo de la dueña
#   T_OWNER T_DIEGO T_JUAN T_SOFIA      OWNER · ADMIN · OPERATOR · VIEWER
#   MUELLE BODA Z1 E3 B2 B3             el árbol interno (B2 y B3 cuelgan de E3)
#   SUPPLIER OPENING ADJ_IN             las tres fronteras SOURCE
#   SALE CONSUMO SHRINK ADJ_OUT DEVOL   las cinco fronteras TERMINAL
#   P_TOR P_LECHE P_TALADRO             QUANTITY · LOT · SERIAL
#   EAN_TOR EAN_LECHE                   códigos para poder escanear
montar_mundo() {
  SLUG="${1}-$(date +%s)-$RANDOM"
  MARTA="marta-$SLUG@esquina.co"

  step "0 · la casa: organización, equipo, bodega y catálogo"
  req POST /organizations --idem none --body "$(jq -nc --arg s "$SLUG" --arg e "$MARTA" --arg p "$PASSWORD" \
    '{name:"Distribuidora La Esquina", slug:$s, owner:{email:$e, name:"Marta", password:$p}}')"
  ok "Marta registra la organización" 201

  req POST /auth/login --idem none --body "$(jq -nc --arg e "$MARTA" --arg p "$PASSWORD" --arg s "$SLUG" \
    '{email:$e, password:$p, slug:$s}')"
  ok "y entra" 200
  T_OWNER="$(jqv '.accessToken')"
  alta T_DIEGO ADMIN diego
  alta T_JUAN OPERATOR juan
  alta T_SOFIA VIEWER sofia

  # El árbol. B2 y B3 cuelgan de E3 para que el traslado del plan tenga dos
  # hojas hermanas y `?under=` tenga algo que agregar.
  nodo_de MUELLE "$T_DIEGO" MUELLE
  nodo_de BODA   "$T_DIEGO" BOD-A
  nodo_de Z1     "$T_DIEGO" Z1 "$BODA"
  nodo_de E3     "$T_DIEGO" E3 "$Z1"
  nodo_de B2     "$T_DIEGO" B2 "$E3"
  nodo_de B3     "$T_DIEGO" B3 "$E3"
  ok "Diego dibuja la bodega" 201

  # Las ocho de frontera las sembró el alta de la organización (D-2): nadie las
  # crea, se localizan por su código.
  frontera_de SUPPLIER "$T_DIEGO" SOURCE   supplier-default
  frontera_de OPENING  "$T_DIEGO" SOURCE   opening-balance
  frontera_de ADJ_IN   "$T_DIEGO" SOURCE   adjustment-in
  frontera_de SALE     "$T_DIEGO" TERMINAL sale
  frontera_de CONSUMO  "$T_DIEGO" TERMINAL consumption
  frontera_de SHRINK   "$T_DIEGO" TERMINAL shrinkage
  frontera_de ADJ_OUT  "$T_DIEGO" TERMINAL adjustment-out
  frontera_de DEVOL    "$T_DIEGO" TERMINAL supplier-return

  # Los tres modos de seguimiento, que son tres reglas distintas del ledger.
  req POST /products --token "$T_DIEGO" \
    --body '{"sku":"TOR-M8","name":"Tornillo M8","trackingMode":"QUANTITY","uom":"UNIT"}'
  ok "el tornillo, que va por cantidad" 201
  P_TOR="$(jqv '.id')"

  req POST /products --token "$T_DIEGO" \
    --body '{"sku":"LECHE-1L","name":"Leche entera 1L","trackingMode":"LOT","uom":"L"}'
  ok "la leche, que va por lote" 201
  P_LECHE="$(jqv '.id')"

  req POST /products --token "$T_DIEGO" \
    --body '{"sku":"TAL-18V","name":"Taladro 18V","trackingMode":"SERIAL","uom":"UNIT"}'
  ok "el taladro, que va por serie" 201
  P_TALADRO="$(jqv '.id')"

  EAN_TOR="770$(printf '%07d' $((RANDOM * 30 + RANDOM)))"
  EAN_LECHE="771$(printf '%07d' $((RANDOM * 30 + RANDOM)))"
  req POST "/products/$P_TOR/codes" --token "$T_DIEGO" --body "$(jq -nc --arg v "$EAN_TOR" '{value:$v, kind:"EAN"}')"
  ok "el tornillo gana su código de barras" 201
  req POST "/products/$P_LECHE/codes" --token "$T_DIEGO" --body "$(jq -nc --arg v "$EAN_LECHE" '{value:$v, kind:"EAN"}')"
  ok "y la leche el suyo" 201
}
