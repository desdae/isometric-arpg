import { defineConfig } from 'vite';

// Relative base so the build runs from any folder or static host.
export default defineConfig({
  base: './',
  build: { target: 'es2022' },
  worker: { format: 'es' },
});
