import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  // Relative base: the built site works from any folder, including a
  // GitHub Pages project URL like https://<user>.github.io/<repo>/
  base: './',
  server: { host: 'localhost', port: 5173 },
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 900, // three.js lives in the home bundle
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        about: resolve(__dirname, 'about.html'),
        portfolio: resolve(__dirname, 'portfolio.html'),
      },
    },
  },
});
