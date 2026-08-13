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
 * Coada pentru o lista EXPLICITA de poze (tiktokSortScopeIds), pastrand exact
 * ordinea primita.
 *
 * Bug real raportat de utilizator: "Verifica deciziile la limita" arata "Totul
 * sortat!" desi avea 28 de poze de verificat. Cauza: apelantul filtra lista
 * primita prin selectSortQueue, care tine doar pozele NEDECISE — iar pozele de
 * la limita sunt, prin definitie, deja decise automat (selected/rejected, vezi
 * core/uncertainty.ts). Intersectia era mereu goala. Acelasi lucru lovea si
 * "verifica cele mai riscante" din Operatii in masa, care propune poze RESPINSE.
 *
 * De aceea aici nu exista niciun filtru pe status: cine cere anume niste id-uri
 * a decis deja ce merita aratat. Ordinea primita e pastrata pentru ca poarta
 * informatie (cele mai nesigure primele) — o resortare cronologica ar arunca-o.
 * Se pastreaza doar id-urile care mai exista in `photos`, ca o poza stearsa
 * intre timp sa nu lase un cadru gol in coada.
 */
export function selectScopedQueue(photos: PhotoView[], scopeIds: readonly string[]): PhotoView[] {
  const byId = new Map(photos.map(p => [p.id, p]));
  return scopeIds.map(id => byId.get(id)).filter((p): p is PhotoView => p !== undefined);
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
