/**
 * core/bestShot.ts
 * Cadrul păstrat dintr-o rafală sau dintr-un grup de duplicate.
 *
 * Trei semnale, în ordinea în care se văd pe un telefon: ochii (un cadru clar
 * cu ochii închiși tot e de aruncat), expunerea (un 50 e la mijloc, nu ars și
 * nu îngropat), claritatea. Mărimea și data doar departajează. Semnalul care
 * lipsește nu pedepsește: o scanare de galerie nu vede ochii, iar atunci
 * rămân claritatea și expunerea.
 */

export type BestReason = 'eyes' | 'exposure' | 'sharpness' | 'newest';

export interface ShotSignals {
  id: string;
  /** 0–100. null = nu s-a măsurat. */
  sharpness: number | null;
  /** null = nu e un portret, sau nu s-au citit ochii. */
  eyesOpen: boolean | null;
  /** 0–100, 50 e mijlocul. null = nu s-a măsurat. */
  exposure: number | null;
  bytes: number;
  taken: number;
}

function eyesPoints(open: boolean | null): number {
  if (open === true) return 35;
  if (open === false) return -40;
  return 0;
}

function sharpPoints(shot: ShotSignals): number {
  if (shot.sharpness === null || !Number.isFinite(shot.sharpness)) return 0;
  return Math.max(0, Math.min(100, shot.sharpness));
}

function exposurePoints(exposure: number | null): number {
  if (exposure === null || !Number.isFinite(exposure)) return 0;
  return Math.max(0, 25 - Math.abs(exposure - 50) * 0.5);
}

export function bestShotScore(shot: ShotSignals): number {
  const size = Math.min(8, Math.max(0, shot.bytes) / 5_000_000);
  return sharpPoints(shot) + eyesPoints(shot.eyesOpen) + exposurePoints(shot.exposure) + size;
}

/** Cel mai bun primul. La egalitate, copia mai nouă, apoi id-ul, ca ordinea să nu sară între rulări. */
export function rankShots<T>(items: readonly T[], signals: (item: T) => ShotSignals): T[] {
  return [...items].sort((a, b) => {
    const left = signals(a);
    const right = signals(b);
    const score = bestShotScore(right) - bestShotScore(left);
    if (score !== 0) return score;
    if (right.taken !== left.taken) return right.taken - left.taken;
    return left.id.localeCompare(right.id);
  });
}

/** De ce a câștigat cadrul păstrat față de următorul, ca ecranul să poată spune ceva adevărat. */
export function bestShotReason(keeper: ShotSignals, other: ShotSignals | undefined): BestReason {
  if (!other) return keeper.sharpness !== null ? 'sharpness' : 'newest';
  const eyes = eyesPoints(keeper.eyesOpen) - eyesPoints(other.eyesOpen);
  const sharp = sharpPoints(keeper) - sharpPoints(other);
  const exposure = exposurePoints(keeper.exposure) - exposurePoints(other.exposure);
  const best = Math.max(eyes, sharp, exposure);
  if (best <= 0) return keeper.taken >= other.taken ? 'newest' : 'sharpness';
  if (eyes === best && eyes > 0) return 'eyes';
  if (exposure >= sharp && exposure > 0) return 'exposure';
  if (sharp > 0) return 'sharpness';
  if (exposure > 0) return 'exposure';
  return 'newest';
}
