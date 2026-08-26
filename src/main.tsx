import React from 'react';
import ReactDOM from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import { ErrorBoundary } from './ui/ErrorBoundary';
import './styles.css';
// Stratul vizual de concept, dupa foaia de baza — aceeasi ordine ca in
// build-ul de referinta, unde era o a doua foaie incarcata peste prima.
import './styles.concept.css';
import { watchBackgroundMemory } from './core/backgroundMemory';

// registerType: 'autoUpdate' (vite.config.ts) inseamna ca update-urile se aplica
// singure, fara sa intrebe utilizatorul — dar DOAR daca chiar inregistram service
// worker-ul prin acest modul virtual. Fara acest apel explicit, plugin-ul injecta
// in schimb un script minimal (`registerSW.js`) care doar cheama
// `serviceWorker.register()`, fara nicio verificare periodica de update — pe un
// PWA instalat (ramane rezident, rareori inchis complet), asta putea insemna sa
// ramai blocat pe un build vechi la nesfarsit dupa un deploy nou.
registerSW({ immediate: true });

// Cand aplicatia iese de pe ecran, imaginile decodate din cache nu mai au cui
// folosi — dar sistemul continua sa le numere. Vezi core/backgroundMemory.ts
// pentru de ce nu se golesc imediat.
watchBackgroundMemory();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
