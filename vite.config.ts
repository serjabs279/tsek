import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// The desktop shell loads this dev server at a fixed port, so a silent port
// change would leave `tauri dev` pointing at nothing.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
  },
  envPrefix: ['VITE_', 'TAURI_ENV_'],
  build: {
    // WebView2 on Windows is the floor: Chromium 110 ships with current
    // Windows 10/11, and anything older is not supported by Tauri 2 either.
    target: 'chrome110',
    sourcemap: false,
  },
})
