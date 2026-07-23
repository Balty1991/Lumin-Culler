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

/** Pentru fiecare serie (groupId), poza cu scorul cel mai mare ramane, restul se resping. */
export function resolveGroups(photos: PhotoView[]): GroupResolution[] {
  const groups = new Map<string, PhotoView[]>();
  for (const p of photos) {
    if (!p.groupId) continue;
    const arr = groups.get(p.groupId);
    if (arr) arr.push(p); else groups.set(p.groupId, [p]);
  }
  return Array.from(groups.entries()).map(([groupId, members]) => {
    const best = members.reduce((a, b) => (a.aiScore >= b.aiScore ? a : b));
    return { groupId, keepId: best.id, rejectIds: members.filter(m => m.id !== best.id).map(m => m.id) };
  });
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
