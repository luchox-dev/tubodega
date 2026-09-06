import { defineConfig } from 'vitest/config';
import swc from 'unplugin-swc';

export default defineConfig({
  // SWC (not the default esbuild) so tests compile decorators exactly the way
  // the rspack/SWC build does — `decoratorMetadata` is what makes Nest's
  // constructor injection resolvable by type.
  plugins: [swc.vite()],
  resolve: {
    // Native replacement for the vite-tsconfig-paths plugin; resolves @app/*.
    tsconfigPaths: true,
  },
  test: {
    globals: true,
    root: './',
    include: ['**/*.spec.ts'],
  },
});
