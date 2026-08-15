import type { PhotoView } from './store';

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function addDays(d: Date, delta: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + delta);
}

/**
 * Zilele cu importuri, tinute SEPARAT de poze.
 *
 * Bug real raportat de utilizator: "nu a mai aparut acel 2 zile la rand".
 * Numaratoarea se calcula exclusiv din `importedAt`-ul pozelor aflate ACUM in
 * biblioteca — deci "Goleste sesiunea", stergerea pozelor respinse de pe telefon
 * sau orice curatenie obisnuita rescriau retroactiv istoria: zilele in care
 * chiar ai importat dispareau odata cu pozele, si seria se rupea desi nu
 * ratasesi nicio zi. Un jurnal minuscul de chei de zi (cateva zeci de octeti)
 * rezolva asta fara sa atinga baza de date.
 */
const STORAGE_KEY = 'lumin-import-days';
/** ~3 luni. Peste atat n-are ce arata nimic, iar cheia ramane mica. */
const MAX_REMEMBERED_DAYS = 90;

function readStoredDays(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((d): d is string => typeof d === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * Marcheaza ziua de azi ca zi cu import. Apelata dupa un import reusit (vezi
 * state/store.ts:runImport) — idempotenta, oricate importuri ai face intr-o zi.
 */
export function recordImportDay(now: Date = new Date()): void {
  try {
    const key = dayKey(now);
    const days = readStoredDays();
    if (days.includes(key)) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...days, key].slice(-MAX_REMEMBERED_DAYS)));
  } catch {
    // Fara localStorage (mod privat, cota plina) seria se calculeaza mai departe
    // doar din pozele existente, exact ca inainte — nu e motiv sa strice importul.
  }
}

/**
 * "Zile la rand" (plan modernizare, ecranul Acasa) — nr. de zile calendaristice
 * consecutive, incheiate azi (sau ieri, vezi mai jos), in care a fost importata
 * cel putin o poza.
 *
 * Doua surse, reunite: jurnalul de zile de mai sus (rezista la stergeri) SI
 * `importedAt`-ul pozelor din biblioteca (pentru cine avea deja poze inainte ca
 * jurnalul sa existe — altfel seria ar fi parut ca porneste de la zero la
 * actualizare). NU "zile cu decizii luate": `history`-ul de decizii
 * (state/history.ts) e limitat la ultimele 10 evenimente TOTAL (stiva de undo,
 * nu un jurnal), deci inutilizabil pentru un streak pe mai multe zile.
 *
 * Daca azi inca nu s-a importat nimic, pornim de la ieri (nu rupem streak-ul
 * doar pentru ca utilizatorul inca n-a deschis azi aplicatia).
 */
export function computeImportStreak(photos: PhotoView[], now: Date): number {
  const days = new Set(photos.map(p => dayKey(new Date(p.importedAt))));
  for (const stored of readStoredDays()) days.add(stored);
  let cursor = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (!days.has(dayKey(cursor))) {
    cursor = addDays(cursor, -1);
    if (!days.has(dayKey(cursor))) return 0;
  }
  let streak = 0;
  while (days.has(dayKey(cursor))) {
    streak++;
    cursor = addDays(cursor, -1);
  }
  return streak;
}
