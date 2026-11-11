/**
 * lumin/morningReport.ts
 * „Raportul de dimineață”: ce a făcut Pilotul cu pozele de ieri — câte a păstrat,
 * câte a pus deoparte și câte au rămas de hotărât. O dată pe zi, la prima deschidere.
 * Logică pură; cardul e în TodayScreen (MorningReportCard).
 */
import type { PhotoView } from '../state/store';
import { startOfDay } from '../core/todayDigest';
import { photoTime } from './days';

const SEEN_KEY = 'cherrypic.morning.seen';
export const MORNING_MIN_PHOTOS = 5;

export interface MorningReport { day: number; total: number; kept: PhotoView[]; waiting: PhotoView[]; dropped: number }

export function buildMorningReport(photos: readonly PhotoView[], now = Date.now()): MorningReport | null {
  const today = startOfDay(now);
  const y = new Date(today); y.setDate(y.getDate() - 1);
  const day = startOfDay(y.getTime());
  const list = photos.filter(p => !p.aside && startOfDay(photoTime(p)) === day);
  if (list.length < MORNING_MIN_PHOTOS) return null;
  const score = (p: PhotoView) => p.aesthetic ?? p.aiScore / 12;
  return {
    day, total: list.length,
    kept: list.filter(p => p.status === 'selected').sort((a, b) => score(b) - score(a)),
    waiting: list.filter(p => p.status === 'review' || p.status === 'pending' || p.status === 'candidate'),
    dropped: list.filter(p => p.status === 'rejected').length
  };
}

export function morningSeen(day: number): boolean {
  try { return localStorage.getItem(SEEN_KEY) === String(day); } catch { return true; }
}
export function markMorningSeen(day: number): void {
  try { localStorage.setItem(SEEN_KEY, String(day)); } catch { /* fără stocare */ }
}
