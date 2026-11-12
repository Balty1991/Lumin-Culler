/**
 * lumin/reelPicks.ts
 * Pozele pentru un Reel / TikTok: cele mai bune păstrate din ultima săptămână (sau
 * din ultima lună, dacă săptămâna are prea puține), puse apoi în ordinea în care
 * au fost făcute — un film are poveste, nu clasament.
 */
import type { PhotoView } from '../state/store';
import { photoTime } from './days';

const DAY = 86_400_000;

export function reelPicks(photos: readonly PhotoView[], max = 12, now = Date.now()): string[] {
  const kept = photos.filter(p => p.status === 'selected' && !p.aside);
  const within = (days: number) => kept.filter(p => photoTime(p) >= now - days * DAY);
  let pool = within(7);
  if (pool.length < 6) pool = within(30);
  if (pool.length < 6) pool = kept;
  const score = (p: PhotoView) => (p.aesthetic ?? p.aiScore / 12) + (p.faceCount > 0 ? 0.6 : 0) + (p.bestSmile ?? 0);
  // Din serii, o singură poză: altfel Reel-ul arată de trei ori același cadru.
  const seenGroup = new Set<string>();
  const best = [...pool].sort((a, b) => score(b) - score(a)).filter(p => {
    if (!p.groupId) return true;
    if (seenGroup.has(p.groupId)) return false;
    seenGroup.add(p.groupId);
    return true;
  }).slice(0, max);
  return best.sort((a, b) => photoTime(a) - photoTime(b)).map(p => p.id);
}
