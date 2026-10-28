import { countGalleryPhotosSince, getPhotosAccess, isNativeMediaLibraryAvailable } from '../core/nativeMediaLibrary';
import { startOfDay } from '../core/todayDigest';
import { useStore } from '../state/store';
import { groupDays, photoTime } from './days';

/**
 * lumin/autoSort.ts
 * Sortarea care se face singură: când deschizi aplicația (sau revii în ea),
 * pozele noi de azi sunt aduse și alese fără niciun buton. Pe Azi apare apoi
 * „Am ales 4 din 27” — omul doar se uită, nu mai muncește.
 *
 * Tăcută când nu are ce face: fără acces la galerie, fără poze noi, în timpul
 * altui import. Cel mult o dată la câteva minute, ca să nu pornească la fiecare
 * ieșire scurtă din aplicație.
 */
const KEY = 'lumin-auto-sort';
const MIN_GAP_MS = 5 * 60_000;
let lastRun = 0;
let running = false;

export interface AutoSortResult { day: number; added: number; kept: number; waiting: number }

export function autoSortEnabled(): boolean {
  try { return localStorage.getItem(KEY) !== 'off'; } catch { return true; }
}

export function setAutoSortEnabled(on: boolean): void {
  try { localStorage.setItem(KEY, on ? 'on' : 'off'); } catch { /* fără stocare: rămâne pornită */ }
}

/** Rezultatul pentru ziua de azi, după ce s-au adus `added` poze noi. */
export function summarizeToday(added: number): AutoSortResult | null {
  const day = startOfDay();
  const today = groupDays(useStore.getState().photos).find(d => d.start === day);
  if (!today || added <= 0) return null;
  return { day, added, kept: today.kept.length, waiting: today.waiting.length };
}

/** Aduce și sortează pozele noi de azi. `force` sare peste pauza dintre rulări (notificarea de seară). */
export async function autoSortToday(force = false): Promise<AutoSortResult | null> {
  if (running || !isNativeMediaLibraryAvailable()) return null;
  if (!force && (!autoSortEnabled() || Date.now() - lastRun < MIN_GAP_MS)) return null;
  const store = useStore.getState();
  if (store.supervisorImporting || (store.progress && store.progress.phase !== 'finalizat')) return null;
  running = true;
  lastRun = Date.now();
  try {
    if ((await getPhotosAccess()) === 'limited') return null;
    const day = startOfDay();
    const r = await countGalleryPhotosSince(day);
    const known = useStore.getState().photos.filter(p => photoTime(p) >= day).length;
    if (!r.granted || r.count <= known) return null;
    const added = await useStore.getState().importToday();
    return added ? summarizeToday(added) : null;
  } catch {
    return null;
  } finally {
    running = false;
  }
}
