/**
 * state/backupReminder.ts
 * Momentul ultimului export de backup + un "amana" temporar pentru bannerul
 * de memento (ui/BackupReminder.tsx) — persistate local, acelasi tipar ca
 * projectName.ts/installPrompt.ts. Spre deosebire de InstallPrompt, aici NU
 * exista un "nu mai arata niciodata" permanent: riscul (persoane/model AI
 * invatat, nesalvate nicaieri in afara acestui browser) ramane real oricat
 * de mult ar amana utilizatorul, deci bannerul revine dupa perioada de amanare.
 */
const LAST_BACKUP_KEY = 'lumin-last-backup-at';
const SNOOZED_UNTIL_KEY = 'lumin-backup-reminder-snoozed-until';

export function readLastBackupAt(): number | null {
  try {
    const raw = localStorage.getItem(LAST_BACKUP_KEY);
    return raw ? Number(raw) : null;
  } catch {
    return null;
  }
}

export function writeLastBackupAt(ts: number): void {
  try {
    localStorage.setItem(LAST_BACKUP_KEY, String(ts));
  } catch {
    // stocare indisponibila — memento-ul poate reaparea la urmatoarea vizita
  }
}

export function readSnoozedUntil(): number | null {
  try {
    const raw = localStorage.getItem(SNOOZED_UNTIL_KEY);
    return raw ? Number(raw) : null;
  } catch {
    return null;
  }
}

export function writeSnoozedUntil(ts: number): void {
  try {
    localStorage.setItem(SNOOZED_UNTIL_KEY, String(ts));
  } catch {
    // stocare indisponibila
  }
}

export const BACKUP_REMINDER_INTERVAL_MS = 14 * 24 * 60 * 60 * 1000;
export const BACKUP_REMINDER_SNOOZE_MS = 7 * 24 * 60 * 60 * 1000;
/** Grație inainte de primul memento (niciun backup facut inca) — nu deranjam un utilizator nou din prima zi. */
const NEVER_BACKED_UP_GRACE_MS = 3 * 24 * 60 * 60 * 1000;

/**
 * Decide daca memento-ul de backup ar trebui aratat acum — functie pura,
 * testabila separat de logica de citire/scriere din localStorage de mai sus.
 */
export function shouldShowBackupReminder(opts: {
  /** exista cel putin o persoana inrolata / date de model AI care ar avea ce pierde. */
  hasDataWorthBackingUp: boolean;
  now: number;
  lastBackupAt: number | null;
  snoozedUntil: number | null;
  /** cel mai vechi moment de activitate cunoscut (ex. primul import) — proxy pentru "de cat timp foloseste aplicatia". */
  earliestActivityAt: number | null;
}): boolean {
  if (!opts.hasDataWorthBackingUp) return false;
  if (opts.snoozedUntil !== null && opts.now < opts.snoozedUntil) return false;
  if (opts.lastBackupAt !== null) return opts.now - opts.lastBackupAt >= BACKUP_REMINDER_INTERVAL_MS;
  if (opts.earliestActivityAt === null) return false;
  return opts.now - opts.earliestActivityAt >= NEVER_BACKED_UP_GRACE_MS;
}
