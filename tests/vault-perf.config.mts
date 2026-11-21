import { defineConfig } from 'vitest/config';

export default defineConfig({
  oxc: { jsx: { runtime: 'automatic' } },
  test: { include: ['tests/vault.bench.ts', 'tests/vault-renderer.bench.tsx'], silent: false, fileParallelism: false },
});
