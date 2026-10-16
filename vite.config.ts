import { defineConfig } from 'vite';

// Relative base so the build runs from any folder or static host.
// `vite build --mode release` makes the player build (see src/engine/build.ts).
export default defineConfig(({ mode }) => ({
  base: './',
  // Stamped into telemetry so play data can be told apart by build.
  define: { __BUILD_TIME__: JSON.stringify(new Date().toISOString()), __RELEASE__: JSON.stringify(mode === 'release') },
  build: { target: 'es2022' },
  worker: { format: 'es' },
}));
