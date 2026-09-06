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
      '@app/persistence': lib('persistence'),
      '@app/tenancy': lib('tenancy'),
    },
  },
  test: {
    globals: true,
    root: './',
    include: ['**/*.spec.ts'],
  },
});
