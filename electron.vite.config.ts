import { resolve } from 'node:path';
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
    resolve: {
      alias: {
        // monaco-editor's "exports" map appends .js to every subpath, which hides its CSS files.
        'monaco-codicons': resolve(import.meta.dirname, 'node_modules/monaco-editor/esm/vs/base/browser/ui/codicons/codicon'),
      },
    },
  },
});
