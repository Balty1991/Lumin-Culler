import { describe, it, expect } from 'vitest';
import { subjectFromFaces, NEUTRAL_ADJUSTMENTS, isNeutral } from './imageAdjust';

/**
 * Casetele de fata sunt DEJA normalizate 0..1 — vezi faceAnalysis.worker.ts:1026
 * si nativeAnalysis.ts:190, amandoua scriu `x / imgW`. Prima versiune a
 * functiei mai impartea o data, deci subiectul iesea de cateva mii de ori mai
 * mic, masca nu mai stergea nimic si se estompa toata poza. Testele de aici
 * lucreaza in aceleasi unitati ca datele reale.
 */
describe('subjectFromFaces', () => {
  it('extinde IN JOS cu inaltimea unei fete — umerii fac parte din subiect', () => {
    // Fata ocupa 10%..30% pe verticala; subiectul trebuie sa ajunga la 50%.
    const s = subjectFromFaces([{ box: [0.1, 0.1, 0.2, 0.2] }])!;
    expect(s.y).toBeCloseTo(0.1, 5);
    expect(s.height).toBeCloseTo(0.4, 5);
  });

  it('pastreaza scara normalizata — nu mai imparte a doua oara', () => {
    // Bug-ul raportat: aici iesea 0.0002 in loc de 0.2.
    const s = subjectFromFaces([{ box: [0.4, 0.2, 0.2, 0.25] }])!;
    expect(s.x).toBeCloseTo(0.4, 5);
    expect(s.width).toBeCloseTo(0.2, 5);
  });

  it('reuneste mai multe fete intr-un singur subiect', () => {
    const s = subjectFromFaces([
      { box: [0.1, 0.1, 0.1, 0.1] },
      { box: [0.5, 0.12, 0.1, 0.1] }
    ])!;
    expect(s.x).toBeCloseTo(0.1, 5);
    expect(s.width).toBeCloseTo(0.5, 5);
  });

  it('nu iese din cadru cand fata e jos de tot', () => {
    const s = subjectFromFaces([{ box: [0, 0.8, 0.1, 0.15] }])!;
    expect(s.y + s.height).toBeLessThanOrEqual(1);
  });

  it('fara fete, null — nu ghicim unde e subiectul', () => {
    expect(subjectFromFaces([])).toBeNull();
    expect(subjectFromFaces(undefined)).toBeNull();
  });

  it('o caseta degenerata nu produce un subiect', () => {
    expect(subjectFromFaces([{ box: [0.5, 0.5, 0, 0] }])).toBeNull();
  });
});

describe('bokeh ca ajustare', () => {
  it('o poza cu bokeh conteaza ca editata', () => {
    // Altfel n-ar aparea insigna de "editat" si Reseteaza ar parea inactiv.
    expect(isNeutral({ ...NEUTRAL_ADJUSTMENTS })).toBe(true);
    expect(isNeutral({ ...NEUTRAL_ADJUSTMENTS, bokeh: 40 })).toBe(false);
  });
});
