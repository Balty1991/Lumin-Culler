/**
 * lumin/yearStats.ts
 * „Anul tău în poze”: cifrele unui an din galerie, pentru cardul de sfârșit de an.
 * Doar din ce e pe telefon: câte poze, câte păstrate, luna cea mai plină, omul care
 * apare cel mai des și cele mai reușite cadre. Logică pură.
 */
import type { PhotoView } from '../state/store';
import { photoTime } from './days';

export interface YearStats { year: number; total: number; kept: number; days: number; topMonth: number | null; topPerson: string | null; best: PhotoView[] }

export function yearStats(photos: readonly PhotoView[], year: number): YearStats | null {
  const list = photos.filter(p => !p.aside && new Date(photoTime(p)).getFullYear() === year);
  if (list.length < 20) return null;
  const kept = list.filter(p => p.status === 'selected');
  const months = new Array<number>(12).fill(0);
  const days = new Set<string>();
  const people = new Map<string, number>();
  for (const p of list) {
    const d = new Date(photoTime(p));
    months[d.getMonth()]++;
    days.add(`${d.getMonth()}-${d.getDate()}`);
  }
  for (const p of kept) for (const n of p.personNames ?? []) people.set(n, (people.get(n) ?? 0) + 1);
  const top = [...people.entries()].sort((a, b) => b[1] - a[1])[0];
  const score = (p: PhotoView) => (p.aesthetic ?? p.aiScore / 12) + (p.personNames?.length ? 0.6 : 0);
  // Cele mai bune trei, din luni diferite când se poate: anul, nu o singură zi.
  const sorted = [...(kept.length >= 3 ? kept : list)].sort((a, b) => score(b) - score(a));
  const best: PhotoView[] = [];
  const usedMonths = new Set<number>();
  for (const p of sorted) { const m = new Date(photoTime(p)).getMonth(); if (!usedMonths.has(m)) { usedMonths.add(m); best.push(p); } if (best.length === 3) break; }
  for (const p of sorted) { if (best.length === 3) break; if (!best.includes(p)) best.push(p); }
  return { year, total: list.length, kept: kept.length, days: days.size, topMonth: months.indexOf(Math.max(...months)), topPerson: top && top[1] >= 3 ? top[0] : null, best };
}

/** Sezonul în care „Anul tău” se arată singur pe Azi: 25 noiembrie – 15 ianuarie. Întoarce anul de rezumat. */
export function yearSeason(now = Date.now()): number | null {
  const d = new Date(now);
  const m = d.getMonth(), day = d.getDate();
  if (m === 11 || (m === 10 && day >= 25)) return d.getFullYear();
  if (m === 0 && day <= 15) return d.getFullYear() - 1;
  return null;
}
