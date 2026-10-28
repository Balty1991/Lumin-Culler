/**
 * core/moments.ts
 * „Momente”: pozele făcute la câteva minute una de alta. Raportat: din 9 poze
 * cu fetița pe trotinetă, AI-ul a păstrat 8 — fiecare era clară, deci fiecare
 * trecea pragul, iar seriile prind doar cadre aproape identice (aici fetița se
 * apropia, deci cadrele difereau destul cât să nu fie „serie”).
 *
 * Omul vrea 3–5 poze dintr-o zi, nu 8 aproape la fel. Deci: din fiecare
 * moment rămân cele mai bune 1–3 (după strictețe); restul pozelor pe care le
 * ținuse AI-ul devin „nu azi”, iar cele la care nu era sigur nu mai cer o
 * decizie. Ce a decis omul nu se atinge niciodată.
 *
 * Fără DB și fără React: primește pozele, întoarce schimbările.
 */
import type { CullingStrictness } from './scoreThresholds';

export interface MomentPhoto {
  id: string;
  capturedAt?: number;
  status: string;
  aiScore: number;
  aside?: string;
  /** true = decizia e a omului (vezi core/aiDecision.ts:lockedFromAutoDecision). */
  locked: boolean;
}

/** Două poze la mai puțin de atât una de alta sunt același moment. */
export const MOMENT_GAP_MS = 3 * 60_000;
/** Un moment de 1–2 poze nu e plafonat: pot fi două lucruri diferite. */
const MIN_MOMENT = 3;

export function keepPerMoment(size: number, strictness: CullingStrictness): number {
  if (strictness === 'strict') return 1;
  if (strictness === 'lax') return Math.min(3, Math.max(1, Math.ceil(size / 3)));
  return Math.min(2, Math.max(1, Math.ceil(size / 4)));
}

export function splitMoments<P extends MomentPhoto>(photos: readonly P[]): P[][] {
  const timed = photos.filter(p => p.capturedAt !== undefined && !p.aside).sort((a, b) => a.capturedAt! - b.capturedAt!);
  const moments: P[][] = [];
  for (const p of timed) {
    const current = moments[moments.length - 1];
    if (current && p.capturedAt! - current[current.length - 1].capturedAt! <= MOMENT_GAP_MS) current.push(p);
    else moments.push([p]);
  }
  return moments;
}

/** Pozele cărora trebuie să li se schimbe statusul (doar decizii ale AI-ului). */
export function momentChanges(photos: readonly MomentPhoto[], strictness: CullingStrictness): Map<string, 'rejected'> {
  const out = new Map<string, 'rejected'>();
  for (const moment of splitMoments(photos)) {
    if (moment.length < MIN_MOMENT) continue;
    const quota = keepPerMoment(moment.length, strictness);
    // Ce a păstrat omul cu mâna lui ocupă din locuri primele.
    const userKept = moment.filter(p => p.locked && p.status === 'selected').length;
    let free = Math.max(0, quota - userKept);
    const ranked = moment.filter(p => !p.locked && (p.status === 'selected' || p.status === 'review' || p.status === 'pending'))
      .sort((a, b) => b.aiScore - a.aiScore);
    for (const p of ranked) {
      if (p.status === 'selected' && free > 0) { free--; continue; }
      // Locurile momentului sunt ocupate: restul nu mai merită păstrat sau întrebat.
      if (free === 0) out.set(p.id, 'rejected');
    }
  }
  return out;
}
