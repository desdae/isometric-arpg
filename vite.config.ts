import { defineConfig } from 'vite';

// Relative base so the build runs from any folder or static host.
export default defineConfig({
  base: './',
  // Stamped into telemetry so play data can be told apart by build.
  define: { __BUILD_TIME__: JSON.stringify(new Date().toISOString()) },
  build: { target: 'es2022' },
  worker: { format: 'es' },
});
