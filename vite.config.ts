import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './',                 // necesar pentru GitHub Pages (site de proiect /REPO/)
  worker: { format: 'es' },
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 4000
  }
});
