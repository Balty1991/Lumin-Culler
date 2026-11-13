import { countGalleryPhotosSince, getPhotosAccess, isNativeMediaLibraryAvailable } from '../core/nativeMediaLibrary';
import { startOfDay } from '../core/todayDigest';
import { t } from '../i18n';
import { autopilotKeeps } from '../state/batchOps';
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
 * `today` = doar ziua asta (la deschidere). `library` = toată galeria deja citită,
 * cu o confirmare, ca „Sortează tot” să nu lase lunile vechi pe loc.
 */
export async function decideRestIfAllowed(scope: 'today' | 'library' = 'today'): Promise<number> {
  const store = useStore.getState();
  if (readAutonomy() !== 'all' || store.premiumLocked) return 0;
  const pool = scope === 'library'
    ? store.photos.filter(p => !p.aside && p.status === 'review')
    : (groupDays(store.photos).find(d => d.start === startOfDay())?.waiting.filter(p => p.status === 'review') ?? []);
  // Familia rămâne de hotărât de om, și la ziua de azi, și la toată galeria.
  const unsure = pool.filter(p => autopilotKeeps(p) !== 'family').map(p => p.id);
  if (!unsure.length) return 0;
  if (scope === 'library') {
    const ok = await store.askConfirm(t(store.locale, 'lx.sortAll.confirm', { count: unsure.length }), { confirmLabel: t(store.locale, 'lx.today.acceptAll') });
    if (!ok) return 0;
  }
  return store.acceptDayPicks(unsure);
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
    await (await import('./trainingGate')).holdUntilLearned().catch(() => 0);
    await decideRestIfAllowed();
    return summarizeToday(added);
  } catch {
    return null;
  } finally {
    running = false;
  }
}
