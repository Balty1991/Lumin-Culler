import type { PhotoView } from '../state/store';
import { decidePhotoStatus } from './importPipeline';
import { applyStrictness, type Thresholds, type CullingStrictness } from './scoreThresholds';
import { isUserDecided } from '../state/batchOps';

/**
 * core/strictnessPreview.ts
 * Cate poze ar pastra si cate ar respinge fiecare treapta de severitate — CALCULAT,
 * nu estimat.
 *
 * De ce exista: severitatea, asa cum am facut-o intai, era un buton care spunea
 * "sunt sever" si te lasa sa afli dupa ce apesi. Toata concurenta se poarta la
 * fel (la Aftershoot alegi nivelul si astepti sa ruleze din nou culling-ul), si e
 * exact locul unde un utilizator devine neincrezator: ii ceri sa aleaga fara
 * sa-i spui ce alege.
 *
 * Aici raspunsul e stiut dinainte, fiindca nu depinde de nimic nou: scorul
 * fiecarei poze e deja calculat si nu se schimba cu severitatea — se muta doar
 * pragurile. Deci se poate rula ACELASI `decidePhotoStatus` pe care il va rula
 * si aplicatia, pe datele deja din memorie, si arata rezultatul inainte de
 * apasare.
 *
 * Ruleaza sincron, la fiecare randare a barii: e o trecere peste `photos` x 3
 * trepte, fara acces la baza de date (de-aia PhotoView poarta si
 * highlightClipping/shadowClipping — vezi comentariul de acolo). La 5000 de
 * poze inseamna 15000 de apeluri de functie pura, sub o milisecunda; apelantul
 * il memoizeaza oricum pe `photos`.
 *
 * CE NUMARA, exact: doar teancul "de verificat" (status `review`/`pending`).
 *
 * Nu e o simplificare, e singurul raspuns onest. In modelul de date al
 * aplicatiei, statusul `selected`/`rejected` nu spune DACA a ajuns acolo prin
 * decizia ta sau prin propunerea motorului — nu exista un asemenea camp, iar
 * `isUserDecided` trateaza ambele la fel, ca peste tot in cod. Consecinta e ca
 * severitatea nu poate scoate o poza din teancul deja etichetat fara sa riste
 * sa calce peste o decizie a ta, deci nici nu incearca (vezi
 * store.setCullingStrictness). Previzualizarea trebuie sa numere EXACT ce va
 * face actiunea — altfel promite o cifra si livreaza alta, iar un numar in care
 * nu poti avea incredere e mai rau decat niciun numar.
 *
 * De-aia cifra pe care o scoate in fata interfata nu e "cate pastrezi", ci
 * `review`: cate ti-ar RAMANE de trecut prin mana. Aia e si munca pe care o
 * simti, si singura pe care severitatea chiar o schimba.
 */
export interface StrictnessOutcome {
  strictness: CullingStrictness;
  /** Cate poze din teancul de verificat ar fi propuse spre pastrare. */
  kept: number;
  /** Cate ar fi propuse spre respingere. */
  rejected: number;
  /** Cate ti-ar RAMANE de trecut prin mana — cifra principala a interfetei. */
  review: number;
  /** Cate si-ar SCHIMBA eticheta fata de acum — cifra care spune daca merita apasat. */
  changed: number;
}

export const STRICTNESS_LEVELS: readonly CullingStrictness[] = ['lax', 'balanced', 'strict'];

/** Rezultatul unei singure trepte. `base` sunt pragurile bibliotecii, INAINTE de severitate. */
export function previewStrictness(
  photos: PhotoView[],
  base: Thresholds,
  strictness: CullingStrictness
): StrictnessOutcome {
  const thresholds = applyStrictness(base, strictness);
  let kept = 0, rejected = 0, review = 0, changed = 0;

  for (const p of photos) {
    if (isUserDecided(p.status)) continue;
    const next = decidePhotoStatus(p.aiScore, p, thresholds);
    if (next === 'selected') kept++;
    else if (next === 'rejected') rejected++;
    else review++;
    if (next !== p.status) changed++;
  }

  return { strictness, kept, rejected, review, changed };
}

/** Toate cele trei trepte deodata, in ordinea in care se afiseaza. */
export function previewAllStrictness(photos: PhotoView[], base: Thresholds): StrictnessOutcome[] {
  return STRICTNESS_LEVELS.map(level => previewStrictness(photos, base, level));
}
