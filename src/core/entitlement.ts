/**
 * core/entitlement.ts
 * Fundatia LOCALA a modelului freemium decis pentru monetizare: folosirea de
 * baza (import, scor AI, sortare, export normal) ramane gratuita la nesfarsit;
 * recunoasterea a mai mult de o persoana si exportul de poze peste un plafon
 * lunar generos sunt gandite ca sa ceara abonament.
 *
 * Deocamdata NU exista niciun mecanism real de plata (Google Play Billing nu
 * e cablat inca — necesita crearea produsului de abonament in Play Console,
 * pas care apartine dezvoltatorului, nu codului). Pana atunci:
 *   - isPremium() e mereu false (nimic de citit inca dintr-o achizitie reala);
 *   - depasirea plafonului NU blocheaza nimic — doar informeaza (notice),
 *     ca utilizatorii sa nu ramana blocati fara nicio cale reala de plata.
 * Cand pluginul de billing va exista, singura schimbare necesara e ca acesta
 * sa scrie in PREMIUM_FLAG_KEY dupa o achizitie activa confirmata — restul
 * codului (apelantii din state/store.ts) nu se schimba.
 */

const PREMIUM_FLAG_KEY = 'lumin-premium';
const EXPORT_LOG_KEY = 'lumin-export-log';

/** Cate poze poate exporta gratuit un utilizator neabonat, intr-o fereastra glisanta de 30 de zile. */
export const FREE_EXPORT_PHOTOS_PER_MONTH = 150;
/** Cate persoane poate inrola gratuit un utilizator neabonat (a doua+ cere abonament). */
export const FREE_ENROLLED_PERSONS = 1;

const ROLLING_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

export function isPremium(): boolean {
  try {
    return localStorage.getItem(PREMIUM_FLAG_KEY) === '1';
  } catch {
    return false;
  }
}

function readExportLog(): number[] {
  try {
    const raw = localStorage.getItem(EXPORT_LOG_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is number => typeof v === 'number') : [];
  } catch {
    return [];
  }
}

function writeExportLog(entries: number[]): void {
  try {
    localStorage.setItem(EXPORT_LOG_KEY, JSON.stringify(entries));
  } catch {
    // stocare indisponibila (mod privat strict etc.) — folosirea continua fara sa fie numarata, degradare sigura
  }
}

/** Cate poze au fost exportate in ultimele 30 de zile (fereastra glisanta, nu "luna calendaristica"). */
export function exportsInRollingMonth(now = Date.now()): number {
  const cutoff = now - ROLLING_WINDOW_MS;
  return readExportLog().filter(ts => ts > cutoff).length;
}

/**
 * Inregistreaza `count` poze exportate ACUM. Apelata neconditionat (chiar si
 * pentru utilizatori premium) — jurnalul ramane util pentru un eventual ecran
 * "ai exportat X poze luna asta", indiferent de abonament.
 */
export function recordExport(count: number, now = Date.now()): void {
  if (count <= 0) return;
  const cutoff = now - ROLLING_WINDOW_MS;
  const kept = readExportLog().filter(ts => ts > cutoff);
  for (let i = 0; i < count; i++) kept.push(now);
  writeExportLog(kept);
}

/** Cate poze mai poate exporta gratuit utilizatorul in fereastra curenta (Infinity daca e premium). */
export function remainingFreeExports(now = Date.now()): number {
  if (isPremium()) return Infinity;
  return Math.max(0, FREE_EXPORT_PHOTOS_PER_MONTH - exportsInRollingMonth(now));
}

/** true daca utilizatorul mai poate inrola inca o persoana fara abonament. */
export function canEnrollAnotherPersonFree(currentPersonCount: number): boolean {
  return isPremium() || currentPersonCount < FREE_ENROLLED_PERSONS;
}
