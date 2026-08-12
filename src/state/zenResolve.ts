import type { PhotoView } from './store';
import { resolveGroups } from './batchOps';

/**
 * Pragul de diferenta de scor AI intre cea mai buna si a doua cea mai buna
 * poza dintr-o serie, sub care consideram grupul "incert" (Mod Zen, plan
 * modernizare — mockup-ul cere explicit distinctia "cazuri clare" vs "cazuri
 * incerte", nu o singura decizie oarba). Peste acest prag, diferenta e destul
 * de mare incat sa fie clar care poza e mai buna.
 */
const CONFIDENT_SCORE_GAP = 10;

/**
 * Grupurile cu poze de mai multe persoane raman "incerte" chiar si cu un scor
 * clar diferit — exact exemplul din mockup ("ex: poze cu multe fete"): intr-o
 * poza de grup, cine zambeste/are ochii deschisi variaza per persoana, un
 * singur scor agregat ascunde nuante pe care utilizatorul chiar vrea sa le vada.
 */
const UNCERTAIN_MAX_FACES = 3;

export interface ZenGroupResolution {
  groupId: string;
  keepId: string;
  rejectIds: string[];
  /** true = diferenta de scor e destul de mare (si nu e o poza de grup cu multe fete) ca sa decidem singuri; false = merita atentia utilizatorului. */
  confident: boolean;
}

/**
 * La fel ca resolveGroups (state/batchOps.ts), dar adauga eticheta
 * confident/incert per grup — vezi Mod Zen (core/zenMode.ts, ui/ZenModePanel.tsx)
 * pentru cum e folosita: doar grupurile "confident" sunt rezolvate automat,
 * cele "incerte" raman pending, semnalate separat utilizatorului.
 */
export function resolveGroupsWithConfidence(photos: PhotoView[]): ZenGroupResolution[] {
  const byGroup = new Map<string, PhotoView[]>();
  for (const p of photos) {
    if (!p.groupId) continue;
    const arr = byGroup.get(p.groupId);
    if (arr) arr.push(p); else byGroup.set(p.groupId, [p]);
  }
  return resolveGroups(photos).map(res => {
    const members = byGroup.get(res.groupId) ?? [];
    const scores = members.map(m => m.aiScore).sort((a, b) => b - a);
    const gap = scores.length >= 2 ? scores[0] - scores[1] : Infinity;
    const maxFaces = members.reduce((max, m) => Math.max(max, m.faceCount), 0);
    const confident = gap >= CONFIDENT_SCORE_GAP && maxFaces <= UNCERTAIN_MAX_FACES;
    return { ...res, confident };
  });
}
