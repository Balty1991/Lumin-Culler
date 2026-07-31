/**
 * core/installPromptEvent.ts
 * Captureaza evenimentul non-standard `beforeinstallprompt` (Chrome/Edge/Android)
 * O SINGURA DATA la nivel de modul — browserul il trimite o singura data per
 * incarcare de pagina, deci orice component care are nevoie de el (bannerul
 * InstallPrompt, dar si intrarea din Meniu de mai jos) trebuie sa citeasca
 * ACELASI eveniment retinut, nu sa inregistreze fiecare propriul listener
 * (al doilea listener n-ar mai primi niciodata evenimentul).
 *
 * Expus prin useSyncExternalStore (nu Zustand) — e stare de browser, nu stare
 * de aplicatie/business, nu are ce cauta in store.ts.
 */

export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferredEvent: BeforeInstallPromptEvent | null = null;
const listeners = new Set<() => void>();

function notify(): void {
  for (const l of listeners) l();
}

export function isStandalone(): boolean {
  // Nici display-mode: standalone, nici navigator.standalone (iOS) nu sunt adevarate
  // intr-un WebView Capacitor (Android) — bug real gasit de auditul QA: un utilizator care
  // a instalat aplicatia NATIVA de pe Google Play tot vedea intrarea "Instaleaza
  // aplicatia" in meniu, care nu facea nimic util (beforeinstallprompt nu exista intr-un
  // WebView nativ). Verificam explicit si Capacitor.
  const capacitor = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  if (capacitor?.isNativePlatform?.()) return true;
  return window.matchMedia('(display-mode: standalone)').matches
    || (window.navigator as unknown as { standalone?: boolean }).standalone === true;
}

if (typeof window !== 'undefined' && !isStandalone()) {
  window.addEventListener('beforeinstallprompt', (e: Event) => {
    e.preventDefault();
    deferredEvent = e as BeforeInstallPromptEvent;
    notify();
  });
  window.addEventListener('appinstalled', () => {
    deferredEvent = null;
    notify();
  });
}

export function getInstallPromptEvent(): BeforeInstallPromptEvent | null {
  return deferredEvent;
}

export function subscribeInstallPromptEvent(callback: () => void): () => void {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

/** Consuma evenimentul retinut (poate fi folosit o singura data) si notifica abonatii. */
export function consumeInstallPromptEvent(): BeforeInstallPromptEvent | null {
  const e = deferredEvent;
  deferredEvent = null;
  notify();
  return e;
}
