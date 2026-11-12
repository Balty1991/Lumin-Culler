/**
 * lumin/beginner.ts
 * „Modul de început”: în primele zile, până la primele 30 de decizii ale omului, ecranul
 * Azi arată doar esențialul (pozele de hotărât, citirea galeriei, antrenamentul, oferta).
 * Studio, amintirile și restul apar după aceea. Motiv: un om nou trebuie să înțeleagă în
 * câteva secunde ce face aplicația, nu să vadă 20 de carduri (evaluarea din 12 nov.).
 */
import type { PhotoView } from '../state/store';

const KEY = 'cherrypic.firstSeen';
export const BEGINNER_DECISIONS = 30;
export const BEGINNER_DAYS = 3;

function firstSeen(now: number): number {
  try {
    const raw = Number(localStorage.getItem(KEY));
    if (raw > 0) return raw;
    localStorage.setItem(KEY, String(now));
  } catch { /* fără stocare: tratat ca nou azi */ }
  return now;
}

export function isBeginner(photos: readonly PhotoView[], now = Date.now()): boolean {
  let decided = 0;
  for (const p of photos) {
    if ((p.status === 'selected' || p.status === 'rejected') && !p.aiDecided) {
      if (++decided >= BEGINNER_DECISIONS) return false;
    }
  }
  return now - firstSeen(now) < BEGINNER_DAYS * 86_400_000;
}
