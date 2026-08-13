/**
 * core/groupSelection.ts
 * Alegerea "celei mai bune" poze dintr-un grup de cadre similare (serie/
 * duplicate), aplicand o ierarhie de criterii fotografice explicita —
 * claritate > expunere > compozitie > expresii faciale > contact vizual —
 * in loc sa se bazeze STRICT pe scorul AI brut (care, la "cold start" cu
 * modelul neantrenat, poate fi aproape identic pentru cadre foarte similare
 * si nu distinge bine intre ele).
 *
 * Zero dependinte (nu importa db.ts / store.ts / Dexie) ca sa poata fi
 * folosit atat din hashCompare.worker.ts (grupare la import) cat si din
 * state/store.ts (selectBestPhotoInGroup, apelabil din UI) fara import-uri
 * circulare sau a trage tot bundle-ul aplicatiei intr-un worker.
 */

export interface GroupCandidate {
  id: string;
  sharpness: number;              // 0..100
  exposure: number;                // 0..100
  compositionScore?: number;       // 0..1, absent = neutru
  faceCount: number;
  bestSmile: number;               // 0..1
  groupSmileRatio?: number;        // 0..1, doar la faceCount > 1
  allEyesOpen: boolean;
  groupEyesOpenRatio?: number;     // 0..1, doar la faceCount > 1
  avgEyeContact?: number;          // 0..1
  /** Scorul dat de motorul invatat (0..100). Absent = se foloseste doar ierarhia fixa de mai jos. */
  aiScore?: number;
}

/**
 * Scor compozit 0..1 pentru un candidat — nu doar un tiebreak lexicografic
 * (ar ignora complet criteriile secundare la orice diferenta, oricat de mica,
 * pe primul), ci o medie ponderata dupa importanta fotografica: claritatea
 * conteaza cel mai mult (o poza neclara nu se salveaza prin nimic altceva),
 * urmata de expunere, compozitie, apoi calitatea expresiilor/contactul vizual.
 */
function fixedScore(c: GroupCandidate): number {
  const exposureBalance = 1 - Math.abs(c.exposure - 50) / 50;
  const faceQuality = c.faceCount > 0
    ? 0.5 * (c.faceCount > 1 ? c.groupSmileRatio ?? c.bestSmile : c.bestSmile)
      + 0.5 * (c.faceCount > 1 ? c.groupEyesOpenRatio ?? (c.allEyesOpen ? 1 : 0) : (c.allEyesOpen ? 1 : 0))
    : 0.5;
  const eyeContact = c.avgEyeContact ?? 0.5;
  return (
    0.35 * (c.sharpness / 100) +
    0.2 * exposureBalance +
    0.2 * (c.compositionScore ?? 0.5) +
    0.15 * faceQuality +
    0.1 * eyeContact
  );
}

/**
 * Scorul final al unui candidat: ierarhia fixa de mai sus, amestecata cu ce a
 * invatat motorul din deciziile TALE.
 *
 * De ce amestec si nu una sau alta: ierarhia fixa e robusta cand motorul nu
 * stie inca nimic (cadre aproape identice primesc scoruri AI aproape egale, si
 * alegerea ar fi la noroc) — de asta a fost scrisa. Dar dupa zeci de corectii,
 * a IGNORA complet ce a invatat inseamna ca, exact la decizia cu cel mai mare
 * impact din culling (ce cadru supravietuieste dintr-o rafala), preferintele
 * tale n-au niciun cuvant de spus. `learnedWeight` creste de la 0 la 1 pe
 * masura ce motorul chiar are ce spune — vezi ContextEngine.learnedWeight().
 */
function groupScore(c: GroupCandidate, learnedWeight: number): number {
  const fixed = fixedScore(c);
  if (c.aiScore === undefined || learnedWeight <= 0) return fixed;
  const w = Math.max(0, Math.min(1, learnedWeight));
  return (1 - w) * fixed + w * (Math.max(0, Math.min(100, c.aiScore)) / 100);
}

/** Returneaza id-ul celui mai bun candidat dintr-un grup (dupa groupScore). Arunca daca grupul e gol. */
export function pickBestInGroup(candidates: GroupCandidate[], learnedWeight = 0): string {
  if (!candidates.length) throw new Error('pickBestInGroup: grup gol');
  let best = candidates[0];
  let bestScore = groupScore(best, learnedWeight);
  for (let i = 1; i < candidates.length; i++) {
    const score = groupScore(candidates[i], learnedWeight);
    if (score > bestScore) { bestScore = score; best = candidates[i]; }
  }
  return best.id;
}
