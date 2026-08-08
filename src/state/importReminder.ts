/**
 * state/importReminder.ts
 * "N-ai mai sortat de X zile" — memento periodic (ui/ImportReminder.tsx),
 * acelasi tipar ca backupReminder.ts. Nu exista nicio citire a galeriei
 * telefonului (ar cere o permisiune noua, in contradictie cu pozitionarea
 * "acces minim" a aplicatiei) — semnalul e strict DIN ISTORICUL PROPRIU al
 * aplicatiei (cel mai recent PhotoRecord.importedAt), deja disponibil fara
 * nimic suplimentar. Nu poate spune "ai N poze noi", doar "a trecut mult timp
 * de la ultimul import" — mai putin precis, dar gratuit din date deja existente.
 */
const SNOOZED_UNTIL_KEY = 'lumin-import-reminder-snoozed-until';

export function readImportReminderSnoozedUntil(): number | null {
  try {
    const raw = localStorage.getItem(SNOOZED_UNTIL_KEY);
    return raw ? Number(raw) : null;
  } catch {
    return null;
  }
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
