import { describe, expect, it } from 'vitest';
import { correctedFileName, FREE_AUTO_CORRECT_PHOTOS, freeSample, planKeptCorrections, type CorrectablePhoto } from './autoCorrect';

function kept(overrides: Partial<CorrectablePhoto> = {}): CorrectablePhoto {
  return {
    id: 'p',
    status: 'selected',
    aiScore: 70,
    sharpness: 80,
    exposure: 50,
    faceCount: 0,
    ...overrides
  };
}

describe('planKeptCorrections', () => {
  it('nu atinge un cadru respins — ăla rămâne în coada de salvare', () => {
    expect(planKeptCorrections([kept({ status: 'rejected', exposure: 10 })])).toEqual([]);
  });

  it('propune expunerea și cerul ars pe cadrul păstrat', () => {
    const [plan] = planKeptCorrections([kept({ exposure: 20, highlightClipping: 0.2 })]);
    expect(plan.fixes).toEqual(expect.arrayContaining(['exposure', 'highlights']));
    expect(plan.adjustments.exposure).not.toBe(0);
    expect(plan.adjustments.highlights).toBeLessThan(0);
  });

  it('îndreaptă orizontul și nu inventează clipping', () => {
    const [plan] = planKeptCorrections([kept({ horizonTiltDeg: 3.2 })]);
    expect(plan.fixes).toEqual(['straighten']);
    expect(plan.adjustments.rotationDeg).toBe(-3);
    expect(plan.adjustments.highlights).toBe(0);
  });

  it('un cadru drept și echilibrat nu primește o copie degeaba', () => {
    expect(planKeptCorrections([kept()])).toEqual([]);
  });
});

describe('freeSample', () => {
  it('lasă gratuit doar mostra', () => {
    const items = [1, 2, 3, 4, 5];
    const split = freeSample(items, false);
    expect(split.allowed).toHaveLength(FREE_AUTO_CORRECT_PHOTOS);
    expect(split.locked).toEqual([4, 5]);
    expect(freeSample(items, true).locked).toEqual([]);
  });
});

describe('correctedFileName', () => {
  it('păstrează extensia pe copie', () => {
    expect(correctedFileName('ana.jpg')).toBe('ana-corectat.jpg');
  });
});
