import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  oxc: { jsx: { runtime: 'automatic' } },
  test: {
    environment: 'node',
    restoreMocks: true,
    unstubGlobals: true,
    include: ['src/**/*.test.{ts,tsx}', 'tests/**/*.test.ts'],
    exclude: [...configDefaults.exclude, 'tests/e2e/**'],
    css: { include: [/.*/] },
  },
});
