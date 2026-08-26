import type { PhotoView } from './store';

/**
 * "Sortare stil TikTok" (plan modernizare) — coada de poze nedecise pentru
 * fluxul plin-ecran, un pointer vertical la un moment dat. Include atat
 * 'pending' cat si 'review' (ambele sunt "inca nedecise" — 'review' e doar
 * un sub-caz cu scor AI ambiguu, tot un candidat valid pentru triaj rapid).
 *
 * SERIILE VIN PRIMELE. Cerinta directa a utilizatorului: "dupa ce importi si
 * intri in biblioteca, ar trebui sa apara in revizuire printre primele si
 * seriile de fotografii, ca ti-ar scuti din timp".
 *
 * Are dreptate, si motivul e aritmetic: o serie de cinci cadre se rezolva cu O
 * atingere ("Pastreaza doar acesta") si scoate cinci poze din coada. O poza
 * singura cere o decizie si scoate una. Pana acum coada era strict cronologica,
 * deci seriile stateau imprastiate prin ea la intamplare — cel mai profitabil
 * lucru pe care il poti face era si cel mai greu de nimerit.
 *
 * Ce se pastreaza din ordinea veche: cronologia, in doua locuri. In interiorul
 * unei serii cadrele raman in ordinea in care au fost facute (altfel comparatia
 * n-ar mai avea sens), iar restul pozelor, dupa serii, raman un fir narativ.
 *
 * Ce NU se schimba: "Vezi toate" (selectAllPhotosQueue) ramane strict
 * cronologica — acolo omul verifica ce a facut motorul, nu triaza, deci
 * profitul per atingere nu mai e criteriul potrivit.
 */
export function selectSortQueue(photos: PhotoView[]): PhotoView[] {
  const byTime = (a: PhotoView, b: PhotoView) => (a.capturedAt ?? 0) - (b.capturedAt ?? 0);
  const undecided = photos.filter(p => p.status === 'pending' || p.status === 'review');

  // Cati membri NEDECISI are fiecare serie. Membrii deja hotarati nu conteaza:
  // o serie din care a mai ramas un singur cadru nedecis nu mai e o comparatie,
  // e o poza obisnuita, si n-are de ce sa treaca in fata.
  const undecidedPerGroup = new Map<string, number>();
  for (const p of undecided) {
    if (p.groupId) undecidedPerGroup.set(p.groupId, (undecidedPerGroup.get(p.groupId) ?? 0) + 1);
  }
  const isSeries = (p: PhotoView) => !!p.groupId && (undecidedPerGroup.get(p.groupId) ?? 0) >= 2;

  // Membrii aceleiasi serii stau lipiti. Altfel ai vedea un cadru, apoi zece
  // poze fara legatura, apoi celalalt cadru — adica exact comparatia pe care
  // seria trebuia s-o faca usoara.
  const groups = new Map<string, PhotoView[]>();
  for (const p of undecided.filter(isSeries)) {
    const list = groups.get(p.groupId!);
    if (list) list.push(p); else groups.set(p.groupId!, [p]);
  }

  const orderedGroups = [...groups.values()]
    .map(members => [...members].sort(byTime))
    // Seria mare inaintea celei mici: scoate mai multe poze din coada pentru
    // aceeasi atingere. La marime egala, cea mai veche prima, ca sa nu se rupa
    // firul cronologic mai mult decat e nevoie.
    .sort((a, b) => b.length - a.length || byTime(a[0], b[0]));

  return [...orderedGroups.flat(), ...undecided.filter(p => !isSeries(p)).sort(byTime)];
}

/**
 * TOATE pozele, in ordine cronologica — inclusiv cele pe care AI-ul le-a decis
 * deja singur.
 *
 * Cerinta directa a utilizatorului: "in foto am 77, dar 22 in revizuire; cand
 * dau pe revizuire fa un buton sa pot sa le parcurg din nou pe toate daca
 * vreau". Coada normala (mai sus) arata doar ce n-a fost decis — bun cand
 * lucrezi, inutil cand vrei sa VERIFICI ce a facut motorul pe restul.
 */
export function selectAllPhotosQueue(photos: PhotoView[]): PhotoView[] {
  return [...photos].sort((a, b) => (a.capturedAt ?? 0) - (b.capturedAt ?? 0));
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
