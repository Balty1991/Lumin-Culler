import { useStore } from '../state/store';
import { missingNativePhotos } from '../core/nativeMediaLibrary';
import { t } from '../i18n';

/**
 * lumin/gallerySync.ts
 * Ce ștergi din Galeria telefonului (sau din altă aplicație) dispare și din Cherrypic: la
 * pornire, la fiecare întoarcere în aplicație și când o ștergere eșuează. Raportat: „am șters
 * o poză din Galerie, dar în aplicație încă apare și nu o pot șterge”.
 */
let running = false;
let lastRun = 0;

export async function syncGalleryDeletions(onlyIds?: string[]): Promise<number> {
  if (running) return 0;
  running = true;
  try {
    const st = useStore.getState();
    const only = onlyIds ? new Set(onlyIds) : null;
    const list = st.photos.filter(p => p.mediaUri && (!only || only.has(p.id)));
    if (!list.length) return 0;
    const missing = new Set(await missingNativePhotos(list.map(p => p.mediaUri!)));
    if (!missing.size) return 0;
    const ids = list.filter(p => missing.has(p.mediaUri!)).map(p => p.id);
    // Plasă de siguranță: dacă „lipsește” aproape toată galeria, e o problemă de permisiune,
    // nu o ștergere — nu scoatem nimic.
    if (!only && ids.length > Math.max(20, list.length * 0.5)) return 0;
    const n = await st.forgetGonePhotos(ids);
    if (n > 0) st.setNotice(t(st.locale, n === 1 ? 'lx.sync.goneOne' : 'lx.sync.gone', { count: n }));
    return n;
  } finally {
    running = false;
    lastRun = Date.now();
  }
}

/** La întoarcerea în aplicație, cel mult o dată la 20 de secunde. */
export function watchGalleryDeletions(): () => void {
  const onShow = () => {
    if (document.visibilityState !== 'visible' || Date.now() - lastRun < 20_000) return;
    void syncGalleryDeletions();
  };
  document.addEventListener('visibilitychange', onShow);
  window.addEventListener('focus', onShow);
  void syncGalleryDeletions();
  return () => { document.removeEventListener('visibilitychange', onShow); window.removeEventListener('focus', onShow); };
}
