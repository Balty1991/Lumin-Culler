/**
 * state/decisionInversions.ts
 * "Decizii in contradictie" — pereche de verificat, nu acuzatie.
 *
 * Ce prinde: in ACEEASI serie (groupId, gruparea dHash din importPipeline), o
 * poza RESPINSA cu scor vizibil mai mare decat cea mai buna poza PASTRATA din
 * grup. Fluxul principal al aplicatiei e sortarea rapida, unde deciziile se iau
 * cu degetul, repede, una dupa alta — iar o atingere care nimereste "Sterg" in
 * loc de "Pastrez" nu lasa nicio urma vizibila pana cand nu te uiti pe rezultat.
 *
 * De ce NU excludem pozele decise manual, spre deosebire de pickMostUncertain
 * (core/uncertainty.ts): acolo intrebarea e "unde nu stiu sigur EU, modelul",
 * deci o decizie umana inchide subiectul. Aici intrebarea e exact pe dos —
 * greseala pe care o cautam se poate produce DOAR intr-o decizie umana.
 *
 * Pragul e deliberat mare: intre doua cadre din aceeasi rafala, o diferenta de
 * cateva puncte e zgomot (o clipire, un fir de par), si e absolut normal sa
 * pastrezi cadrul cu scorul putin mai mic fiindca ACOLO subiectul arata mai
 * bine. La 15 puncte diferenta vorbim insa de altceva: una e clara si cealalta
 * nu, sau una are ochii deschisi si cealalta nu.
 */
import type { PhotoRecord } from '../core/db';

/** Diferenta de scor de la care perechea merita aratata. Vezi nota de sus. */
export const MIN_SCORE_GAP = 15;
/** Cate perechi propunem intr-o trecere — acelasi ordin de marime ca UNCERTAIN_BATCH. */
export const INVERSION_BATCH = 24;

export interface InversionCandidate {
  id: string;
  groupId?: string;
  status: PhotoRecord['status'];
  aiScore: number;
}

/**
 * Id-urile pozelor RESPINSE care par respinse din greseala, cele mai mari
 * diferente primele. Intoarce doar respinsele: ele sunt cele care ar disparea
 * la "Sterge pozele respinse", deci ele sunt cele de recuperat.
 */
export function selectDecisionInversions(
  photos: readonly InversionCandidate[],
  minGap = MIN_SCORE_GAP,
  limit = INVERSION_BATCH
): string[] {
  const byGroup = new Map<string, InversionCandidate[]>();
  for (const p of photos) {
    if (!p.groupId) continue;
    const list = byGroup.get(p.groupId);
    if (list) list.push(p); else byGroup.set(p.groupId, [p]);
  }

  const found: { id: string; gap: number }[] = [];
  for (const members of byGroup.values()) {
    // Cea mai buna poza pastrata din grup e reperul: daca ai pastrat ceva mai
    // slab decat ai respins, diferenta se masoara fata de cel mai bun lucru pe
    // care l-ai pastrat, nu fata de o medie.
    let bestKept = -1;
    for (const m of members) if (m.status === 'selected' && m.aiScore > bestKept) bestKept = m.aiScore;
    if (bestKept < 0) continue; // grup fara nicio poza pastrata — nu exista contradictie

    for (const m of members) {
      if (m.status !== 'rejected') continue;
      const gap = m.aiScore - bestKept;
      if (gap >= minGap) found.push({ id: m.id, gap });
    }
  }

  return found
    .sort((a, b) => b.gap - a.gap)
    .slice(0, Math.max(0, limit))
    .map(f => f.id);
}

/** Cate contradictii exista in total — pentru pastila din meniu, fara plafon. */
export function countDecisionInversions(photos: readonly InversionCandidate[], minGap = MIN_SCORE_GAP): number {
  return selectDecisionInversions(photos, minGap, Number.MAX_SAFE_INTEGER).length;
}
