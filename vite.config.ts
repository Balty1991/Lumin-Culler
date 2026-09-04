import { execSync } from 'node:child_process';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

/**
 * Eticheta build-ului, aratata in Meniu -> Ajutor.
 *
 * DE CE EXISTA: nu exista nicio cale prin care cineva sa vada ce versiune
 * ruleaza. Aplicatia e PWA cu service worker, deci dupa un deploy prima
 * reincarcare serveste de multe ori tot ce era in cache, iar versiunea noua
 * intra abia la urmatoarea. Fara un marcaj vizibil, "s-a publicat sau nu?"
 * ramane o intrebare la care nimeni nu poate raspunde uitandu-se la ecran — s-au
 * pierdut ore intregi pe exact asta.
 *
 * Pentru testeri e si mai util: un raport de bug fara versiune nu se poate lega
 * de un build anume.
 *
 * `GITHUB_SHA` inaintea lui git: in CI directorul e un checkout, unde comanda
 * git merge, dar variabila e sursa oficiala. Local, cand niciuna nu raspunde
 * (arhiva descarcata, fara git instalat), ramane doar data — mai putin precisa,
 * dar niciodata gresita.
 */
function buildId(): string {
  const date = new Date().toISOString().slice(0, 10);
  let sha = process.env.GITHUB_SHA?.slice(0, 7) ?? '';
  if (!sha) {
    try {
      sha = execSync('git rev-parse --short=7 HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    } catch {
      sha = '';
    }
  }
  return sha ? `${date}·${sha}` : date;
}

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
        // `bin` si `json` au IESIT de aici. Toate fisierele cu acele extensii din
        // build sunt modelele Human din dist/models/ — 17 MiB din cei 22 ai
        // precache-ului. Precache inseamna ca service worker-ul le descarca pe
        // TOATE inainte sa se declare instalat: pe web, prima vizita platea 22
        // MiB inainte sa poata face ceva, desi modelele n-au ce face pana nu
        // exista poze. In aplicatia Android era si mai rau — fisierele sunt deja
        // locale, deci precache-ul doar le COPIA a doua oara in CacheStorage:
        // 17 MiB tinuti de doua ori pe telefon, degeaba.
        //
        // Trec pe runtimeCaching (CacheFirst, mai jos): se descarca la prima
        // analiza si raman cache-uite dupa aceea. Promisiunea "merge offline" se
        // pastreaza — dupa prima rulare a analizei, care oricum e conditia ca
        // aplicatia sa aiba ce arata offline.
        globPatterns: ['**/*.{js,css,html,ico,png,svg,webmanifest,wasm,woff2}'],
        runtimeCaching: [
          {
            /* Manifestul CLIP, INAINTEA regulii de modele de mai jos — workbox
               ia prima potrivire, iar asta e diferenta dintre un indicator si o
               greutate.

               Bug real, platit cu o runda de testare: manifestul are numele FIX
               si continutul variabil, dar cadea sub `CacheFirst` cu expirare la
               un an, ca modelele. Dupa o schimbare de format, telefonul citea la
               nesfarsit versiunea veche din cache — iar ecranul spunea "build-ul
               asta n-are model", desi modelele erau livrate si prezente.

               NetworkFirst: se ia mereu cel proaspat cand exista retea, si se
               cade pe cache cand nu — deci promisiunea "merge offline" ramane
               intacta pentru un fisier de cativa octeti. */
            urlPattern: ({ url }: { url: URL }) => url.pathname.endsWith('/models/clip/manifest.json'),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'lumin-clip-manifest',
              expiration: { maxEntries: 4, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] }
            }
          },
          {
            urlPattern: ({ url }: { url: URL }) => url.pathname.includes('/models/'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'lumin-modele-ai',
              // 12 fisiere azi (6 modele x .bin + .json); pragul lasa loc de
              // crestere fara sa devina o groapa fara fund.
              expiration: { maxEntries: 40, maxAgeSeconds: 60 * 60 * 24 * 365 },
              // 0 = raspuns opac; in Capacitor modelele vin de pe schema locala,
              // unde asta e cazul normal, nu o eroare.
              cacheableResponse: { statuses: [0, 200] }
            }
          },
          {
            // Runtime-ul ONNX (~28 MB de wasm), pentru intelegerea semantica —
            // vezi core/clip/. Exact acelasi tratament ca modelele de mai sus, si
            // din acelasi motiv, doar ca aici miza e mai mare: precache-ul l-ar
            // face obligatoriu la prima vizita pentru TOATA lumea, inclusiv
            // pentru cine nu porneste niciodata functia optionala. Adica exact
            // ce a fost proiectata integrarea sa evite.
            //
            // Build-ul a si picat pe asta (vite-plugin-pwa refuza un fisier de
            // 27,8 MB in manifestul de precache), ceea ce a fost noroc: fara
            // eroare, s-ar fi livrat tacut o descarcare obligatorie de 28 MB.
            urlPattern: ({ url }: { url: URL }) => /\/ort-wasm[^/]*\.wasm$/.test(url.pathname),
            handler: 'CacheFirst',
            options: {
              cacheName: 'lumin-onnx-runtime',
              // Un singur fisier azi. Un an, ca la modele: se schimba doar cand
              // se schimba versiunea pachetului — si atunci se schimba si hash-ul
              // din nume, deci vechiul nu mai e cerut niciodata.
              expiration: { maxEntries: 6, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] }
            }
          }
        ],
        // Materialele pentru fisa Play Store stau acum in `store/` la radacina
        // repo-ului, nu in `public/` — vezi docs/PLAY_STORE_CHECKLIST.md. Cat
        // timp erau in public/, Vite le copia in dist/, de unde Capacitor le
        // ducea in APK/AAB: 3,3 MiB de capturi si feature graphic in fiecare
        // instalare, pentru ceva ce nu se vede niciodata in aplicatie.
        // Excluderea de mai jos ramane ca plasa de siguranta daca reapar acolo.
        // `assets/ort-wasm-*`: runtime-ul ONNX, 24,6 MB, emis de Vite langa restul
        // pachetelor. A SCAPAT o data in precache si a ajuns pe site — adica
        // fiecare vizitator descarca 24,6 MB inainte ca service worker-ul sa se
        // declare instalat, pentru o functie optionala, implicit oprita.
        //
        // Prima incercare de a preveni asta a exclus doar directorul `ort/`, unde
        // copiasem eu fisierul de mana. Build-ul a picat atunci fiindca acela
        // avea 27,8 MB si trecea de plafon — noroc curat. Cel emis de Vite are
        // 24,6 MB, adica sub plafonul de 25, deci a intrat tacut. De-aia
        // regula de aici e pe NUME, nu pe director: numele fisierului nu se
        // schimba cand se schimba locul lui.
        globIgnores: ['store/**', 'models/**', 'ort/**', 'assets/ort-wasm-*'],
        // Fara asta, service worker-ul raspunde la ORICE navigare cu index.html
        // — inclusiv la /models/clip/manifest.json deschis direct in bara de
        // adrese, care intoarce aplicatia in loc de fisier. Nu strica nimic in
        // functionare (aplicatia le cere prin fetch, nu prin navigare), dar face
        // imposibil de verificat, cu ochii, ce a livrat build-ul de fapt — si
        // exact asta a trebuit verificat cand modelul parea sa lipseasca.
        // Directoarele astea nu sunt rute ale aplicatiei; nu au ce cauta in
        // fallback-ul de navigare.
        navigateFallbackDenylist: [/^\/?([^/]+\/)*(models|ort|places|store)\//],
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
  // Injectat la build, citit in ui/MenuDrawer.tsx — vezi buildId() de mai sus.
  define: { __BUILD_ID__: JSON.stringify(buildId()) },
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 4000
  }
});
