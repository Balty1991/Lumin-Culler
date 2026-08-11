import type { PhotoView } from './store';

const DISMISSED_DATE_KEY = 'lumin-memory-dismissed-date';

export interface MemoryGroup {
  year: number;
  yearsAgo: number;
  photos: PhotoView[];
}

/**
 * Grupeaza pozele facute in aceeasi zi (luna+zi) ca `now`, in ani anteriori —
 * "Acum X ani" (plan modernizare, refolosire pura de date deja existente:
 * PhotoView.capturedAt vine din EXIF, nu din data importului). Sortate
 * descrescator dupa an, ca cel mai recent "acum X ani" sa fie primul.
 */
export function findMemories(photos: PhotoView[], now: Date = new Date()): MemoryGroup[] {
  const month = now.getMonth();
  const day = now.getDate();
  const thisYear = now.getFullYear();
  const byYear = new Map<number, PhotoView[]>();
  for (const photo of photos) {
    if (photo.capturedAt === undefined) continue;
    const d = new Date(photo.capturedAt);
    if (d.getMonth() !== month || d.getDate() !== day) continue;
    const year = d.getFullYear();
    if (year >= thisYear) continue;
    const list = byYear.get(year);
    if (list) list.push(photo); else byYear.set(year, [photo]);
  }
  return Array.from(byYear.entries())
    .map(([year, list]) => ({ year, yearsAgo: thisYear - year, photos: list }))
    .sort((a, b) => b.year - a.year);
}

function dayKey(now: Date): string {
  return `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`;
}

export function readMemoryDismissedDate(): string | null {
  try {
    return localStorage.getItem(DISMISSED_DATE_KEY);
  } catch {
    return null;
  }
}

export function writeMemoryDismissedDate(now: Date = new Date()): void {
  try {
    localStorage.setItem(DISMISSED_DATE_KEY, dayKey(now));
  } catch {
    // stocare indisponibila — bannerul poate reaparea la urmatoarea vizita
  }
}

/** Functie pura, testabila separat de citirea/scrierea din localStorage de mai sus. */
export function isMemoryDismissedToday(dismissedDate: string | null, now: Date = new Date()): boolean {
  return dismissedDate === dayKey(now);
}
