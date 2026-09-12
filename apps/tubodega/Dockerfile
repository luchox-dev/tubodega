# Build context is the repository root:
#   docker build -f apps/tubodega/Dockerfile .
ARG NODE_IMAGE=node:26-alpine

# ---------------------------------------------------------------- base
FROM ${NODE_IMAGE} AS base
# Pinned to match the version in package.json "packageManager". Installed
# directly rather than via corepack, which is no longer dependable in recent
# Node distributions.
RUN npm i -g pnpm@12.3.4
WORKDIR /app

# ---------------------------------------------------------------- deps
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

# --------------------------------------------------------------- build
FROM base AS build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY --from=deps /app/node_modules ./node_modules
COPY tsconfig.json tsconfig.typecheck.json nest-cli.json ./
COPY apps ./apps
COPY libs ./libs
RUN pnpm build

# ---------------------------------------------------------- prod-deps
# rspack externalizes node_modules (webpack-node-externals), so the bundle
# still needs the runtime dependencies present.
FROM base AS prod-deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --prod

# ------------------------------------------------------------- migrate
# The one-shot init container of compose.yaml, not part of the production image:
# `runtime` stays without Prisma, without the schema and without migrations,
# which is what 04 §5 asks for.
#
# Builds on `deps` and not on `prod-deps` because the Prisma CLI, dotenv and
# prisma-kysely are devDependencies. It needs exactly three things from the
# repository: package.json (where the db:deploy script lives), prisma.config.ts
# -- in Prisma 7 the datasource of schema.prisma declares no url, so the config
# is what carries both it and the path to the schema, and it must sit at the
# root for its relative paths to resolve -- and the migrations directory.
#
# It does not compile the application on purpose: the schema is what outlives
# the code, so a broken rspack must not leave you unable to migrate.
FROM base AS migrate
COPY --from=deps /app/node_modules ./node_modules
COPY package.json pnpm-workspace.yaml prisma.config.ts ./
COPY libs/persistence/prisma ./libs/persistence/prisma
CMD ["pnpm", "db:deploy"]

# ------------------------------------------------------------- runtime
FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production \
    PORT=3000 \
    MEDIA_ROOT=/app/media
WORKDIR /app

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
# Carries "type": "module", without which Node would read the ESM bundle as CJS.
COPY package.json ./

# The photo directory, created and handed over while we are still root. Two
# reasons, and both are blocking:
#   - DiskMediaStorage resolves MEDIA_ROOT against process.cwd(), which is /app,
#     created root:root 0755 by WORKDIR: `node` cannot mkdir inside it and the
#     first POST /v1/uploads would die with EACCES;
#   - an empty named volume inherits owner and mode from the directory it
#     covers, so this chown is what makes the compose volume be born owned by
#     `node` instead of root. It happens once, when the volume is created.
RUN mkdir -p /app/media && chown node:node /app/media

USER node
EXPOSE 3000

# 127.0.0.1, never localhost: BusyBox wget resolves localhost to [::1] while
# the app binds IPv4 0.0.0.0.
HEALTHCHECK --interval=10s --timeout=3s --start-period=15s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/v1/openapi.json || exit 1

CMD ["node", "dist/apps/tubodega/main.js"]
