/**
 * core/metricSummary.ts
 * Un rand pentru fiecare grupa de metrici: ce ai afla daca te-ai uita la toate
 * dalele din ea, ca sa nu mai fii nevoit s-o faci.
 *
 * De ce exista: rubrica Metrici arata zece-cincisprezece numere deodata. Se
 * puteau CITI, dar nu raspundeau la intrebarea pe care si-o pune de fapt
 * cineva care se uita acolo — "e ceva in neregula, si de ce fel?". Rezumatul
 * spune raspunsul, iar dalele raman pentru cine vrea sa vada de unde vine.
 *
 * Regula peste tot mai jos: se raporteaza CEL MAI RAU lucru din grupa, nu o
 * medie. O poza cu expunere perfecta si complet miscata nu e "pe la mijloc",
 * e miscata.
 *
 * Intoarce CHEI de traducere, nu text: traducerea traieste in i18n.
 */

/** Aceleasi praguri ca aiExplanationGenerator si hasNamedDefect — un singur adevar. */
const SHARP_LOW = 45;
const SHARP_HIGH = 70;
const EXPOSURE_OFF = 15;
const CLIPPING = 0.06;
const EYES_OPEN_OK = 0.999;
const FRAMING_LOW = 0.35;
const FRAMING_GOOD = 0.6;

export interface MetricSummary {
  key: string;
  tone: 'ok' | 'warn';
}

export interface TechnicalSignals {
  faceCount: number;
  sharpness: number;
  exposure: number;
  highlightClipping?: number;
  shadowClipping?: number;
}

export interface SubjectSignals {
  faceCount: number;
  allEyesOpen: boolean;
  groupEyesOpenRatio?: number;
  bestSmile: number;
  groupSmileRatio?: number;
}

export interface FramingSignals {
  faceCount: number;
  ruleOfThirds?: number;
  headroom?: number;
  symmetryDetected?: boolean;
  leadingLinesDetected?: boolean;
  negativeSpaceScore?: number;
}

/**
 * @param effectiveSharpness claritatea deja judecata dupa tipul de poza (portret
 *   vs peisaj) — injectata, nu recalculata aici, ca sa nu existe doua definitii
 *   ale aceluiasi lucru in aplicatie.
 */
export function technicalSummary(a: TechnicalSignals, effectiveSharpness: number): MetricSummary {
  if (effectiveSharpness < SHARP_LOW) return { key: 'metrics.summary.technical.soft', tone: 'warn' };
  const off = a.exposure - 50;
  if (off < -EXPOSURE_OFF) return { key: 'metrics.summary.technical.under', tone: 'warn' };
  if (off > EXPOSURE_OFF) return { key: 'metrics.summary.technical.over', tone: 'warn' };
  if ((a.highlightClipping ?? 0) > CLIPPING) return { key: 'metrics.summary.technical.highlights', tone: 'warn' };
  if ((a.shadowClipping ?? 0) > CLIPPING) return { key: 'metrics.summary.technical.shadows', tone: 'warn' };
  if (effectiveSharpness >= SHARP_HIGH) return { key: 'metrics.summary.technical.clean', tone: 'ok' };
  return { key: 'metrics.summary.technical.fine', tone: 'ok' };
}

export function subjectSummary(a: SubjectSignals): MetricSummary {
  const eyes = a.groupEyesOpenRatio ?? (a.allEyesOpen ? 1 : 0);
  // Ochii inchisi primii: e singurul lucru din grupa care nu se repara nicicum.
  if (eyes < EYES_OPEN_OK) {
    return {
      key: a.faceCount > 1 ? 'metrics.summary.subject.someBlink' : 'metrics.summary.subject.blink',
      tone: 'warn'
    };
  }
  const smile = a.faceCount > 1 ? (a.groupSmileRatio ?? a.bestSmile) : a.bestSmile;
  if (smile >= 0.6) return { key: 'metrics.summary.subject.smiling', tone: 'ok' };
  return { key: 'metrics.summary.subject.eyesOpen', tone: 'ok' };
}

export function framingSummary(a: FramingSignals): MetricSummary {
  if (a.faceCount > 0) {
    const thirds = a.ruleOfThirds ?? 0.5;
    const headroom = a.headroom ?? 0.5;
    if (headroom < FRAMING_LOW) return { key: 'metrics.summary.framing.headroom', tone: 'warn' };
    if (thirds < FRAMING_LOW) return { key: 'metrics.summary.framing.centered', tone: 'warn' };
    if (thirds >= FRAMING_GOOD && headroom >= FRAMING_GOOD) return { key: 'metrics.summary.framing.strong', tone: 'ok' };
    return { key: 'metrics.summary.framing.fine', tone: 'ok' };
  }
  // Fara oameni in cadru, incadrarea se judeca altfel: nu exista "headroom".
  if (a.symmetryDetected || a.leadingLinesDetected) return { key: 'metrics.summary.framing.structure', tone: 'ok' };
  if ((a.negativeSpaceScore ?? 0.5) < FRAMING_LOW) return { key: 'metrics.summary.framing.crowded', tone: 'warn' };
  return { key: 'metrics.summary.framing.fine', tone: 'ok' };
}
