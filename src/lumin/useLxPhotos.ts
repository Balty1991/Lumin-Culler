import { useMemo, useSyncExternalStore } from 'react';
import { useStore, type PhotoView } from '../state/store';
import { useArchive } from './archive';
import { useLx } from './lxStore';

/**
 * lumin/useLxPhotos.ts
 * Pozele pe care le arată Cherrypic: toate, mai puțin cele ascunse în „Poze
 * private” (dosarul privat, cu PIN). Ele nu apar pe Azi, în Galerie, în
 * momente, în curățenie sau pe widget — doar în ecranul lor, după PIN.
 */
/**
 * Lista de poze, cum ajunge la ecrane. În timpul citirii galeriei, lista crește cu
 * fiecare poză analizată, iar fiecare creștere redesena Azi, Galeria și tot ce
 * numără poze — pe o galerie de peste o mie, ecranul rămânea blocat secunde întregi
 * (văzut în înregistrare: galeria înghețată, „Nu azi” fără răspuns). Acum, cât se
 * citește, pozele NOI ajung pe ecran cel mult o dată la două secunde; o decizie a
 * omului (aceeași listă, alt status) trece pe loc, ca butonul să răspundă imediat.
 */
const THROTTLE_MS = 2000;
let live = useStore.getState().photos;
let shown = live;
let lastFlush = 0;
let timer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

function reading(): boolean {
  const s = useStore.getState();
  return !!useLx.getState().reader || s.supervisorImporting || (!!s.progress && s.progress.phase !== 'finalizat');
}
function flush(): void {
  if (timer) { clearTimeout(timer); timer = null; }
  if (shown === live) return;
  shown = live;
  lastFlush = Date.now();
  for (const l of listeners) l();
}
/** Ce hotărăște dacă o schimbare trece pe loc: exportat pentru teste. */
export function passesNow(busy: boolean, sameLength: boolean, sinceFlush: number): boolean {
  return !busy || sameLength || sinceFlush >= THROTTLE_MS;
}
useStore.subscribe(s => {
  if (s.photos === live) return;
  live = s.photos;
  const since = Date.now() - lastFlush;
  if (passesNow(reading(), live.length === shown.length, since)) flush();
  else if (!timer) timer = setTimeout(flush, THROTTLE_MS - since);
});
function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}
/** Pozele din magazin, cu ritmul de mai sus. Pentru ecranele care doar le arată. */
export function usePacedPhotos(): PhotoView[] {
  return useSyncExternalStore(subscribe, () => shown);
}

export function useLxPhotos(): PhotoView[] {
  const photos = usePacedPhotos();
  const collections = useStore(s => s.collections);
  const archived = useArchive(s => s.ids);
  return useMemo(() => hide(photos, collections, archived), [photos, collections, archived]);
}

/** Fără „Poze private” și fără Arhivă (lumin/archive.ts). */
function hide(photos: PhotoView[], collections: { isPrivate?: boolean; memberIds: string[] }[], archived: ReadonlySet<string>): PhotoView[] {
  const vault = collections.find(c => c.isPrivate);
  if (!vault?.memberIds.length && archived.size === 0) return photos;
  const hidden = new Set(vault?.memberIds ?? []);
  return photos.filter(p => !hidden.has(p.id) && !archived.has(p.id));
}

/** La fel, în afara componentelor (widget, notificări, acțiuni din notificare). */
export function visiblePhotos(): PhotoView[] {
  const { photos, collections } = useStore.getState();
  return hide(photos, collections, useArchive.getState().ids);
}
