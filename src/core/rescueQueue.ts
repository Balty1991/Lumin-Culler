/**
 * core/rescueQueue.ts
 *
 * Cadrele care se pot SALVA, nu doar sterge.
 *
 * O aplicatie de triaj care spune doar "asta nu e buna" isi face jumatate din
 * treaba. O parte din cadrele respinse nu sunt ratate, ci nereglate: cerul ars,
 * umbrele infundate, orizontul strambat cu doua grade, subiectul prea in
 * centru. Toate patru se repara din editorul care exista deja, in cateva
 * secunde, fara niciun model nou.
 *
 * DISCIPLINA modulului, si motivul pentru care se poate avea incredere in el:
 * in coada intra NUMAI defecte care chiar se pot repara. Neclaritatea si ochii
 * inchisi nu intra niciodata — nu exista buton care sa le rezolve, iar o coada
 * care promite "se poate salva" si contine cadre miscate ar fi o minciuna care
 * se descopera la prima incercare. Ele raman ce sunt: observatii pentru data
 * viitoare.
 *
 * Un cadru prea neclar nu intra in coada nici daca are highlights arse: nu are
 * rost sa recuperezi cerul dintr-o poza miscata. De aceea exista `MIN_BASE_SHARPNESS`.
 *
 * Fara DOM, fara store, fara i18n: intoarce chei si numere.
 */

/** Ce se poate repara automat, cu uneltele care exista deja in editor. */
export type RescueFix = 'highlights' | 'shadows' | 'straighten' | 'exposure' | 'crop';

export interface RescueCandidate {
  id: string;
  status: 'selected' | 'review' | 'rejected' | 'pending';
  aiScore: number;
  sharpness: number;
  exposure: number;
  faceCount: number;
  highlightClipping?: number;
  shadowClipping?: number;
  horizonTiltDeg?: number;
  ruleOfThirds?: number;
}

export interface RescueItem {
  id: string;
  fixes: RescueFix[];
  /** Cat de mult ar avea de castigat cadrul, 0..100 — ordoneaza coada. */
  gain: number;
}

/** Sub atat, cadrul e prea neclar ca sa merite reparat: nu recuperezi cerul dintr-o poza miscata. */
export const MIN_BASE_SHARPNESS = 45;
/** Fractia de pixeli arsi/infundati de la care merita atins. */
export const CLIPPING_THRESHOLD = 0.06;
/** Grade de inclinare de la care orizontul se vede strambat. */
export const TILT_THRESHOLD = 2;
/** Cat de departe de mijloc trebuie sa fie expunerea ca sa fie o problema, nu o alegere. */
export const EXPOSURE_DEVIATION = 18;
/** Sub atat, subiectul e prea in centru fata de regula treimilor. */
export const THIRDS_THRESHOLD = 0.4;

/** Cate puncte de scor estimam ca recupereaza fiecare corectie. Doar pentru ordonare, nu se promite nimanui. */
const GAIN: Record<RescueFix, number> = {
  exposure: 12,
  highlights: 9,
  shadows: 9,
  straighten: 6,
  crop: 5
};

/** Ce se poate repara la acest cadru. Lista goala = nimic de facut aici. */
export function fixesFor(p: RescueCandidate): RescueFix[] {
  const fixes: RescueFix[] = [];
  if (p.sharpness < MIN_BASE_SHARPNESS) return fixes;

  const exposureError = Math.abs(p.exposure - 50);
  if (exposureError >= EXPOSURE_DEVIATION) fixes.push('exposure');
  if ((p.highlightClipping ?? 0) > CLIPPING_THRESHOLD) fixes.push('highlights');
  if ((p.shadowClipping ?? 0) > CLIPPING_THRESHOLD) fixes.push('shadows');
  if (p.horizonTiltDeg !== undefined && Math.abs(p.horizonTiltDeg) > TILT_THRESHOLD) fixes.push('straighten');
  // Recadrarea are sens doar cand exista un subiect uman fata de care sa
  // incadrezi; pe un peisaj, "prea in centru" e adesea chiar intentia.
  if (p.faceCount > 0 && (p.ruleOfThirds ?? 0.5) < THIRDS_THRESHOLD) fixes.push('crop');
  return fixes;
}

/**
 * Coada de salvare: cadrele respinse sau nedecise care au cel putin o corectie
 * disponibila, cele mai recuperabile primele.
 *
 * Pozele deja SELECTATE nu intra: utilizatorul le-a pastrat, deci nu are nevoie
 * sa fie convins sa le salveze. Le poate edita oricand direct.
 */
export function buildRescueQueue(photos: RescueCandidate[], limit = 50): RescueItem[] {
  const out: RescueItem[] = [];
  for (const p of photos) {
    if (p.status === 'selected') continue;
    const fixes = fixesFor(p);
    if (!fixes.length) continue;
    // Castigul estimat, plafonat: doua corectii nu dubleaza valoarea unui cadru,
    // iar un scor nu poate trece de 100.
    const raw = fixes.reduce((sum, f) => sum + GAIN[f], 0);
    const gain = Math.min(raw, 100 - p.aiScore);
    if (gain <= 0) continue;
    out.push({ id: p.id, fixes, gain });
  }
  return out
    .sort((a, b) => b.gain - a.gain || b.fixes.length - a.fixes.length || a.id.localeCompare(b.id))
    .slice(0, limit);
}

/** Cate cadre s-ar putea salva, fara sa construim toata coada. Pentru insigne si contoare. */
export function countRescuable(photos: RescueCandidate[]): number {
  let n = 0;
  for (const p of photos) {
    if (p.status === 'selected') continue;
    if (!fixesFor(p).length) continue;
    if (p.aiScore >= 100) continue;
    n++;
  }
  return n;
}
