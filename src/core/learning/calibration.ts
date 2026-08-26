/**
 * core/learning/calibration.ts
 * "Cand spun 70, chiar inseamna 70?"
 *
 * Diferenta fata de accuracy.ts, si de ce merita amandoua:
 *
 *  - ACORDUL (accuracy.ts) spune cat de des a nimerit motorul. E cifra pe care
 *    o intelege oricine, si e cea corecta de aratat.
 *  - CALIBRAREA, aici, spune daca INCREDEREA lui inseamna ceva. Un motor poate
 *    avea acord bun si sa fie complet decalibrat: daca tot ce scoreaza 65
 *    ajunge pastrat in 9 cazuri din 10, atunci 65 nu inseamna 65, inseamna 90.
 *
 * De ce conteaza asta mai mult decat pare: pragurile care hotarasc ce se decide
 * singur si ce ajunge in coada de verificat sunt exprimate in scor (65 / 35,
 * vezi scoreThresholds.ts). Daca scorul e decalibrat, pragurile taie in locul
 * gresit — omul verifica manual poze care nu aveau nevoie, sau primeste decizii
 * automate pe poze la limita. Adaptarea de praguri existenta corecteaza
 * DISTRIBUTIA (cate poze cad de fiecare parte), nu calibrarea (ce inseamna
 * cifra). Sunt lucruri diferite si niciunul nu-l inlocuieste pe celalalt.
 *
 * Ce NU face modulul asta: nu schimba niciun scor si nicio decizie. Doar
 * masoara si spune. Corectarea scorului pe baza acestei curbe e pasul urmator
 * si e o decizie separata — muta verdictele pe toata biblioteca, inclusiv pe
 * poze deja decise.
 */

/** O corectie, redusa la ce trebuie pentru calibrare. */
export interface CalibrationInput {
  aiScore?: number;
  userDecision: boolean;
}

export interface CalibrationBin {
  /** Marginile benzii de scor, 0..100. */
  from: number;
  to: number;
  count: number;
  /** Media scorurilor din banda, ca probabilitate 0..1. */
  predicted: number;
  /** Fractiunea chiar pastrata de om, 0..1. */
  observed: number;
}

export type CalibrationVerdict = 'bun' | 'preaPrudent' | 'preaIncrezator' | 'imprastiat';

export interface CalibrationSummary {
  /** Cate decizii cu scor au intrat in calcul. */
  total: number;
  bins: CalibrationBin[];
  /**
   * Eroarea de calibrare: media |prezis - observat|, ponderata cu cate decizii
   * are fiecare banda. 0 = perfect, 0.5 = maximum practic.
   */
  error: number;
  /**
   * Aceeasi diferenta, dar CU SEMN. Pozitiv = pastrezi mai mult decat prezice
   * motorul (e prea prudent). Negativ = pastrezi mai putin (e prea increzator).
   */
  bias: number;
  verdict: CalibrationVerdict;
}

/** Latimea unei benzi de scor. Zece benzi acopera 0..100. */
export const BIN_WIDTH = 10;
/** Sub atatea decizii intr-o banda, procentul ei e zgomot si banda nu se ia in seama. */
export const MIN_PER_BIN = 5;
/** Sub atatea decizii cu scor in total, nu se spune nimic. */
export const MIN_TOTAL = 40;
/** Sub atatea benzi utilizabile, curba nu descrie nimic — scorurile stau toate gramada. */
export const MIN_BINS = 3;

/** Peste atata eroare, cifra chiar nu mai inseamna ce spune. */
export const ERROR_GOOD = 0.08;
/** Cat de mare trebuie sa fie decalajul cu semn ca sa aiba o directie, nu doar imprastiere. */
export const BIAS_DIRECTIONAL = 0.05;

/**
 * Curba de fiabilitate: pentru fiecare banda de scor, cat prezice motorul si
 * cat s-a intamplat de fapt.
 *
 * Se ignora corectiile fara scor (scrise inainte ca acesta sa fie retinut) si
 * benzile prea sarace — o banda cu doua decizii poate arata 0% sau 100% din
 * pura intamplare, si ar strica media.
 */
export function computeCalibration(inputs: readonly CalibrationInput[]): CalibrationSummary | null {
  const cuScor = inputs.filter(i => typeof i.aiScore === 'number' && Number.isFinite(i.aiScore));
  if (cuScor.length < MIN_TOTAL) return null;

  const galeti = new Map<number, { sumaScor: number; pastrate: number; count: number }>();
  for (const i of cuScor) {
    const scor = Math.max(0, Math.min(100, i.aiScore as number));
    // 100 intra in ultima banda, nu intr-a unsprezecea.
    const idx = Math.min(Math.floor(scor / BIN_WIDTH), 100 / BIN_WIDTH - 1);
    const g = galeti.get(idx) ?? { sumaScor: 0, pastrate: 0, count: 0 };
    g.sumaScor += scor;
    if (i.userDecision) g.pastrate++;
    g.count++;
    galeti.set(idx, g);
  }

  const bins: CalibrationBin[] = [...galeti.entries()]
    .filter(([, g]) => g.count >= MIN_PER_BIN)
    .sort((a, b) => a[0] - b[0])
    .map(([idx, g]) => ({
      from: idx * BIN_WIDTH,
      to: (idx + 1) * BIN_WIDTH,
      count: g.count,
      predicted: g.sumaScor / g.count / 100,
      observed: g.pastrate / g.count
    }));

  if (bins.length < MIN_BINS) return null;

  const total = bins.reduce((s, b) => s + b.count, 0);
  const error = bins.reduce((s, b) => s + b.count * Math.abs(b.predicted - b.observed), 0) / total;
  const bias = bins.reduce((s, b) => s + b.count * (b.observed - b.predicted), 0) / total;

  return { total, bins, error, bias, verdict: judeca(error, bias) };
}

/**
 * Traducerea a doua numere intr-un cuvant.
 *
 * Ordinea conteaza: intai "e bun", ca sa nu cautam o directie intr-o eroare
 * neglijabila. Apoi directia, care e actionabila. "Imprastiat" ramane pentru
 * cazul in care motorul greseste mult, dar in ambele sensuri — acolo nu exista
 * o corectie simpla de aplicat, si e cinstit sa se spuna asta.
 */
function judeca(error: number, bias: number): CalibrationVerdict {
  if (error <= ERROR_GOOD) return 'bun';
  if (bias >= BIAS_DIRECTIONAL) return 'preaPrudent';
  if (bias <= -BIAS_DIRECTIONAL) return 'preaIncrezator';
  return 'imprastiat';
}

/**
 * Banda in care motorul se inseala cel mai tare, ca sa se poata spune concret
 * "in jurul lui 60 esti prea prudent" in loc de o medie abstracta.
 * Se cere o abatere care chiar merita numita.
 */
export function worstBin(summary: CalibrationSummary): CalibrationBin | null {
  let cea: CalibrationBin | null = null;
  for (const b of summary.bins) {
    const abatere = Math.abs(b.predicted - b.observed);
    if (abatere <= ERROR_GOOD) continue;
    if (!cea || abatere > Math.abs(cea.predicted - cea.observed)) cea = b;
  }
  return cea;
}
