/**
 * core/learning/reasons.ts
 * „Corectură cu motiv”: când omul nu e de acord cu o decizie fermă a AI-ului,
 * poate spune dintr-o atingere DE CE (e cu cineva drag, poza e mișcată...).
 * Păstrăm motivul lângă id-ul pozei și ce vedea AI-ul atunci (trăsăturile),
 * într-un jurnal mic, local, plafonat — ca perechile din pairs.ts.
 * Deocamdată doar numărăm motivele: explicațiile și gustul le pot folosi mai târziu.
 */

/** Omul a păstrat ce AI-ul ar fi aruncat. */
export const KEEP_REASONS = ['person', 'moment', 'memory'] as const;
/** Omul a aruncat ce AI-ul ar fi păstrat. */
export const DROP_REASONS = ['blurry', 'looks', 'better'] as const;
export type KeepReason = (typeof KEEP_REASONS)[number];
export type DropReason = (typeof DROP_REASONS)[number];
export type CorrectionReason = KeepReason | DropReason;
const ALL: readonly string[] = [...KEEP_REASONS, ...DROP_REASONS];

/** Ce vedea AI-ul la poză în clipa corecturii (fără nume de persoane: doar câte sunt). */
export interface ReasonFeatures {
  aiScore: number;
  faceCount: number;
  sharpness: number;
  bestSmile: number;
  people: number;
  /** Primele trăsături care au contat în scorul AI-ului. */
  factors: string[];
}
export interface ReasonEntry { id: string; r: CorrectionReason; kept: boolean; f: ReasonFeatures; t: number }

const KEY = 'cp.reasons.v1';
export const MAX_REASONS = 500;

export function isReason(x: unknown): x is CorrectionReason {
  return typeof x === 'string' && ALL.includes(x);
}
/** Motivele potrivite direcției: „de ce ai păstrat-o?” sau „de ce n-ai vrut-o?”. */
export function reasonsFor(kept: boolean): readonly CorrectionReason[] {
  return kept ? KEEP_REASONS : DROP_REASONS;
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/** Instantaneul trăsăturilor, dintr-o poză (funcție pură, fără stocare). */
export function featuresOf(p: {
  aiScore?: number; faceCount?: number; sharpness?: number; bestSmile?: number;
  personNames?: readonly string[]; aiFactors?: readonly { feature: string }[];
}): ReasonFeatures {
  return {
    aiScore: num(p.aiScore),
    faceCount: num(p.faceCount),
    sharpness: num(p.sharpness),
    bestSmile: num(p.bestSmile),
    people: p.personNames?.length ?? 0,
    factors: (p.aiFactors ?? []).slice(0, 3).map(x => x.feature).filter(x => typeof x === 'string'),
  };
}

export function readReasons(): ReasonEntry[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(raw)
      ? raw.filter(e => e && typeof e.id === 'string' && isReason(e.r) && typeof e.kept === 'boolean' && e.f && typeof e.f === 'object')
      : [];
  } catch { return []; }
}

/** Notează motivul. Un motiv nou pe aceeași poză îl înlocuiește pe cel vechi. */
export function recordReason(id: string, reason: CorrectionReason, features: ReasonFeatures, now = Date.now()): void {
  if (!id || !isReason(reason)) return;
  const kept = (KEEP_REASONS as readonly string[]).includes(reason);
  const list = readReasons().filter(e => e.id !== id);
  list.push({ id, r: reason, kept, f: features, t: now });
  try { localStorage.setItem(KEY, JSON.stringify(list.slice(-MAX_REASONS))); } catch { /* fără stocare */ }
}

/** Câte corecturi are fiecare motiv (toate motivele apar, cu 0 dacă lipsesc). */
export function reasonCounts(list: readonly ReasonEntry[] = readReasons()): Record<CorrectionReason, number> {
  const out = Object.fromEntries(ALL.map(r => [r, 0])) as Record<CorrectionReason, number>;
  for (const e of list) if (isReason(e.r)) out[e.r]++;
  return out;
}
