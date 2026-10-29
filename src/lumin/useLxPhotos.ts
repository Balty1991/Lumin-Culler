import { useMemo } from 'react';
import { useStore, type PhotoView } from '../state/store';

/**
 * lumin/useLxPhotos.ts
 * Pozele pe care le arată Cherrypic: toate, mai puțin cele ascunse în „Poze
 * private” (dosarul privat, cu PIN). Ele nu apar pe Azi, în Galerie, în
 * momente, în curățenie sau pe widget — doar în ecranul lor, după PIN.
 */
export function useLxPhotos(): PhotoView[] {
  const photos = useStore(s => s.photos);
  const collections = useStore(s => s.collections);
  return useMemo(() => {
    const vault = collections.find(c => c.isPrivate);
    if (!vault?.memberIds.length) return photos;
    const hidden = new Set(vault.memberIds);
    return photos.filter(p => !hidden.has(p.id));
  }, [photos, collections]);
}

/** La fel, în afara componentelor (widget, notificări, acțiuni din notificare). */
export function visiblePhotos(): PhotoView[] {
  const { photos, collections } = useStore.getState();
  const vault = collections.find(c => c.isPrivate);
  if (!vault?.memberIds.length) return photos;
  const hidden = new Set(vault.memberIds);
  return photos.filter(p => !hidden.has(p.id));
}
