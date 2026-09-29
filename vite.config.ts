import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 5199, host: '127.0.0.1' },
  // relative asset paths, so the build works from a subpath such as the
  // GitHub Pages URL as well as from a domain root
  base: './',
  build: { target: 'es2022', chunkSizeWarningLimit: 1200 },
});
