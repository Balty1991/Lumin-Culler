/**
 * state/batchOps.ts
 * Logica PURA a operatiilor in masa — separata de Zustand/Dexie, ca sa fie
 * testabila izolat (vezi batchOps.test.ts) si reutilizabila atat in store.ts
 * (aplicare reala) cat si in UI (preview live, fara efecte secundare).
 */
import type { PhotoView } from './store';

/**
 * Poze care ar fi respinse in bloc sub un prag de scor — exclude explicit
 * pozele deja SELECTATE (o decizie manuala nu e niciodata suprascrisa de o
 * actiune in masa) si pe cele deja RESPINSE (no-op, doar ar antrena inutil
 * modelul a doua oara pe aceeasi decizie).
 */
export function selectBulkRejectTargets(photos: PhotoView[], threshold: number): PhotoView[] {
  return photos.filter(p => p.status !== 'selected' && p.status !== 'rejected' && p.aiScore < threshold);
}

export interface GroupResolution {
  groupId: string;
  keepId: string;
  rejectIds: string[];
}

/**
 * Pentru fiecare serie (groupId), poza cu scorul cel mai mare ramane, restul
 * se resping — CU EXCEPTIA cand un membru e deja SELECTAT manual: acea poza
 * ramane "keep" (nu recalculam dupa aiScore), la fel ca invariantul din
 * selectBulkRejectTargets/selectTopPercent ("o decizie manuala nu e niciodata
 * suprascrisa de o actiune in masa"). Orice alt membru deja decis manual
 * (SELECTAT sau RESPINS) ramane neatins in rejectIds — bug real gasit de
 * auditul QA: varianta veche recalcula "best" pur dupa aiScore si respingea
 * necondtionat restul, putand suprascrie o alegere manuala facuta anterior in
 * afara acestei actiuni (ex. utilizatorul a preferat manual un cadru cu un
 * scor AI mai mic, dar o expresie mai buna).
 */
export function resolveGroups(photos: PhotoView[]): GroupResolution[] {
  const groups = new Map<string, PhotoView[]>();
  for (const p of photos) {
    if (!p.groupId) continue;
    const arr = groups.get(p.groupId);
    if (arr) arr.push(p); else groups.set(p.groupId, [p]);
  }
  return Array.from(groups.entries()).map(([groupId, members]) => {
    const manuallySelected = members.filter(m => m.status === 'selected');
    const keep = (manuallySelected.length ? manuallySelected : members)
      .reduce((a, b) => (a.aiScore >= b.aiScore ? a : b));
    const rejectIds = members
      .filter(m => m.id !== keep.id && m.status !== 'selected' && m.status !== 'rejected')
      .map(m => m.id);
    return { groupId, keepId: keep.id, rejectIds };
  });
}

export interface DeletableRejectedResult {
  /** Poze respinse care AU un URI nativ retinut (PhotoRecord.mediaUri) — singurele pentru care stergerea reala din stocare (deleteRejectedPhotos) e posibila. */
  deletable: PhotoView[];
  /** Poze respinse FARA URI retinut (importate pe web/PWA, prin <input type="file">, sau inainte de aceasta functie) — raman doar respinse in aplicatie, nesterse de pe disc. */
  skippedCount: number;
}

/**
 * Vezi PhotoRecord.mediaUri (core/db.ts) pentru de ce doar UNELE poze respinse
 * sunt eligibile — separam explicit cele doua grupuri (nu doar un filtru
 * simplu) ca UI-ul (BatchOpsPanel) sa poata arata onest cate poze raman
 * neatinse, in loc sa lase impresia falsa ca "sterge pozele respinse"
 * curata toata biblioteca de respinse.
 */
export function selectDeletableRejected(photos: PhotoView[]): DeletableRejectedResult {
  const rejected = photos.filter(p => p.status === 'rejected');
  const deletable = rejected.filter(p => !!p.mediaUri);
  return { deletable, skippedCount: rejected.length - deletable.length };
}

export interface TopPercentResult {
  selectIds: string[];
  rejectIds: string[];
}

/**
 * Auto-Cull: dintre pozele NEdecise inca (nu selectate/respinse manual —
 * aceeasi regula ca la selectBulkRejectTargets, o decizie manuala nu e
 * niciodata suprascrisa), pastreaza doar cele mai bune `percent`% dupa scor,
 * restul se resping — o singura actiune care inlocuieste trierea manuala
 * completa a unei sesiuni. La egalitate de scor, ordinea originala decide
 * cine ramane in procentul de sus (stable sort).
 */
