import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

const shared = fileURLToPath(new URL('../src', import.meta.url));

// A second front end that shares the desktop engine. Keeping the shared code
// outside this folder means one copy of the scoring, analysis, and OMR logic
// can never drift between the two builds.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  resolve: {
    alias: {
      '@shared': shared,
    },
  },
  server: {
    port: 5174,
    strictPort: true,
    host: true,
    fs: {
      // The shared engine lives one folder up; the dev server has to read it.
      allow: [fileURLToPath(new URL('..', import.meta.url))],
    },
  },
  envPrefix: ['VITE_', 'TAURI_ENV_'],
  build: {
    target: 'chrome110',
    sourcemap: false,
  },
});
