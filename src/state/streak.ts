import type { PhotoView } from './store';

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function addDays(d: Date, delta: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + delta);
}

/**
 * "Zile la rand" (plan modernizare, ecranul Acasa) — nr. de zile calendaristice
 * consecutive, incheiate azi (sau ieri, vezi mai jos), in care a fost importata
 * cel putin o poza. Foloseste `importedAt` (singurul camp existent, nelipsit,
 * fara nicio infrastructura noua de urmarire) — NU "zile cu decizii luate":
 * `history`-ul de decizii (state/history.ts) e limitat la ultimele 10
 * evenimente TOTAL (stiva de undo, nu un jurnal), deci inutilizabil pentru un
 * streak pe mai multe zile odata ce utilizatorul a facut peste 10 decizii.
 *
 * Daca azi inca nu s-a importat nimic, pornim de la ieri (nu rupem streak-ul
 * doar pentru ca utilizatorul inca n-a deschis azi aplicatia).
 */
export function computeImportStreak(photos: PhotoView[], now: Date): number {
  const days = new Set(photos.map(p => dayKey(new Date(p.importedAt))));
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
