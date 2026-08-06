import React from 'react';
import ReactDOM from 'react-dom/client';
import { Capacitor } from '@capacitor/core';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import { ErrorBoundary } from './ui/ErrorBoundary';
import './styles.css';

/**
 * Bug real, gasit DUPA trei runde de fix-uri de timeout in exportul nativ Android
 * care nu aveau NICIUN efect vizibil pe device, oricat de multe reinstalari de
 * APK facea utilizatorul: registerSW() (Workbox, gandit pentru PWA-ul web de pe
 * GitHub Pages) rula NECONDITIONAT, inclusiv in shell-ul nativ Capacitor — care
 * serveste aplicatia de pe o origine sigura (https://localhost), unde Service
 * Worker-ul chiar reuseste sa se inregistreze si sa functioneze, exact ca intr-un
 * browser normal. Pe native, APK-ul insusi E deja "cache-ul": fiecare build nou
 * aduce bytes-ii JS proaspeti direct in pachet, fara sa treaca vreodata prin
 * retea — un service worker separat, cu propriul lui strat de cache versionat
 * (skipWaiting/clientsClaim, vezi vite.config.ts), e pur risc, fara niciun
 * beneficiu: odata inregistrat pe un device, WebView-ul putea continua sa
 * serveasca bundle-ul JS VECHI din Cache Storage la infinit, indiferent de ce
 * ajungea in APK-ul reinstalat peste — inclusiv codul ACESTUI fix.
 *
 * De-asta curatarea de mai jos (native only) NU se limiteaza la "nu mai
 * inregistram unul nou de acum incolo" — dezinstaleaza si orice Service Worker
 * + Cache Storage ramase de la o instalare anterioara a acestui build (dinainte
 * de acest fix), ca reinstalarile care nu sunt o dezinstalare completa (aceeasi
 * cheie de semnare intre build-uri de debug = Android le trateaza ca update, nu
 * ca instalare noua, deci pastreaza datele WebView-ului) sa nu ramana blocate
 * definitiv pe cod vechi.
 */
if (Capacitor.isNativePlatform()) {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations()
      .then(regs => Promise.all(regs.map(r => r.unregister())))
      .catch(() => {});
  }
  if ('caches' in window) {
    caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k)))).catch(() => {});
  }
} else {
  // registerType: 'autoUpdate' (vite.config.ts) inseamna ca update-urile se aplica
  // singure, fara sa intrebe utilizatorul — dar DOAR daca chiar inregistram service
  // worker-ul prin acest modul virtual. Fara acest apel explicit, plugin-ul injecta
  // in schimb un script minimal (`registerSW.js`) care doar cheama
  // `serviceWorker.register()`, fara nicio verificare periodica de update — pe un
  // PWA instalat (ramane rezident, rareori inchis complet), asta putea insemna sa
  // ramai blocat pe un build vechi la nesfarsit dupa un deploy nou.
  registerSW({ immediate: true });
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
