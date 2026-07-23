import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    // Aplicatia se declara "AI local, functioneaza offline" — fara asta, afirmatia
    // era falsa in practica: nu exista niciun manifest/service worker, un reload
    // fara retea pierdea totul. Precache-uieste shell-ul + workerii + modelele TFJS
    // (.bin/.wasm, mari — de-asta limita implicita de 2MB e ridicata mai jos).
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon-32.png', 'apple-touch-icon.png'],
      manifest: {
        name: 'Lumin Culler Pro',
        short_name: 'LuminCuller',
        description: 'Sortare foto cu AI, integral locala — pozele nu parasesc dispozitivul.',
        lang: 'ro',
        start_url: '.',
        scope: '.',
        display: 'standalone',
        background_color: '#0a0b0d',
        theme_color: '#0a0b0d',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      },
      workbox: {
        maximumFileSizeToCacheInBytes: 25 * 1024 * 1024,
        globPatterns: ['**/*.{js,css,html,ico,png,svg,webmanifest,json,bin,wasm}']
      }
    })
  ],
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
