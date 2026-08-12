/**
 * state/smartNotification.ts
 * "Notificare inteligenta" (plan modernizare, ecran m-notif din mockup) —
 * context real (numarul curent de poze nesortate), nu un "revino in
 * aplicatie" generic. LIMITARE REALA, de spus clar utilizatorului: aceasta
 * e o notificare de BROWSER/PWA (Notification API), declansata cand
 * aplicatia e deschisa/adusa in prim-plan — NU o notificare adevarata de
 * fundal (ar cere push server + abonament + service worker dedicat, cu totul
 * in afara scopului acestei schimbari). Cel mai apropiat de "true background
 * push" fara acel efort e strict opt-in si nu promite nimic ce nu poate livra.
 */
const ENABLED_KEY = 'lumin-smart-notification-enabled';
const LAST_SHOWN_KEY = 'lumin-smart-notification-last-shown';

export function readSmartNotificationEnabled(): boolean {
  try {
    return localStorage.getItem(ENABLED_KEY) === '1';
  } catch {
    return false;
  }
}

export function writeSmartNotificationEnabled(on: boolean): void {
  try { localStorage.setItem(ENABLED_KEY, on ? '1' : '0'); } catch {
    // stocare indisponibila — preferinta ramane activa doar pentru sesiunea curenta
  }
}

export function readSmartNotificationLastShown(): number | null {
  try {
    const raw = localStorage.getItem(LAST_SHOWN_KEY);
    return raw ? Number(raw) : null;
  } catch {
    return null;
  }
}

export function writeSmartNotificationLastShown(ts: number): void {
  try { localStorage.setItem(LAST_SHOWN_KEY, String(ts)); } catch {
    // stocare indisponibila — notificarea poate reaparea mai des decat o data pe zi
  }
}

/** Cel mult o data pe zi — orice mai des ar deveni exact zgomotul pe care mockup-ul il evita explicit ("context concret, nu revino in aplicatie generic"). */
export const SMART_NOTIFICATION_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** Functie pura, testabila separat de localStorage/Notification API. */
export function shouldShowSmartNotification(opts: {
  now: number;
  enabled: boolean;
  unsortedCount: number;
  lastShown: number | null;
}): boolean {
  if (!opts.enabled) return false;
  if (opts.unsortedCount <= 0) return false;
  if (opts.lastShown !== null && opts.now - opts.lastShown < SMART_NOTIFICATION_INTERVAL_MS) return false;
  return true;
}
