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
        ],
        // "Widget pe ecranul principal" (plan modernizare, mockup m-widget) — un
        // widget nativ real (Android AppWidgetProvider/Glance) ar cere cod Kotlin
        // separat, in afara acestui strat web/Capacitor, deci NU e livrat aici.
        // App shortcuts sunt echivalentul realist accesibil din acest strat:
        // apasare lunga pe iconita PWA instalata arata direct aceste 2 actiuni,
        // fara sa mai deschizi intai aplicatia — vezi App.tsx (citeste ?action=
        // o singura data la pornire) pentru handling-ul lor.
        shortcuts: [
          {
            name: 'Sortare rapida',
            short_name: 'Sortare',
            description: 'Deschide direct sortarea stil TikTok',
            url: './?action=sort',
            icons: [{ src: 'icon-192.png', sizes: '192x192', type: 'image/png' }]
          },
          {
            name: 'Adauga poze',
            short_name: 'Adauga',
            description: 'Deschide direct selectorul de poze',
            url: './?action=add',
            icons: [{ src: 'icon-192.png', sizes: '192x192', type: 'image/png' }]
          }
        ]
      },
      workbox: {
        maximumFileSizeToCacheInBytes: 25 * 1024 * 1024,
        // Bug real gasit de auditul QA: lipsea woff2 — cele 3 fonturi self-hosted
        // (Space Grotesk, ~52KB) nu erau precache-uite deloc, deci un reload complet
        // offline (dupa golirea cache-ului HTTP normal) cadea pe un font de sistem,
        // contrazicand exact afirmatia "functioneaza offline" de mai sus.
        globPatterns: ['**/*.{js,css,html,ico,png,svg,webmanifest,json,bin,wasm,woff2}'],
        // Bug real gasit de auditul QA: fara asta, public/store/ (poze de marketing
        // pentru fisa Play Store — icon-512.png duplicat + feature-graphic.png,
        // ~348KB) era maturat automat de globPatterns si ajungea in precache-ul
        // PWA-ului, desi nu e folosit NICIUNDE in interfata reala a aplicatiei —
        // bytes descarcati degeaba la fiecare instalare noua.
        globIgnores: ['store/**'],
        // Fara astea, un service worker nou instalat ramane "waiting" pana se
        // inchid TOATE tab-urile/instantele deschise ale aplicatiei — pe un PWA
        // instalat (adaugat pe ecranul principal, ramane rezident) practic nu se
        // intampla niciodata, deci un utilizator putea ramane blocat pe un build
        // vechi la nesfarsit. Cu astea + registerSW({ immediate: true }) din
        // main.tsx, update-ul se aplica automat la urmatoarea reincarcare.
        skipWaiting: true,
        clientsClaim: true,
        cleanupOutdatedCaches: true
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
