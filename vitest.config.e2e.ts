import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import swc from 'unplugin-swc';

const lib = (name: string) => fileURLToPath(new URL(`./libs/${name}/src/index.ts`, import.meta.url));

// Integration (*.int-spec.ts), e2e (*.e2e-spec.ts) and property (*.prop-spec.ts)
// tests: they need Postgres (docker compose up -d db). Unit tests live in
// vitest.config.ts and never touch infrastructure. See docs/specs/06 §2.
export default defineConfig({
  plugins: [swc.vite()],
  resolve: {
    // Explicit aliases: tsconfig-based resolution would skip test files that
    // the nearest libs/*/tsconfig.lib.json excludes. Keep in sync with
    // tsconfig.json "paths" (one barrel file per library).
    alias: {
      '@app/common': lib('common'),
      '@app/catalog': lib('catalog'),
      '@app/inventory': lib('inventory'),
      '@app/persistence': lib('persistence'),
      '@app/tenancy': lib('tenancy'),
    },
  },
  test: {
    globals: true,
    root: './',
    include: ['**/*.int-spec.ts', '**/*.e2e-spec.ts', '**/*.prop-spec.ts'],
    globalSetup: ['./test/support/global-setup.ts'],
    setupFiles: ['./test/support/env.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
