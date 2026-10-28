import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  root: resolve(import.meta.dirname),
  base: './',
  plugins: [react()],
  build: {
    outDir: resolve(import.meta.dirname, '../../dist/translator'),
    emptyOutDir: true,
  },
});
