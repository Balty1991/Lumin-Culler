import { Capacitor } from '@capacitor/core';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { buildBackup } from '../core/backupService';
import { writeLastBackupAt } from '../state/backupReminder';

/**
 * lumin/autoBackup.ts
 * Copia automată a ce a învățat Cherrypic (oamenii, gustul, deciziile), o dată
 * pe săptămână, fără ca omul să mai facă nimic.
 *
 * Fișierul stă în stocarea privată a aplicației, iar Android îl urcă singur în
 * copia de rezervă Google a telefonului (Auto Backup, criptată cu blocarea
 * ecranului). Regulile din res/xml/backup_rules.xml lasă să plece DOAR acest
 * fișier, nu și pozele sau restul bazei de date. Pe un telefon nou (sau după
 * reinstalare) Android îl pune la loc, iar la pornire Cherrypic îl oferă înapoi.
 *
 * Pornită doar cu acordul omului: fișierul conține și amprentele fețelor
 * oamenilor numiți.
 */
const FILE = 'cherrypic-backup.json';
const ON_KEY = 'lumin-auto-backup';
const LAST_KEY = 'lumin-auto-backup-at';
const RESTORE_ASKED_KEY = 'lumin-auto-backup-restore-asked';
const WEEK = 7 * 86_400_000;

export function autoBackupAvailable(): boolean {
  return Capacitor.isNativePlatform();
}

export function autoBackupOn(): boolean {
  try { return localStorage.getItem(ON_KEY) === '1'; } catch { return false; }
}

export function lastAutoBackupAt(): number | null {
  try {
    const n = Number(localStorage.getItem(LAST_KEY));
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch { return null; }
}

/** Scrie copia acum. Întoarce câte decizii are, sau null dacă n-a reușit. */
async function writeNow(): Promise<number | null> {
  try {
    const data = await buildBackup();
    await Filesystem.writeFile({ path: FILE, data: JSON.stringify(data), directory: Directory.Data, encoding: Encoding.UTF8 });
    const now = Date.now();
    try { localStorage.setItem(LAST_KEY, String(now)); } catch { /* fără stocare */ }
    writeLastBackupAt(now);
    return data.photoDecisions.length;
  } catch {
    return null;
  }
}

export async function setAutoBackup(on: boolean): Promise<void> {
  try { localStorage.setItem(ON_KEY, on ? '1' : '0'); } catch { /* fără stocare */ }
  if (on) await writeNow();
  else await Filesystem.deleteFile({ path: FILE, directory: Directory.Data }).catch(() => {});
}

/** La pornire: dacă e pornită și a trecut o săptămână, face copia (în liniște). */
export async function autoBackupIfDue(): Promise<void> {
  if (!autoBackupAvailable() || !autoBackupOn()) return;
  const last = lastAutoBackupAt();
  if (last && Date.now() - last < WEEK) return;
  await writeNow();
}

/**
 * Copia pusă la loc de Android pe un telefon nou: un fișier pe care aplicația
 * asta nu l-a scris încă (biblioteca e goală). Se întreabă o singură dată.
 */
export async function restorableBackup(): Promise<File | null> {
  if (!autoBackupAvailable()) return null;
  try { if (localStorage.getItem(RESTORE_ASKED_KEY) === '1' || lastAutoBackupAt()) return null; } catch { return null; }
  try {
    const r = await Filesystem.readFile({ path: FILE, directory: Directory.Data, encoding: Encoding.UTF8 });
    const text = typeof r.data === 'string' ? r.data : await r.data.text();
    return new File([text], FILE, { type: 'application/json' });
  } catch {
    return null;
  }
}

export function markRestoreAsked(): void {
  try { localStorage.setItem(RESTORE_ASKED_KEY, '1'); } catch { /* fără stocare */ }
}
