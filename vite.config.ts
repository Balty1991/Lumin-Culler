import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './',                 // necesar pentru GitHub Pages (site de proiect /REPO/)
  worker: { format: 'es' },
  // libraw-wasm isi incarca propriul worker + .wasm intern via
  // `new URL('./worker.js', import.meta.url)` — pre-bundling-ul lui Vite
  // (optimizeDeps, doar in dev) muta modulul in node_modules/.vite/deps/,
  // ceea ce rupe acel import.meta.url relativ (worker-ul nu mai gaseste
  // worker.js/libraw.wasm si ramane agatat la infinit, fara eroare vizibila).
  // Excluderea lui de la pre-bundling il lasa servit direct din node_modules,
  // unde calea relativa e corecta.
  optimizeDeps: { exclude: ['libraw-wasm'] },
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 4000
  }
});