export function selectTopPercent(photos: PhotoView[], percent: number): TopPercentResult {
  const undecided = photos.filter(p => p.status !== 'selected' && p.status !== 'rejected');
  const sorted = [...undecided].sort((a, b) => b.aiScore - a.aiScore);
  const keepCount = Math.min(sorted.length, Math.max(0, Math.round(sorted.length * percent / 100)));
  return {
    selectIds: sorted.slice(0, keepCount).map(p => p.id),
    rejectIds: sorted.slice(keepCount).map(p => p.id)
  };
}

/**
 * Filtrul "Ochi inchisi" e un semnal de revizuit manual — dar daca ALT cadru
 * din ACEEASI serie (acelasi groupId) cu ACELASI numar de fete (proxy pentru
 * "aceiasi oameni, aceeasi compozitie") are deja toti ochii deschisi, exista
 * deja o alternativa curata in rafala — pickBestInGroup (groupSelection.ts)
 * o va alege oricum ca "cel mai bun cadru" al seriei. Fara aceasta consensuare,
 * fiecare cadru cu ochi inchisi dintr-o rafala normala (ex. 5 poze, 1 clipeste)
 * aparea in filtru ca "problema", desi seria are deja un cadru bun. Filtrul
 * arata acum doar cazurile REALE: poze izolate sau serii unde NICIUN cadru
 * (cu acelasi numar de fete) nu are ochii deschisi.
 */
export function selectBlinks(photos: PhotoView[]): PhotoView[] {
  const cleanGroupFaceCounts = new Map<string, Set<number>>();
  for (const p of photos) {
    if (!p.groupId || p.faceCount === 0 || !p.allEyesOpen) continue;
    const set = cleanGroupFaceCounts.get(p.groupId) ?? new Set<number>();
    set.add(p.faceCount);
    cleanGroupFaceCounts.set(p.groupId, set);
  }
  return photos.filter(p => {
    if (p.faceCount === 0 || p.allEyesOpen) return false;
    if (p.groupId && cleanGroupFaceCounts.get(p.groupId)?.has(p.faceCount)) return false;
    return true;
  });
}

/**
 * "Highlights" (filtru pasiv, NU o actiune ca selectTopPercent): cele mai
 * bune poze din TOATA biblioteca dupa scorul AI, indiferent de status — util
 * ca instrument de DESCOPERIRE ("care sunt cele mai tari cadre din tot
 * evenimentul?"), nu de decizie — de-asta include si pozele deja respinse/
 * selectate, nu doar cele nedecise.
 * Minim 1 rezultat daca exista macar o poza, indiferent cat de mic e procentul.
 *
 * Dedup pe serie INAINTE de a alege top N%: fara asta, o rafala de 20 de
 * cadre aproape identice, toate cu scor mare (acelasi zambet, aceeasi
 * expunere — normal, sunt la cateva sutimi de secunda distanta), putea umple
 * SINGURA tot spatiul de highlights, lasand pe dinafara alte momente bune,
 * nerepetate, din restul evenimentului — exact opusul scopului de
 * "descoperire" declarat mai sus. Pastram doar cel mai bun cadru din fiecare
 * serie (acelasi criteriu ca resolveGroups) ca reprezentant, apoi alegem top
 * N% din ce ramane — procentul ramane raportat la TOTALUL bibliotecii (nu
 * doar la candidatii deduplicati), ca "10%" sa insemne tot "10% din poze",
 * nu "10% din momente unice" (ar da impresia gresita a unui set mult mai mare).
 */
export function selectHighlights(photos: PhotoView[], percent = 10): PhotoView[] {
  if (!photos.length) return [];
  const bestPerGroup = new Map<string, PhotoView>();
  const ungrouped: PhotoView[] = [];
  for (const p of photos) {
    if (!p.groupId) { ungrouped.push(p); continue; }
    const current = bestPerGroup.get(p.groupId);
    if (!current || p.aiScore > current.aiScore) bestPerGroup.set(p.groupId, p);
  }
  const candidates = [...bestPerGroup.values(), ...ungrouped];
  const sorted = candidates.sort((a, b) => b.aiScore - a.aiScore);
  const keepCount = Math.min(sorted.length, Math.max(1, Math.round(photos.length * percent / 100)));
  return sorted.slice(0, keepCount);
}
