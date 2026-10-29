import React from 'react';
import ReactDOM from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import { Capacitor } from '@capacitor/core';
import { LazyMotion, domAnimation } from 'framer-motion';
import { LuminApp } from './lumin/LuminApp';
import { ErrorBoundary } from './ui/ErrorBoundary';
import './styles.css';
// Stratul vizual de concept, dupa foaia de baza — aceeasi ordine ca in
// build-ul de referinta, unde era o a doua foaie incarcata peste prima.
import './styles.concept.css';
import './styles.v3.css';
import { watchBackgroundMemory } from './core/backgroundMemory';
import { lastRunReport, forgetLastRun } from './core/nativeDiagnostics';
import { installErrorLog, logError } from './core/errorLog';
import { useStore } from './state/store';
import { ensureLocaleLoaded, readStoredLocale } from './i18n';

// registerType: 'autoUpdate' (vite.config.ts) inseamna ca update-urile se aplica
// singure, fara sa intrebe utilizatorul — dar DOAR daca chiar inregistram service
// worker-ul prin acest modul virtual. Fara acest apel explicit, plugin-ul injecta
// in schimb un script minimal (`registerSW.js`) care doar cheama
// `serviceWorker.register()`, fara nicio verificare periodica de update — pe un
// PWA instalat (ramane rezident, rareori inchis complet), asta putea insemna sa
// ramai blocat pe un build vechi la nesfarsit dupa un deploy nou.
// În aplicația Android (Capacitor) fișierele vin deja de pe telefon, iar un
// service worker doar le ținea pe cele VECHI în cache: după instalarea unui APK
// nou, prima pornire arăta tot interfața veche (raportat: „aplicația arată la
// fel” după redesign). Acolo nu se mai înregistrează, iar unul rămas de la o
// versiune anterioară se scoate, cu tot cu cache, și pagina se reîncarcă o dată.
if (Capacitor.isNativePlatform()) {
  void navigator.serviceWorker?.getRegistrations().then(async regs => {
    if (!regs.length) return;
    await Promise.all(regs.map(r => r.unregister()));
    try {
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k)));
    } catch {
      // fără Cache API: reîncărcarea de mai jos tot ia fișierele noi
    }
    location.reload();
  }).catch(() => {});
} else {
  registerSW({ immediate: true });
}

// Cand aplicatia iese de pe ecran, imaginile decodate din cache nu mai au cui
// folosi — dar sistemul continua sa le numere. Vezi core/backgroundMemory.ts
// pentru de ce nu se golesc imediat.
watchBackgroundMemory();

// Jurnalul de probleme (doar pe telefon; omul îl trimite din Setări dacă vrea).
installErrorLog();

// Daca rularea precedenta a fost omorata in timpul unei analize, partea nativa
// stie in ce model s-a intamplat — vezi core/nativeDiagnostics.ts. Se spune o
// singura data, la prima pornire de dupa, si se uita imediat: e un ajutor la
// depanare, nu o functie a produsului.
void (async () => {
  const raport = await lastRunReport();
  if (!raport?.crashed || !raport.crashedAt) return;
  logError('crash', `Închidere neașteptată la: ${raport.crashedAt}`);
  useStore.setState({
    notice: `Repornire dupa o inchidere neasteptata. S-a oprit la: ${raport.crashedAt}`
  });
  await forgetLastRun();
})();

/**
 * LazyMotion + `domAnimation`, si peste tot in aplicatie `m.div` in loc de
 * `motion.div`.
 *
 * `motion.div` nu e tree-shakeable: componenta vine cu TOATE functiile
 * bibliotecii legate de ea — drag, pan si motorul de proiectie pentru animatii
 * de layout — indiferent daca le folosesti. Masurat in bundle-ul principal:
 * `create-projection-node` 72 KB + `VisualElementDragControls` 24 KB +
 * `PanSession` 11 KB, cod brut parsat la fiecare pornire. Aplicatia nu foloseste
 * niciuna: cele patru panouri fac doar intrare/iesire (`AnimatePresence`), iar
 * gestul de tragere din DetailView e scris de mana pe evenimente de pointer.
 *
 * `domAnimation` aduce exact ce se foloseste (animatii + iesire + gesturi
 * simple). `strict` face ca un `motion.*` strecurat inapoi in cod sa arunce pe
 * loc, in dev, in loc sa reintroduca tacut cei 107 KB.
 */
/**
 * Randarea asteapta dictionarul limbii salvate.
 *
 * Doar romana e legata static in bundle (vezi i18n/index.ts); engleza vine
 * dintr-un chunk separat. Fara aceasta asteptare, un utilizator cu engleza
 * setata ar fi vazut prima randare in romana si abia apoi comutarea. Pentru
 * romana — cazul implicit si majoritar — promisiunea e deja rezolvata, deci nu
 * se adauga nicio intarziere; pentru engleza e un singur chunk mic, servit din
 * cache dupa prima pornire.
 */
void ensureLocaleLoaded(readStoredLocale()).then(() => {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <ErrorBoundary>
        <LazyMotion features={domAnimation} strict>
          <LuminApp />
        </LazyMotion>
      </ErrorBoundary>
    </React.StrictMode>
  );
});
