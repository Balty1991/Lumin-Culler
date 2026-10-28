/**
 * core/ritualStreak.ts
 * Câte zile la rând ai terminat alegerea de seară. Iertător, ca la cercetare
 * (reports/Direcție Lumin AI de sortare.md): o zi sărită nu rupe seria — în
 * zilele fără poze n-ai ce sorta, iar o serie care se rupe pentru asta
 * pedepsește exact omul care n-a greșit cu nimic. Două zile la rând sărite
 * o rup.
 */
import { startOfDay } from './todayDigest';

const STORAGE_KEY = 'lumin-ritual-days';
const DAY_MS = 86_400_000;
/** Cât poate lipsi între două zile terminate fără ca seria să se rupă. */
const MAX_GAP_DAYS = 2;
const KEEP_DAYS = 400;

export function streakOf(days: readonly number[], now: number = Date.now()): number {
  const sorted = [...new Set(days.map(d => startOfDay(d)))].sort((a, b) => b - a);
  if (!sorted.length) return 0;
  const today = startOfDay(now);
  if (Math.round((today - sorted[0]) / DAY_MS) > MAX_GAP_DAYS) return 0;
  let count = 1;
  for (let i = 1; i < sorted.length; i++) {
    if (Math.round((sorted[i - 1] - sorted[i]) / DAY_MS) > MAX_GAP_DAYS) break;
    count++;
  }
  return count;
}

export function readRitualDays(): number[] {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
    return Array.isArray(raw) ? raw.filter((d): d is number => typeof d === 'number' && Number.isFinite(d)) : [];
  } catch {
    return [];
  }
}

/** Notează ziua de azi ca terminată; întoarce seria nouă. */
export function recordRitualDay(now: number = Date.now()): number {
  const day = startOfDay(now);
  const days = [...new Set([...readRitualDays(), day])].filter(d => now - d < KEEP_DAYS * DAY_MS);
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(days)); } catch { /* fără stocare */ }
  return streakOf(days, now);
}
