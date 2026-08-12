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

/**
 * Rand EXIF compact pentru Sortare rapida ("f/2.8 · 1/125s · ISO 200 · 24mm") —
 * datele sunt reale (PhotoView.fNumber/exposureTime/iso/focalLength, extrase
 * la import de core/exifParser.ts), aici doar formatate. `null` cand poza nu
 * are deloc metadate EXIF (nici un camp), nu un rand gol/inselator.
 */
export function formatExifLine(photo: PhotoView): string | null {
  const parts: string[] = [];
  if (photo.fNumber) parts.push(`f/${photo.fNumber}`);
  if (photo.exposureTime) {
    parts.push(photo.exposureTime >= 1
      ? `${Math.round(photo.exposureTime)}s`
      : `1/${Math.round(1 / photo.exposureTime)}s`);
  }
  if (photo.iso) parts.push(`ISO ${photo.iso}`);
  if (photo.focalLength) parts.push(`${Math.round(photo.focalLength)}mm`);
  return parts.length ? parts.join(' · ') : null;
}
