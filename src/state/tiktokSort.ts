import type { PhotoView } from './store';

/**
 * "Sortare stil TikTok" (plan modernizare) — coada de poze nedecise pentru
 * fluxul plin-ecran, un pointer vertical la un moment dat. Include atat
 * 'pending' cat si 'review' (ambele sunt "inca nedecise" — 'review' e doar
 * un sub-caz cu scor AI ambiguu, tot un candidat valid pentru triaj rapid).
 * Sortata cronologic (capturedAt) ca sa semene cu un fir narativ, nu o
 * ordine arbitrara de import.
 */
export function selectSortQueue(photos: PhotoView[]): PhotoView[] {
  return photos
    .filter(p => p.status === 'pending' || p.status === 'review')
    .sort((a, b) => (a.capturedAt ?? 0) - (b.capturedAt ?? 0));
}

/**
 * Numarul de poze din aceeasi serie (grup detectat prin hash perceptual) ca
 * `photo`, folosit pentru caption-ul "Parte dintr-o serie de N" — 0 cand
 * poza nu apartine niciunui grup (nu afisam caption fals cand nu exista
 * niciun semnal AI real de aratat).
 */
export function countSeriesSiblings(photos: PhotoView[], photo: PhotoView): number {
  if (!photo.groupId) return 0;
  return photos.reduce((n, p) => (p.groupId === photo.groupId ? n + 1 : n), 0);
}
