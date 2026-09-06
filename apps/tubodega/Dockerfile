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

# ------------------------------------------------------------- runtime
FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production \
    PORT=3000
WORKDIR /app

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
# Carries "type": "module", without which Node would read the ESM bundle as CJS.
COPY package.json ./

USER node
EXPOSE 3000

# 127.0.0.1, never localhost: BusyBox wget resolves localhost to [::1] while
# the app binds IPv4 0.0.0.0.
HEALTHCHECK --interval=10s --timeout=3s --start-period=15s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/v1/openapi.json || exit 1

CMD ["node", "dist/apps/tubodega/main.js"]
