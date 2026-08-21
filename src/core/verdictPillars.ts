/**
 * core/verdictPillars.ts
 * Verdictul, desfacut in cele patru intrebari din care e facut de fapt.
 *
 * Un singur numar de la 0 la 100 nu se poate corecta. Cand cineva nu e de acord
 * cu el, nu are ce sa arate cu degetul: scorul amesteca "e clara?", "e cea mai
 * buna din rafala?", "imi place mie asa ceva?" si "se poate repara?" intr-o
 * singura cifra din care nu mai iese niciuna. Un om, in schimb, le tine minte
 * separat — si de asta poate spune "e cea mai buna dintre astea, desi nu e
 * grozava".
 *
 * Cei patru piloni au si o proprietate practica: se pot contrazice, si asta e
 * informatie, nu eroare. Un cadru cu TEHNIC mic si SERIE mare e cel mai bun
 * dintr-o rafala ratata — exact cazul in care omul vrea sa vada ambele cifre.
 *
 * Fara i18n, fara DB, fara React: numere in, numere out.
 */

/** Aceleasi praguri ca metricSummary si hasNamedDefect — un singur adevar. */
const EXPOSURE_TOLERANCE = 30;
const CLIPPING_FULL = 0.2;

export interface PillarSignals {
  faceCount: number;
  sharpness: number;
  exposure: number;
  highlightClipping?: number;
  shadowClipping?: number;
  allEyesOpen: boolean;
  groupEyesOpenRatio?: number;
  subjectInFocus?: boolean;
  ruleOfThirds?: number;
  headroom?: number;
  horizonTiltDeg?: number;
}

export interface VerdictPillars {
  /** "Este cadrul utilizabil?" 0..100, doar din semnale masurate — nicio pondere invatata. */
  technical: number;
  /** "Este cel mai bun din moment?" 0..100, sau null cand poza n-are serie. */
  series: number | null;
  /** "Se potriveste gustului meu?" -100..100, sau null cat timp motorul n-are o parere proprie. */
  personal: number | null;
  /** "Cat din ce e in neregula se poate repara?" 0..100. */
  delivery: number;
}

function clamp01(v: number): number {
  return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0;
}

function eyesOpenFraction(a: PillarSignals): number {
  return a.groupEyesOpenRatio ?? (a.allEyesOpen ? 1 : 0);
}

/**
 * Cat de utilizabil e cadrul, strict din ce s-a masurat.
 *
 * Nu intra nicio pondere invatata aici, si asta e chiar rostul pilonului: e
 * singura cifra care nu se schimba pe masura ce motorul iti invata gustul. Doi
 * fotografi cu preferinte opuse vad acelasi TEHNIC pe aceeasi poza.
 *
 * @param effectiveSharpness claritatea deja judecata dupa tipul de poza —
 *   injectata, ca sa nu existe doua definitii ale ei in aplicatie.
 */
export function technicalPillar(a: PillarSignals, effectiveSharpness: number): number {
  const clarity = clamp01(effectiveSharpness / 100);
  const exposure = 1 - clamp01(Math.abs(a.exposure - 50) / EXPOSURE_TOLERANCE);
  const clipping = 1 - clamp01(((a.highlightClipping ?? 0) + (a.shadowClipping ?? 0)) / CLIPPING_FULL);

  // Ochii conteaza doar cand exista o fata; pe un peisaj ponderea lor se
  // redistribuie la restul, nu se presupune "perfect".
  const parts: [number, number][] = [[clarity, 0.4], [exposure, 0.25], [clipping, 0.2]];
  if (a.faceCount > 0) parts.push([eyesOpenFraction(a), 0.15]);

  const totalWeight = parts.reduce((sum, [, w]) => sum + w, 0);
  const score = parts.reduce((sum, [v, w]) => sum + clamp01(v) * w, 0) / totalWeight;
  return Math.round(score * 100);
}

/**
 * Unde sta cadrul intre surorile lui, in procente.
 *
 * 100 = cel mai bun al momentului. Se calculeaza pe ranguri, nu pe diferenta de
 * scor: intre doua cadre aproape identice diferenta de scor e zgomot, dar
 * "primul din patru" ramane adevarat.
 *
 * @param siblingScores scorurile TUTUROR cadrelor seriei, inclusiv al pozei
 */
export function seriesPillar(ownScore: number, siblingScores: number[]): number | null {
  if (siblingScores.length < 2) return null;
  const worse = siblingScores.filter(s => s < ownScore).length;
  const equal = siblingScores.filter(s => s === ownScore).length;
  // Rangul mediu al egalilor: doua cadre identice primesc aceeasi cifra, si
  // niciunul nu ia 100 doar pentru ca a fost primul in lista.
  const rank = (worse + (equal - 1) / 2) / (siblingScores.length - 1);
  return Math.round(clamp01(rank) * 100);
}

/**
 * Cat din ce e in neregula se mai poate repara in editor.
 *
 * Impartirea nu e o parere: unele lucruri sunt pierdere de informatie, altele
 * sunt doar o setare gresita.
 *
 *  NU se repara — claritatea (nu exista detaliu de recuperat), subiectul
 *    neclar, ochii inchisi, si luminile ARSE (acolo pixelii chiar sunt albi,
 *    n-a mai ramas nimic sub ei);
 *  SE repara — expunerea in limite rezonabile, orizontul strambat, incadrarea
 *    (se decupeaza), si umbrele inecate, macar in parte: acolo informatia
 *    exista, doar e intunecata.
 *
 * Pilonul asta e singurul care poate fi MARE pe o poza slaba — si tocmai asta
 * il face util: "nu e grozava, dar se aduce repede acolo".
 */
export function deliveryPillar(a: PillarSignals, effectiveSharpness: number): number {
  let penalty = 0;
  penalty += (1 - clamp01(effectiveSharpness / 100)) * 45;
  if (a.subjectInFocus === false) penalty += 25;
  if (a.faceCount > 0) penalty += (1 - clamp01(eyesOpenFraction(a))) * 25;
  penalty += clamp01((a.highlightClipping ?? 0) / CLIPPING_FULL) * 20;
  // Umbrele si expunerea NU intra: sunt exact partea recuperabila.
  return Math.round(Math.max(0, 100 - penalty));
}

export function computePillars(
  a: PillarSignals,
  effectiveSharpness: number,
  ownScore: number,
  siblingScores: number[],
  personalDelta: number | undefined,
  /** Sub atata, diferenta fata de manual e zgomot, nu gust — vezi PERSONAL_MIN in UI. */
  personalMin = 3
): VerdictPillars {
  return {
    technical: technicalPillar(a, effectiveSharpness),
    series: seriesPillar(ownScore, siblingScores),
    personal: personalDelta === undefined || Math.abs(personalDelta) < personalMin ? null : personalDelta,
    delivery: deliveryPillar(a, effectiveSharpness)
  };
}
