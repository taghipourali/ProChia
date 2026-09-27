import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

/** The landing page; `scripts/build.mjs` adds the member app, the panel and the worker next to it. */
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  base: './',
  build: { outDir: '../dist', emptyOutDir: true, target: 'es2022' },
});
