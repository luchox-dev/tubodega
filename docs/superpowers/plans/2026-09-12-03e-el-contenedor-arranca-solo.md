# El contenedor arranca solo — plan 3e (derivado)

> Fase **F6.6** del [plan maestro](2026-09-06-00-plan-maestro-mvp.md), adelantada
> desde el plan 10. Cierra lo que el README venía documentando como pendiente:
> «el entrypoint con `migrate deploy` —y el `env_file` que ahorraría todo lo
> anterior— llegan en el plan 10».

## El problema

`docker compose up --build` abortaba. El servicio `tubodega` recibía `NODE_ENV`
y `PORT`, y `env.validation.ts` exige cuatro variables sin valor por defecto: las
tres cadenas de conexión y un `JWT_SECRET` de 32 caracteres. El fallo ocurría
dentro de `NestFactory.create`, antes del `listen`, y `restart: unless-stopped`
lo convertía en un bucle que además escondía el error en el log.

Pero arreglar solo el entorno no habría bastado para que funcionara *a la
primera*: sobre un volumen limpio la base no tiene tablas, y la aplicación
habría arrancado tan contenta para devolver `500` en cada petición.

## Lo que se hizo

Cinco cambios, y ninguno es el que decía la entrega original de F6.6.

**Un init container en vez de un entrypoint.** El spec 04 §5 decía que `prisma
migrate deploy` sería «el primer paso del entrypoint del contenedor». Habría
obligado a meter el CLI de Prisma, `prisma.config.ts` y las migraciones dentro
de la imagen que corre en producción — justo lo que ese mismo spec quiere
evitar. En su lugar, un servicio `migrate` de un disparo que `tubodega` espera
con `condition: service_completed_successfully`. Mismas migraciones, mismo rol,
mismo advisory lock, y la etapa `runtime` sin una sola línea de Prisma. El spec
04 §5 se corrigió para decirlo.

**Una etapa `migrate` en el Dockerfile**, entre `prod-deps` y `runtime`. Parte
de `deps` porque el CLI de Prisma es `devDependency`, y lleva cuatro cosas:
`package.json`, `pnpm-workspace.yaml`, `prisma.config.ts` y
`libs/persistence/prisma`. No compila la aplicación a propósito: el esquema es
lo que sobrevive al código, así que un rspack roto no debe dejarte sin poder
migrar. Va **antes** de `runtime` porque si fuera la última etapa del fichero, el
`target` por defecto de `docker build` dejaría de ser la aplicación.

`prisma.config.ts` no es opcional: el `datasource db` de `schema.prisma` **no
declara `url`**, así que sin el config Prisma no sabe ni dónde está el esquema ni
contra qué base conectarse. Y no hace falta ningún loader de TypeScript extra:
lo aporta `@prisma/config` vía `c12` → `jiti`.

**`.env.docker`, versionado.** No hay un solo secreto real dentro. `.gitignore`
lista rutas concretas (`.env`, `.env.local`, `.env.*.local`), no un glob, así que
no hubo que tocarlo.

**Una base propia, `tubodega_docker`.** El contenedor y `pnpm start:dev`
compartían `tubodega` pero guardan las fotos en sitios distintos —un volumen y
`./.media`—, de modo que una foto subida por uno tenía fila que el otro veía y
fichero que no encontraba. Una línea en `db/init/01-roles.sql`.

**Puertos parametrizados**, `${APP_PORT:-3000}` y `${DB_PORT:-5432}`, para poder
levantar la pila sin apagar el servidor de desarrollo.

## Los dos fallos que no se veían desde fuera

Los dos habrían pasado la revisión de un vistazo, y los dos rompen exactamente
el caso que este plan promete: el arranque en frío.

### La carrera del healthcheck

`pg_isready -U postgres` conecta por el **socket unix**. Mientras inicializa un
volumen vacío, el entrypoint oficial de Postgres levanta un servidor temporal
con `listen_addresses=''` —solo socket— para correr los scripts de
`/docker-entrypoint-initdb.d`, y solo después arranca el definitivo con TCP. El
`psql` que ejecuta `01-roles.sql` usa ese mismo socket: si él puede, `pg_isready`
también. La sonda contestaba que sí **con los roles a medio crear**, compose daba
el servicio por sano, `migrate` arrancaba y su conexión TCP a `db:5432` era
rechazada. Y las migraciones dependen duramente de esos roles: `0001_tenancy`
hace `GRANT … TO tubodega_app, tubodega_system`.

