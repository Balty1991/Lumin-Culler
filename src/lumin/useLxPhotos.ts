import { useMemo } from 'react';
import { useStore, type PhotoView } from '../state/store';
import { useArchive } from './archive';

/**
 * lumin/useLxPhotos.ts
 * Pozele pe care le arată Cherrypic: toate, mai puțin cele ascunse în „Poze
 * private” (dosarul privat, cu PIN). Ele nu apar pe Azi, în Galerie, în
 * momente, în curățenie sau pe widget — doar în ecranul lor, după PIN.
 */
export function useLxPhotos(): PhotoView[] {
  const photos = useStore(s => s.photos);
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
