# tubodega

A NestJS **monorepo** on **pnpm**, serving over **Fastify**, compiled with **SWC**.

## Layout

```
apps/
  tubodega/          # the HTTP application
    src/
    test/            # e2e specs
    Dockerfile
libs/
  common/            # shared code, imported as @app/common
    src/
      config/env.validation.ts
```

One root `package.json` and one `node_modules` — this is Nest's native monorepo
mode, not a pnpm workspace. `pnpm-workspace.yaml` exists only because pnpm 12
reads its *settings* from there; it deliberately has no `packages:` key.

## Commands

| Command | Does |
|---|---|
| `pnpm start:dev` | run `tubodega` with watch mode |
| `pnpm build` | bundle to `dist/apps/tubodega/main.js` |
| `pnpm start:prod` | run the built bundle |
| `pnpm typecheck` | `tsc --noEmit` over apps + libs (see below) |
| `pnpm test` / `pnpm test:e2e` | vitest, unit / e2e |
| `pnpm lint` | oxlint |

## How SWC is wired

SWC compiles **both** paths, but they are configured in different places:

- **Build** — `nest-cli.json` uses `"builder": "rspack"`, and Rspack compiles
  TypeScript with `builtin:swc-loader` (`legacyDecorator` + `decoratorMetadata`,
  which is what makes Nest's constructor injection resolvable by type). Those
  options come from `@nestjs/cli`'s rspack defaults, so there is no local SWC
  config file for the build — adding one would be dead config that nothing reads.
  The rspack builder needs `@rspack/core`, `webpack-node-externals` and
  `tsconfig-paths-webpack-plugin`; the CLI selects the builder but does not
  install them, so they are explicit devDependencies here.
- **Tests** — `vitest.config.ts` / `vitest.config.e2e.ts` use `unplugin-swc`, so
  specs compile through SWC instead of vitest's default esbuild, matching the
  build's decorator semantics.

## Type checking

`swc-loader` strips types without checking them, so type errors cannot fail the
build. `pnpm typecheck` is the real gate, via `tsconfig.typecheck.json` (a
non-composite, `noEmit` project covering apps, libs and specs — the per-project
`tsconfig.*.json` files exclude specs and cannot disable emit).

Note the path alias is mapped to the barrel **file**:

```jsonc
"@app/common": ["./libs/common/src/index.ts"]
```

Under `moduleResolution: "nodenext"` a directory target does not index-resolve,
so the alias must name `index.ts` explicitly. Rspack's `TsconfigPathsPlugin`
resolves a directory fine, which means a directory mapping builds and runs but
fails `tsc`.

## Configuration

Environment variables are validated at boot by
`libs/common/src/config/env.validation.ts` and wired through
`ConfigModule.forRoot({ validate })`. An invalid value aborts startup rather
than surfacing later:

```
$ PORT=not-a-number pnpm start:prod
Error: Invalid environment variables:
  - PORT must be an integer number
```

Copy `.env.example` to `.env` for local runs.

## Docker

```bash
docker compose up --build
curl http://127.0.0.1:3000/
```

The healthcheck uses `127.0.0.1`, not `localhost`: BusyBox `wget` on Alpine
resolves `localhost` to `[::1]` while the app binds IPv4 `0.0.0.0`. For the same
reason `main.ts` passes `'0.0.0.0'` to `app.listen` — Nest's Fastify adapter
otherwise binds `127.0.0.1` and would be unreachable from outside the container.
