import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['tests/vault.bench.ts'], silent: false },
});
