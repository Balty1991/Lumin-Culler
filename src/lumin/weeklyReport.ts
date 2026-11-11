/**
 * lumin/weeklyReport.ts
 * „Curățenia săptămânii”: o dată pe săptămână, Pilotul pregătește ce se poate
 * scoate din pozele ultimelor șapte zile — cadrele în plus din serii și cele
 * puse la „Nu azi” — și spune cât spațiu eliberează. Omul verifică și confirmă;
 * nimic nu pleacă singur. Logică pură + ținerea de minte a săptămânii făcute.
 */
import type { PhotoView } from '../state/store';
import { photoTime } from './days';

const DAY = 86_400_000;
const DONE_KEY = 'cherrypic.weekly.done';

export interface WeeklyReport { photos: PhotoView[]; extras: number; rejected: number; bytes: number; week: string }

/** Luni–duminică, ca cheie: „2026-W46”. */
export function weekKey(now = Date.now()): string {
  const d = new Date(now);
  const day = (d.getDay() + 6) % 7;
  const thursday = new Date(d.getFullYear(), d.getMonth(), d.getDate() - day + 3);
  const first = new Date(thursday.getFullYear(), 0, 4);
  const week = 1 + Math.round(((thursday.getTime() - first.getTime()) / DAY - 3 + ((first.getDay() + 6) % 7)) / 7);
  return `${thursday.getFullYear()}-W${String(week).padStart(2, '0')}`;
}

export function buildWeeklyReport(photos: readonly PhotoView[], now = Date.now()): WeeklyReport {
  const since = now - 7 * DAY;
  const recent = photos.filter(p => !p.aside && p.mediaUri && photoTime(p) >= since);
  const groups = new Map<string, PhotoView[]>();
  for (const p of photos) {
    if (!p.groupId || p.aside) continue;
    const g = groups.get(p.groupId);
    if (g) g.push(p); else groups.set(p.groupId, [p]);
  }
  const out = new Map<string, PhotoView>();
  let extras = 0, rejected = 0;
  for (const p of recent) {
    if (p.status === 'selected') continue;
    if (p.status === 'rejected') { out.set(p.id, p); rejected++; continue; }
    const g = p.groupId ? groups.get(p.groupId) : undefined;
    if (!g || g.length < 2) continue;
    const best = g.find(x => x.status === 'selected') ?? [...g].sort((a, b) => b.aiScore - a.aiScore)[0];
    if (best.id !== p.id) { out.set(p.id, p); extras++; }
  }
  const list = [...out.values()];
  return { photos: list, extras, rejected, bytes: list.reduce((s, p) => s + (p.sizeBytes ?? 0), 0), week: weekKey(now) };
}

export function weeklyDone(week: string): boolean {
  try { return localStorage.getItem(DONE_KEY) === week; } catch { return false; }
}
export function markWeeklyDone(week: string): void {
  try { localStorage.setItem(DONE_KEY, week); } catch { /* fără stocare */ }
}
