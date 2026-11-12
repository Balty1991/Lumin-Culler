/**
 * lumin/minuteBatch.ts
 * „Un minut azi”: din pozele vechi rămase nehotărâte, 10 pe zi — cele mai noi întâi
 * (se țin minte mai bine). Așa galeria nu se mai adună, fără o sesiune lungă.
 */
import type { PhotoView } from '../state/store';
import { startOfDay } from '../core/todayDigest';
import { photoTime } from './days';

export const MINUTE_BATCH = 10;
const WAITING = new Set(['review', 'pending', 'candidate']);

export function minuteBatch(photos: readonly PhotoView[], now = Date.now()): { ids: string[]; left: number } {
  const today = startOfDay(now);
  const old = photos.filter(p => !p.aside && WAITING.has(p.status) && startOfDay(photoTime(p)) < today);
  old.sort((a, b) => photoTime(b) - photoTime(a));
  return { ids: old.slice(0, MINUTE_BATCH).map(p => p.id), left: old.length };
}
