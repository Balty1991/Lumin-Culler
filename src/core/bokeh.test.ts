import { describe, it, expect } from 'vitest';
import { subjectFromFaces, NEUTRAL_ADJUSTMENTS, isNeutral, persistableAdjustments } from './imageAdjust';

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

describe('conturul real bate caseta fetei', () => {
  it('bokehMask e ignorat de isNeutral — e o unealta, nu o ajustare', () => {
    // Masca se poate reface oricand din poza si nu se salveaza in Dexie; daca
    // ar conta ca editare, o poza needitata ar aparea ca editata doar fiindca
    // s-a deschis sliderul.
    const mask = { width: 8, height: 8 } as unknown as CanvasImageSource;
    expect(isNeutral({ ...NEUTRAL_ADJUSTMENTS, bokehMask: mask })).toBe(true);
    expect(isNeutral({ ...NEUTRAL_ADJUSTMENTS, bokehMask: mask, bokeh: 30 })).toBe(false);
  });
});

/**
 * Bug real: cu bokeh pornit, salvarea ajustarilor in Dexie esua tacut. Masca e
 * un HTMLImageElement, iar IndexedDB scrie prin structured clone, care nu poate
 * clona un element de DOM — deci se pierdeau TOATE ajustarile pozei, nu doar
 * masca. Testul foloseste `structuredClone` din Node, acelasi algoritm.
 */
describe('ce se salveaza pe disc', () => {
  const fakeMask = { nodeType: 1, tagName: 'IMG' } as unknown as CanvasImageSource;

  it('scoate masca de bokeh, care nu poate fi clonata', () => {
    const cu = { ...NEUTRAL_ADJUSTMENTS, bokeh: 82, bokehMask: fakeMask };
    expect(persistableAdjustments(cu).bokehMask).toBeUndefined();
  });

  it('pastreaza tot ce trebuie ca bokeh-ul sa poata fi refacut', () => {
    const subject = { x: 0.2, y: 0.1, width: 0.4, height: 0.6 };
    const salvat = persistableAdjustments({ ...NEUTRAL_ADJUSTMENTS, bokeh: 82, bokehSubject: subject, bokehMask: fakeMask });
    expect(salvat.bokeh).toBe(82);
    expect(salvat.bokehSubject).toEqual(subject);
  });

  it('nu schimba obiectul cand nu e nicio masca de scos', () => {
    const fara = { ...NEUTRAL_ADJUSTMENTS, bokeh: 40 };
    expect(persistableAdjustments(fara)).toBe(fara);
  });

  it('rezultatul chiar trece prin structured clone', () => {
    // Fara persistableAdjustments, linia asta arunca DataCloneError pe un
    // HTMLImageElement real — exact ce se intampla in IndexedDB.
    const salvat = persistableAdjustments({ ...NEUTRAL_ADJUSTMENTS, bokeh: 82, bokehMask: fakeMask });
    expect(() => structuredClone(salvat)).not.toThrow();
  });
});
