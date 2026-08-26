import { describe, it, expect } from 'vitest';
import { subjectFromFaces, NEUTRAL_ADJUSTMENTS, isNeutral, persistableAdjustments, luminanceToAlpha, radialSharpZone } from './imageAdjust';

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

/**
 * Bug-ul care a tinut bokeh-ul complet mort patru build-uri la rand.
 *
 * `destination-out` sterge dupa ALPHA, nu dupa culoare. Masca venea de la
 * segmenter cu fundalul NEGRU OPAC, iar negrul opac sterge exact la fel de bine
 * ca albul opac — deci se stergea tot cadrul din copia estompata si peste poza
 * clara se desena o panza goala. Sliderul parea rupt fiindca chiar nu schimba
 * niciun pixel.
 *
 * Masurat in Chromium inainte si dupa reparatie, pe aceeasi poza de test
 * (varianta locala pe o zona de fundal): 27,69 → 27,69 cu masca opaca, adica
 * zero efect; 27,69 → 1,01 dupa normalizare, cu subiectul ramas la 27,69.
 */
describe('masca de segmentare, luminanta → transparenta', () => {
  /** Un pixel RGBA, ca sa se citeasca testele. */
  const px = (r: number, g: number, b: number, a: number) => [r, g, b, a];
  const run = (...pixels: number[][]) => {
    const d = new Uint8ClampedArray(pixels.flat());
    luminanceToAlpha(d);
    return d;
  };

  it('albul opac (persoana) devine complet opac', () => {
    expect(run(px(255, 255, 255, 255))[3]).toBe(255);
  });

  it('negrul OPAC (fundal) devine complet transparent — miezul bug-ului', () => {
    // Inainte de reparatie pixelul asta stergea tot ce era sub el.
    expect(run(px(0, 0, 0, 255))[3]).toBe(0);
  });

  it('e idempotenta: o masca deja corecta trece neatinsa', () => {
    // Formatul nou trimis de SegmentationPlugin: persoana alba opaca, fundal
    // complet transparent. A doua trecere nu are voie sa strice nimic.
    const o = run(px(255, 255, 255, 255), px(0, 0, 0, 0));
    const dublu = run([...o.slice(0, 4)], [...o.slice(4, 8)]);
    expect([...dublu]).toEqual([...o]);
  });

  it('pastreaza semitonurile de pe contur, ca muchia sa ramana moale', () => {
    const gri = run(px(128, 128, 128, 255))[3];
    expect(gri).toBeGreaterThan(100);
    expect(gri).toBeLessThan(160);
  });

  it('culoarea devine alba peste tot — conteaza doar alpha', () => {
    const d = run(px(10, 200, 90, 255));
    expect([d[0], d[1], d[2]]).toEqual([255, 255, 255]);
  });
});

/**
 * Al doilea bug care facea bokeh-ul sa nu schimbe niciun pixel, gasit tot
 * masurand in Chromium — dar din alta cauza decat masca opaca.
 *
 * Zona lasata clara folosea LATURA casetei drept raza. Pe un subiect inalt
 * (o persoana in picioare, cazul obisnuit) raza depasea semidiagonala
 * cadrului, gradientul iesea opac peste tot, si `destination-out` stergea
 * toata copia estompata.
 *
 * Regula pe care o apara testele: gradientul trebuie sa apuce sa ajunga la
 * transparent INAINTE de coltul cadrului, altfel nu ramane nimic de compus.
 */
describe('zona clara a bokeh-ului de rezerva', () => {
  const W = 600, H = 400;
  const halfDiagonal = Math.hypot(W, H) / 2;

  it('nu inghite tot cadrul pe o persoana in picioare', () => {
    // Cazul care rupea totul: caseta inalta de 76% din cadru.
    const z = radialSharpZone({ x: 0.35, y: 0.12, width: 0.3, height: 0.76 }, undefined, W, H);
    expect(z.inner).toBeLessThan(halfDiagonal);
  });

  it('lasa loc de estompare chiar si cand subiectul umple cadrul', () => {
    const z = radialSharpZone({ x: 0, y: 0, width: 1, height: 1 }, undefined, W, H);
    expect(z.inner).toBeLessThanOrEqual(halfDiagonal * 0.6);
  });

  it('foloseste jumatatea laturii, nu latura', () => {
    // Caseta lata de jumatate din cadru = 300px, deci raza ~150 (plus marja),
    // nu ~300 si cu atat mai putin ~420 ca inainte.
    const z = radialSharpZone({ x: 0.25, y: 0.4, width: 0.5, height: 0.2 }, undefined, W, H);
    expect(z.inner).toBeCloseTo(150 * 1.15, 1);
  });

  it('marginea exterioara e mereu dincolo de cea interioara', () => {
    // Un gradient cu outer <= inner nu are panta: ar fi o taietura brusca.
    for (const h of [0.1, 0.4, 0.9, 1]) {
      const z = radialSharpZone({ x: 0.2, y: 0, width: 0.6, height: h }, undefined, W, H);
      expect(z.outer).toBeGreaterThan(z.inner);
    }
  });

  it('centrul urmeaza subiectul, si tine cont de decupare', () => {
    const fara = radialSharpZone({ x: 0.4, y: 0.4, width: 0.2, height: 0.2 }, undefined, W, H);
    expect(fara.cx).toBeCloseTo(W / 2, 5);
    expect(fara.cy).toBeCloseTo(H / 2, 5);
    // Aceeasi fata, dar vedem doar sfertul din stanga-sus: se muta la dreapta-jos.
    const cu = radialSharpZone(
      { x: 0.4, y: 0.4, width: 0.2, height: 0.2 },
      { x: 0, y: 0, width: 0.5, height: 0.5 }, W, H
    );
    expect(cu.cx).toBeCloseTo(W, 5);
    expect(cu.cy).toBeCloseTo(H, 5);
  });
});
