/**
 * state/duplicateGroups.ts
 * "Duplicate gasite oriunde" (plan modernizare) — NU un detector nou: gruparea
 * dHash existenta (core/importPipeline.ts, hashCompare.worker.ts) compara deja
 * fiecare import cu toata biblioteca negrupata, indiferent de sursa/data
 * (vezi comentariul din DuplicatesPanel.tsx pentru context complet). Extras
 * intr-un modul propriu pentru ca aceeasi numaratoare e nevoie in 3 locuri
 * (DuplicatesPanel.tsx, HomeDashboard.tsx, MenuDrawer.tsx) — un singur loc de
 * calculat, nu trei copii care ar putea diverge silentios.
 */
import type { PhotoView } from './store';

/** Un grup e "rezolvat" cand cel mult un membru mai e altceva decat respins — nimic ramas de decis. */
export function isGroupResolved(members: Pick<PhotoView, 'status'>[]): boolean {
  return members.filter(m => m.status !== 'rejected').length <= 1;
}

/** Grupurile serie/duplicat (groupId) cu 2+ membri, inca nerezolvate — sortate descrescator dupa marime. */
export function selectUnresolvedGroups(photos: PhotoView[]): [string, PhotoView[]][] {
  const byId = new Map<string, PhotoView[]>();
  for (const p of photos) {
    if (!p.groupId) continue;
    const list = byId.get(p.groupId);
    if (list) list.push(p); else byId.set(p.groupId, [p]);
  }
  return Array.from(byId.entries())
    .filter(([, members]) => members.length > 1 && !isGroupResolved(members))
    .sort((a, b) => b[1].length - a[1].length);
}
