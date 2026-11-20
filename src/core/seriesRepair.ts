/**
 * core/seriesRepair.ts
 * O singură dată după actualizare: scoate din serii pozele pe care amprenta CLIP le
 * arată ca fiind altă scenă (vezi CLIP_SCENE_VETO în workers/hashCompare.worker.ts).
 * Gruparea nouă nu le mai pune împreună, dar seriile deja salvate nu se recalculează.
 * Raportat: fetița cu geaca portocalie și fetița cu câinele erau „aproape la fel”.
 */
import { db } from './db';

const DONE_KEY = 'lumin-series-clip-repair-1';
export const SERIES_CLIP_VETO = 0.78;

function cosine(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

/** Membrii care nu seamănă (CLIP) cu niciun alt membru al seriei lor. */
export function mismatchedMembers(groups: Map<string, { id: string; clip?: ArrayLike<number> }[]>): string[] {
  const out: string[] = [];
  for (const members of groups.values()) {
    const withClip = members.filter(m => m.clip && m.clip.length === 512);
    if (withClip.length < 2) continue;
    const loners = withClip.filter(m => !withClip.some(o => o !== m && cosine(m.clip!, o.clip!) >= SERIES_CLIP_VETO));
    // Rămâne o singură poză în serie: nu mai e serie.
    const left = members.length - loners.length;
    out.push(...(left < 2 ? members.map(m => m.id) : loners.map(m => m.id)));
  }
  return out;
}

export async function repairSeriesOnce(): Promise<void> {
  try { if (localStorage.getItem(DONE_KEY)) return; } catch { return; }
  const grouped = await db.photos.where('groupId').above('').toArray();
  if (grouped.length) {
    const analyses = await db.analyses.bulkGet(grouped.map(p => p.id));
    const groups = new Map<string, { id: string; clip?: ArrayLike<number> }[]>();
    grouped.forEach((p, i) => {
      const list = groups.get(p.groupId!) ?? [];
      list.push({ id: p.id, clip: analyses[i]?.clipEmbedding });
      groups.set(p.groupId!, list);
    });
    const ids = mismatchedMembers(groups);
    if (ids.length) await db.photos.where('id').anyOf(ids).modify({ groupId: '' });
  }
  try { localStorage.setItem(DONE_KEY, '1'); } catch { /* fără stocare */ }
}
