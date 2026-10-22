import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';

export default defineConfig({
  main: {},
  preload: {
    // Sandboxed preloads cannot require() node_modules, so everything is bundled into one file.
    build: { externalizeDeps: false },
  },
  renderer: {
    plugins: [react()],
  },
});
