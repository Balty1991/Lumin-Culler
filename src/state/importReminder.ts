/**
 * state/importReminder.ts
 * CAND apare memento-ul periodic de reangajare (ui/ImportReminder.tsx),
 * acelasi tipar ca backupReminder.ts. Semnalul de aici e strict DIN ISTORICUL
 * PROPRIU al aplicatiei (cel mai recent PhotoRecord.importedAt), deci nu cere
 * nimic si merge pe orice platforma.
 *
 * Comentariul de aici sustinea, pana acum, si ca aplicatia NU poate spune "ai
 * N poze noi", fiindca o citire a galeriei "ar cere o permisiune noua, in
 * contradictie cu pozitionarea «acces minim»". Adevarat cand a fost scris,
 * fals de mult timp: aplicatia are READ_MEDIA_IMAGES si citeste chiar din
 * MediaStore in Supervizorul galeriei si in "Adu pe perioade".
 *
 * Cifra chiar se spune acum — vezi state/galleryWatermark.ts si
 * ui/ImportReminder.tsx — dar CE se spune ramane decis acolo, nu aici. Acest
 * fisier raspunde doar la "e momentul?", iar raspunsul lui nu depinde de
 * galerie: daca numarul nu se poate afla (fara permisiune completa, fara semn
 * de carte, prea putine poze), memento-ul apare exact ca inainte, cu mesajul
 * general.
 */
const SNOOZED_UNTIL_KEY = 'lumin-import-reminder-snoozed-until';

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

export function readImportReminderSnoozedUntil(): number | null {
  return readFiniteNumber(SNOOZED_UNTIL_KEY);
}

export function writeImportReminderSnoozedUntil(ts: number): void {
  try {
    localStorage.setItem(SNOOZED_UNTIL_KEY, String(ts));
  } catch {
    // stocare indisponibila — memento-ul poate reaparea la urmatoarea vizita
  }
}

export const IMPORT_REMINDER_INTERVAL_MS = 14 * 24 * 60 * 60 * 1000;
export const IMPORT_REMINDER_SNOOZE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Decide daca memento-ul de import ar trebui aratat acum — functie pura,
 * testabila separat de logica de citire/scriere din localStorage de mai sus.
 */
export function shouldShowImportReminder(opts: {
  now: number;
  /** Cel mai recent PhotoRecord.importedAt din biblioteca curenta — null = niciun import inca. */
  lastImportAt: number | null;
  snoozedUntil: number | null;
}): boolean {
  // Un utilizator care n-a importat NICIODATA nu are ce "sorta" — bannerul de
  // gol (App.tsx, .empty) deja il indruma sa inceapa, nu mai e nevoie de inca unul.
  if (opts.lastImportAt === null) return false;
  if (opts.snoozedUntil !== null && opts.now < opts.snoozedUntil) return false;
  return opts.now - opts.lastImportAt >= IMPORT_REMINDER_INTERVAL_MS;
}
