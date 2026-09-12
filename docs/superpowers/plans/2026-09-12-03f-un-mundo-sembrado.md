# Un mundo sembrado, cuando haga falta — plan 3f (derivado)

> Continuación del [plan 3e](2026-09-12-03e-el-contenedor-arranca-solo.md): la
> pila arrancaba, pero sobre una base vacía.

## El problema

`docker compose up --build` dejaba la base migrada y la aplicación respondiendo
—y sin una sola fila. Para probar cualquier cosa interesante había que construir
antes la organización, el equipo, los campos propios y el catálogo: ocho o diez
peticiones de andamiaje antes de llegar a lo que uno quería mirar.

## Lo que se hizo

`pnpm seed`, y el mismo guion detrás de un perfil de compose:

```bash
pnpm seed                            # contra pnpm start:dev
docker compose --profile seed up     # dentro de la red de compose
SEED_SLUG=otra-esquina pnpm seed     # un segundo mundo, independiente
```

Siembra el reparto narrativo que el plan maestro §5 llevaba definido desde el
principio: Distribuidora La Esquina, Marta (OWNER), Diego (ADMIN), Juan
(OPERATOR) y Sofía (VIEWER), dos campos propios, los cuatro SKU canónicos
—`TOR-M8`, `ARROZ-25`, `LECHE-1L`, `TAL-BOSCH`—, el código de barras del
tornillo, el lote de leche con su vencimiento y la serie del taladro. Con eso
`GET /v1/codes/{value}/resolve` ya tiene algo que resolver, que es la prueba de
que el mundo sirve para algo y no es decorado.

## Las tres decisiones que importan

### Por HTTP, no contra la base

Era la decisión de fondo. Sembrar por SQL habría entrado literal en «después de
las migraciones» y habría sido más rápido, pero obligaba a reimplementar el hash
argon2, los UUIDv7, las columnas `version` y los eventos de outbox, saltándose
RLS y el dominio entero — y podía crear estados que la aplicación nunca
permitiría. El spec 06 §6 ya tenía la respuesta escrita para las pruebas: «si
algo no se puede montar por la API, es que a la API le falta algo». El precedente
del repositorio para un estado inalcanzable no es sembrar por detrás, es ampliar
el contrato, como hace `POST /v1/alerts/evaluate` con `at`.

Además, un hecho que cerraba la puerta: **Prisma 7 no ejecuta seeds en `migrate
deploy`**. El campo `migrations.seed` existe en `prisma.config.ts`, pero solo lo
consume `prisma db seed`; y la etapa `migrate` del Dockerfile no lleva `dist/`,
así que tampoco podría invocar los casos de uso reales.

El precio es el orden: `db` → `migrate` → `tubodega` sano → `seed`. Sigue siendo
después de las migraciones, pero también después de la aplicación. El servicio
espera a `tubodega: service_healthy` y no a `migrate`, porque el healthcheck ya
prueba que el contrato responde, y eso implica que las migraciones corrieron.

### Un perfil, no una variable

`profiles: ["seed"]` es el mecanismo de compose para «opcional»: un
`docker compose up` a secas ni crea el servicio. Verificado —`docker compose
config --services` devuelve tres nombres sin el perfil y cuatro con él—. Una
variable de entorno habría dejado el servicio existiendo siempre, con una rama
condicional dentro y más fácil de olvidar encendida.

### Idempotente, y con mundos paralelos

El slug es fijo (`la-esquina-demo`) porque la gracia de un seed es volver mañana
y entrar con las mismas credenciales. Si ya existe, `POST /v1/organizations`
devuelve `409 slug-taken`, el guion lo dice y sale con 0 sin tocar nada:
re-sembrar a medias chocaría contra la unicidad de códigos (C-2), series (C-5) y
lotes (C-6). `SEED_SLUG` siembra otro mundo entero al lado.

## Lo que NO se tocó

`ORG_SEEDERS` y `CompositeOrgProvisioner`. Es un mecanismo distinto —siembra
*por organización*, dentro de la transacción de alta, para los nodos de frontera,
las plantillas de fábrica y las reglas de alerta (decisión D-2, planes 4, 8 y
9)— y meter datos de demo ahí los colaría en **toda** organización creada, también
en producción. Comparten la palabra «seed» y no comparten nada más.

## La regla de mantenimiento

Es la mitad del encargo, y el repositorio ya tenía la frase exacta para la
colección de Postman: «se actualiza en cada plan que añada endpoints». El seed la
hereda, escrita en cuatro sitios para que no se caiga: la cabecera de
`scripts/seed.sh`, la sección «Datos de ejemplo» del README, la frase de Postman
—que ahora nombra a los dos— y las **reglas de la división del plan maestro §8**,
que es lo único que un ejecutor de plan lee siempre.

Un seed que se queda atrás es peor que no tenerlo: aparenta un mundo completo
mientras le falta justo lo que acabas de construir. Por eso el README y la
cabecera del guion llevan la lista de lo que todavía no puede sembrar, con el
plan que lo traerá: ubicaciones (4), movimientos (6), procesos (8), alertas (9).

## Una nota de estilo que cambió el diseño

`alta()` de `lib.sh` compone el correo a partir del nombre (`juan-$SLUG@…`), que
para una suite está bien porque a nadie le importa cómo se llame el usuario. Para
un seed que una persona va a leer sí importa: los nombres salían en minúscula, y
«Sofía» con tilde no tiene sitio en la parte local de un correo. La siembra pide
nombre y correo por separado con su propio `persona()`, y de paso deja de
depender de la convención de correos de `lib.sh`.

## Verificación

```
pnpm seed                            16 aciertos, 0 fallos
pnpm seed (otra vez)                 "ya está sembrado", exit 0, sin tocar nada
SEED_SLUG=otra-esquina               16 aciertos, un mundo independiente
docker compose up (sin perfil)       db, migrate, tubodega — el servicio seed NI SE CREA
docker compose --profile seed up     db sano → migrate → tubodega sano → seed, exit 0
por el contrato                      4 productos, 4 personas con sus 4 roles,
                                     7501000000017 → TOR-M8, BSH-001 → TAL-BOSCH/serie
caja negra con el mundo al lado      249 ok, 0 fallos, cobertura 30/30
```

Esa última línea era la que había que vigilar: las tres suites se construyen su
propio mundo con slug aleatorio, así que un mundo sembrado al lado no debe
afectarlas ni al cruce de cobertura del runner.

## Un segundo consumidor para `lib.sh`

`scripts/seed.sh` hace `source` de `scripts/blackbox/lib.sh`, que pasa a tener
dos consumidores: un cambio en `req` o en `alta` puede romper la siembra además
de las suites. Es deliberado —la alternativa era un segundo cliente HTTP en
shell, duplicado y divergente— y su cabecera, que decía ser solo de la caja
negra, ahora lo advierte.