Se cierra con `-h 127.0.0.1`: solo el servidor definitivo escucha en TCP, y
arranca cuando el init ha terminado. Añadir `-d tubodega_docker` no habría
aportado nada — `pg_isready` usa `PQping`, que no llega a conectarse y devuelve 0
aunque la base no exista.

En CI no se veía porque un *service container* de GitHub Actions no puede montar
`docker-entrypoint-initdb.d`: el workflow corre ese SQL a mano, y sin scripts de
init la ventana no existe. El healthcheck estaba copiado de un sitio donde el
fallo era imposible.

### El dueño del volumen de fotos

`MEDIA_ROOT` por defecto es `.media`, relativo, y `DiskMediaStorage` lo resuelve
con `resolve()` contra el `cwd`, que en el contenedor es `/app` — creado
`root:root` por `WORKDIR`, con el proceso corriendo como `node`. El primer
`POST /v1/uploads` habría muerto con `EACCES`. Fallaba ya, sin volumen de por
medio.

El `mkdir -p /app/media && chown node:node /app/media` va antes de `USER node`, y
no es higiene: **un volumen nombrado vacío hereda dueño y modo del directorio que
tapa**. Si el directorio no existe en la imagen, Docker lo crea `root:root`. El
`chown` no configura el contenedor, configura la plantilla de la que el volumen
copia sus permisos al nacer — y solo lo hace al nacer, así que arreglar la imagen
no arregla un volumen que ya existe. De ahí que probar «volumen limpio» de verdad
sea `docker compose down -v`.

## Un tercer fallo, destapado por la verificación

La única aserción de la caja negra que habla SQL —el `REVOKE` sobre `movement`,
I-3— tenía `-d tubodega` fijo. Corriendo contra la pila de compose comprobaba la
base de desarrollo mientras el servidor bajo prueba era otro: habría salido verde
sin haber mirado nada. Ahora es `$DB`, con el mismo valor por defecto de siempre
y la misma convención que `$BASE`.

Apareció porque el `down -v` dejó vacía la base de desarrollo y la comprobación
falló con `relation "movement" does not exist` en vez de con el `42501` que
esperaba. Un entorno roto enseñó que la prueba miraba al sitio equivocado.

## Verificación

Desde `docker compose down -v`, con volumen limpio:

```
migrate            Exited (0), las tres migraciones aplicadas
tubodega           Up (healthy) en 1 s
tubodega_docker    21 tablas, 3 filas en _prisma_migrations
/app/media         drwxr-xr-x node node   →  ESCRIBIBLE
POST /v1/organizations, login y /me        →  correctos
caja negra contra el contenedor            →  249 ok, 0 fallos, cobertura 30/30
segundo `up`                               →  "No pending migrations to apply."
`down` (sin -v) y `up`                     →  datos y fotos intactos
```

Y tras restaurar el entorno de desarrollo con `pnpm db:migrate`, las seis
puertas: `lint`, `typecheck`, `db:check`, 339 pruebas, 176 e2e y 249
comprobaciones de caja negra.

De paso quedó aclarado un número que el repositorio contaba de dos maneras: son
**248 comprobaciones sin `JWT_SECRET` exportado y 249 con él** — la de más es el
`401 token-expired`, la única que necesita saber algo del interior del servidor.

## Lo que sigue pendiente

Cuatro cosas, encontradas aquí y deliberadamente fuera de alcance:

- `DATABASE_URL_MIGRATOR` sigue siendo obligatoria para la aplicación, que ya no
  migra nada: le inyectamos credenciales de dueño de la base a un proceso que
  corre como `tubodega_app` a propósito. Hacerla `@IsOptional()` es una línea,
  pero toca CI y las pruebas.
- `allowBuilds: '@prisma/engines'` descarga un `schema-engine` nativo que
  `migrate deploy` no usa: Prisma 7.10 lleva el motor en WASM.
- `OutboxDispatcherJob` usa `setInterval` sin guarda de reentrada, contra un pool
  `system` de 3 sin `connectionTimeoutMillis`.
- `main.ts` no llama a `enableShutdownHooks()`, así que
  `KyselyFactory.onModuleDestroy` nunca corre en un `docker compose down`.
