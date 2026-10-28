import { countGalleryPhotosSince, getPhotosAccess, isNativeMediaLibraryAvailable } from '../core/nativeMediaLibrary';
import { startOfDay } from '../core/todayDigest';
import { useStore } from '../state/store';
import { groupDays, photoTime } from './days';
import { readAutonomy } from './twin';

/**
 * lumin/autoSort.ts
 * Sortarea care se face singură (copia ta): când deschizi aplicația (sau revii în ea),
 * pozele noi de azi sunt aduse și alese fără niciun buton. Pe Azi apare apoi
 * „Am ales 4 din 27” — omul doar se uită, nu mai muncește.
 *
 * Tăcută când nu are ce face: fără acces la galerie, fără poze noi, în timpul
 * altui import. Cel mult o dată la câteva minute, ca să nu pornească la fiecare
 * ieșire scurtă din aplicație.
 */
const MIN_GAP_MS = 5 * 60_000;
let lastRun = 0;
let running = false;

export interface AutoSortResult { day: number; added: number; kept: number; waiting: number }

/** Copia sortează singură doar dacă îi dai voie (lumin/twin.ts: autonomia). */
export function autoSortEnabled(): boolean {
  return readAutonomy() !== 'suggest';
}

/**
 * Cu autonomia „decide tot” (Pro), și pozele nesigure primesc o decizie: cele
 * alese rămân, restul trec la „Nu azi” (nimic nu se șterge fără tine).
 */
export async function decideRestIfAllowed(): Promise<number> {
  const store = useStore.getState();
  if (readAutonomy() !== 'all' || store.premiumLocked) return 0;
  const day = groupDays(store.photos).find(d => d.start === startOfDay());
  const unsure = day?.waiting.filter(p => p.status === 'review').map(p => p.id) ?? [];
  return unsure.length ? store.acceptDayPicks(unsure) : 0;
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
    if (!added) return null;
    await decideRestIfAllowed();
    return summarizeToday(added);
  } catch {
    return null;
  } finally {
    running = false;
  }
}
