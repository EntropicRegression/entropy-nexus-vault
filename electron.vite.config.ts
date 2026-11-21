import { defineConfig } from 'electron-vite';

export default defineConfig({
  main: {},
  preload: {},
  renderer: {
    build: { assetsInlineLimit: 0 },
    oxc: { jsx: { runtime: 'automatic' } },
  },
});
