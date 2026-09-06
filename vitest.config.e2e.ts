import { defineConfig } from 'vitest/config';
import swc from 'unplugin-swc';

// Integration (*.int-spec.ts), e2e (*.e2e-spec.ts) and property (*.prop-spec.ts)
// tests: they need Postgres (docker compose up -d db). Unit tests live in
// vitest.config.ts and never touch infrastructure. See docs/specs/06 §2.
export default defineConfig({
  plugins: [swc.vite()],
  resolve: {
    tsconfigPaths: true,
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
