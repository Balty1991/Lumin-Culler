import { describe, expect, it } from 'vitest';
import { bestShotReason, bestShotScore, rankShots, type ShotSignals } from './bestShot';

function shot(over: Partial<ShotSignals> & Pick<ShotSignals, 'id'>): ShotSignals {
  return {
    sharpness: 60,
    eyesOpen: null,
    exposure: null,
    bytes: 1000,
    taken: 1,
    ...over
  };
}

describe('bestShot', () => {
  it('pune ochii deschiși înaintea unui cadru mai clar, dar clipit', () => {
    const open = shot({ id: 'open', sharpness: 62, eyesOpen: true, exposure: 50 });
    const closed = shot({ id: 'closed', sharpness: 84, eyesOpen: false, exposure: 50 });
    expect(bestShotScore(open)).toBeGreaterThan(bestShotScore(closed));
    expect(rankShots([closed, open], item => item).map(item => item.id)).toEqual(['open', 'closed']);
    expect(bestShotReason(open, closed)).toBe('eyes');
  });

  it('la ochi egali, preferă expunerea de mijloc', () => {
    const balanced = shot({ id: 'mid', sharpness: 70, eyesOpen: true, exposure: 50, taken: 1 });
    const blown = shot({ id: 'hot', sharpness: 74, eyesOpen: true, exposure: 96, taken: 2 });
    expect(rankShots([blown, balanced], item => item)[0].id).toBe('mid');
    expect(bestShotReason(balanced, blown)).toBe('exposure');
  });

  it('fără ochi și fără expunere, rămâne la claritate, apoi la data mai nouă', () => {
    const soft = shot({ id: 'soft', sharpness: 20, taken: 50 });
    const crisp = shot({ id: 'crisp', sharpness: 80, taken: 10 });
    const twin = shot({ id: 'twin', sharpness: 80, taken: 40 });
    expect(rankShots([soft, crisp, twin], item => item).map(item => item.id)).toEqual(['twin', 'crisp', 'soft']);
    expect(bestShotReason(crisp, soft)).toBe('sharpness');
  });
});
