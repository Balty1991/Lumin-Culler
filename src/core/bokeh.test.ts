import { describe, it, expect } from 'vitest';
import { subjectFromFaces, NEUTRAL_ADJUSTMENTS, isNeutral } from './imageAdjust';

describe('subjectFromFaces', () => {
  it('extinde IN JOS cu inaltimea unei fete — umerii fac parte din subiect', () => {
    // Fara extindere, pieptul cadea in fundal si se estompa: cel mai vizibil
    // defect al unui bokeh fals.
    const s = subjectFromFaces([{ box: [100, 100, 200, 200] }], 1000, 1000)!;
    expect(s.y).toBeCloseTo(0.1, 5);
    expect(s.height).toBeCloseTo(0.4, 5); // 100 -> 300 (fata) + inca 200 (corpul)
  });

  it('reuneste mai multe fete intr-un singur subiect', () => {
    const s = subjectFromFaces([
      { box: [100, 100, 100, 100] },
      { box: [500, 120, 100, 100] }
    ], 1000, 1000)!;
    expect(s.x).toBeCloseTo(0.1, 5);
    expect(s.width).toBeCloseTo(0.5, 5); // 100 -> 600
  });

  it('nu iese din cadru cand fata e jos de tot', () => {
    const s = subjectFromFaces([{ box: [0, 800, 100, 150] }], 1000, 1000)!;
    expect(s.y + s.height).toBeLessThanOrEqual(1);
  });

  it('fara fete, null — nu ghicim unde e subiectul', () => {
    expect(subjectFromFaces([], 1000, 1000)).toBeNull();
    expect(subjectFromFaces(undefined, 1000, 1000)).toBeNull();
  });

  it('dimensiuni invalide nu produc valori absurde', () => {
    expect(subjectFromFaces([{ box: [0, 0, 10, 10] }], 0, 0)).toBeNull();
  });
});

describe('bokeh ca ajustare', () => {
  it('o poza cu bokeh conteaza ca editata', () => {
    // Altfel n-ar aparea insigna de "editat" si Reseteaza ar parea inactiv.
    expect(isNeutral({ ...NEUTRAL_ADJUSTMENTS })).toBe(true);
    expect(isNeutral({ ...NEUTRAL_ADJUSTMENTS, bokeh: 40 })).toBe(false);
  });
});
