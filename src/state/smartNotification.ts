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

/**
 * PORNITE DIN START, oprite de cine nu le vrea.
 *
 * Cerinta utilizatorului dupa ce le-a vazut pe telefon: "cred ca ar trebui din
 * preset sa vina activare, apoi sa ai posibilitatea sa le dezactivezi".
 *
 * Erau opt-in, deci practic nimeni nu le vedea: ca sa ajungi la comutator
 * trebuia sa deschizi meniul, sa desfaci sectiunea Setari si sa stii ce cauti.
 * O notificare care spune "mai ai 4 poze de sortat" nu e o reclama — e chiar
 * treaba pe care omul a lasat-o neterminata.
 *
 * Absenta cheii inseamna acum PORNIT. Doar un '0' scris explicit (adica cineva
 * a apasat comutatorul) le opreste — deci refuzul se tine minte, iar schimbarea
 * asta nu-l calca in picioare pe cine le oprise deja.
 *
 * Nu deschide singura nicio fereastra de permisiuni: Android cere permisiunea
 * la prima notificare reala, nu la pornirea aplicatiei.
 */
export function readSmartNotificationEnabled(): boolean {
  try {
    return localStorage.getItem(ENABLED_KEY) !== '0';
  } catch {
    return true;
  }
}

export function writeSmartNotificationEnabled(on: boolean): void {
  try { localStorage.setItem(ENABLED_KEY, on ? '1' : '0'); } catch {
    // stocare indisponibila — preferinta ramane activa doar pentru sesiunea curenta
  }
}

/**
 * Bug real gasit de auditul QA (aceeasi clasa ca in state/backupReminder.ts):
 * `raw ? Number(raw) : null` intoarce NaN, nu null, pentru orice continut
 * ne-numeric din localStorage. NaN trece de gardele `!== null` de mai jos, dar
 * apoi orice comparatie cu el e falsa — deci limitarea pe care o pazeste
 * dispare in tacere, exact opusul comportamentului sigur asteptat de la o
 * valoare corupta. core/modelLoadTiming.ts facea deja verificarea corecta.
 */
function readFiniteNumber(key: string): number | null {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null || raw === '') return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

export function readSmartNotificationLastShown(): number | null {
  return readFiniteNumber(LAST_SHOWN_KEY);
}

export function writeSmartNotificationLastShown(ts: number): void {
  try { localStorage.setItem(LAST_SHOWN_KEY, String(ts)); } catch {
    // stocare indisponibila — notificarea poate reaparea mai des decat o data pe zi
  }
}

/** Cel mult o data pe zi — orice mai des ar deveni exact zgomotul pe care mockup-ul il evita explicit ("context concret, nu revino in aplicatie generic"). */
export const SMART_NOTIFICATION_INTERVAL_MS = 24 * 60 * 60 * 1000;

/**
 * Functie pura, testabila separat de localStorage/Notification API.
 * `hasNextPeriod` — supervizorul galeriei are o perioada noua de recomandat
 * (idee proprie: cand utilizatorul e la zi cu sortarea, dar mai e galerie
 * telefonului neadusa in aplicatie, tot merita un context concret, nu doar
 * tacere pana apar poze nesortate din nou).
 */
export function shouldShowSmartNotification(opts: {
  now: number;
  enabled: boolean;
  unsortedCount: number;
  hasNextPeriod?: boolean;
  lastShown: number | null;
}): boolean {
  if (!opts.enabled) return false;
  if (opts.unsortedCount <= 0 && !opts.hasNextPeriod) return false;
  if (opts.lastShown !== null && opts.now - opts.lastShown < SMART_NOTIFICATION_INTERVAL_MS) return false;
  return true;
}
