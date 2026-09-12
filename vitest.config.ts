import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import swc from 'unplugin-swc';

const lib = (name: string) => fileURLToPath(new URL(`./libs/${name}/src/index.ts`, import.meta.url));

export default defineConfig({
  // SWC (not the default esbuild) so tests compile decorators exactly the way
  // the rspack/SWC build does — `decoratorMetadata` is what makes Nest's
  // constructor injection resolvable by type.
  plugins: [swc.vite()],
  resolve: {
    // Explicit aliases: tsconfig-based resolution would skip test files that
    // the nearest libs/*/tsconfig.lib.json excludes. Keep in sync with
    // tsconfig.json "paths" (one barrel file per library).
    alias: {
      '@app/common': lib('common'),
      '@app/catalog': lib('catalog'),
      '@app/inventory': lib('inventory'),
      '@app/process': lib('process'),
      '@app/persistence': lib('persistence'),
      '@app/tenancy': lib('tenancy'),
    },
  },
  test: {
    globals: true,
    root: './',
    include: ['**/*.spec.ts'],
    coverage: {
      provider: 'v8',
      include: ['libs/*/src/**/*.ts', 'apps/tubodega/src/**/*.ts'],
      exclude: ['**/*.spec.ts', '**/generated/**', '**/index.ts', '**/*.module.ts', 'apps/tubodega/src/main.ts'],
      // Floors of docs/specs/06 §9, activated per directory as each lands (decision D-15).
      thresholds: {
        'libs/tenancy/src/domain/**': { lines: 95, branches: 95, functions: 95, statements: 95 },
        'libs/catalog/src/domain/**': { lines: 95, branches: 95, functions: 95, statements: 95 },
        'libs/catalog/src/application/**': { lines: 90, branches: 90, functions: 90, statements: 90 },
        // 100 %, and it starts here: F2.5 says so twice (decision D-15).
        'libs/inventory/src/domain/**': { lines: 100, branches: 100, functions: 100, statements: 100 },
        'libs/inventory/src/application/**': { lines: 90, branches: 90, functions: 90, statements: 90 },
        'libs/tenancy/src/application/**': { lines: 90, branches: 90, functions: 90, statements: 90 },
        // The engine is provable without Postgres, without HTTP and without a
        // container (spec 13 §4.3), so there is no excuse for less than all of
        // it. It starts with the directory, not at the end (decision D-15).
        'libs/process/src/domain/**': { lines: 100, branches: 100, functions: 100, statements: 100 },
        'libs/process/src/application/**': { lines: 90, branches: 90, functions: 90, statements: 90 },
      },
    },
  },
});
