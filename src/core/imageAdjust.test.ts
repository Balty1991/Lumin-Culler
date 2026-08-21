import { describe, expect, it } from 'vitest';
import {
  computeAutoContrast, computeAutoExposureFromScore, computeAutoHighlightsShadows,
  computeAutoCrop, computeAutoStraighten, computeAutoSaturation, isNeutral, NEUTRAL_ADJUSTMENTS,
  applyDetailPass, applyVignette, originalToCanvas, canvasToOriginal, cropRadiusScale,
  type AutoAdjustSignals, type EditAdjustments, computeAutoFaceExposure,
  computeAutoWhiteBalance, computeAutoLevels, computeAutoVibrance } from './imageAdjust';

function makeImage(w: number, h: number, paint: (x: number, y: number) => [number, number, number]): ImageData {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [r, g, b] = paint(x, y);
      const i = (y * w + x) * 4;
      data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255;
    }
  }
  return { data, width: w, height: h, colorSpace: 'srgb' } as ImageData;
}

function solid(w: number, h: number, rgb: [number, number, number]): ImageData {
  return makeImage(w, h, () => rgb);
}

// computeAutoExposureFromScore/computeAutoHighlightsShadows raspund la ACELEASI
// campuri/praguri deja folosite de aiExplanationGenerator.ts (generateSuggestions)
// pentru "De ce acest scor" — testele de mai jos verifica direct acea consistenta.

describe('computeAutoExposureFromScore', () => {
  it('suggests no change for a balanced score (50)', () => {
    expect(computeAutoExposureFromScore(50)).toBe(0);
  });

  it('darkens (negative) for a score flagged as overexposed, matching aiSuggest.overexposed direction (score - 50 > 15)', () => {
    expect(computeAutoExposureFromScore(80)).toBeLessThan(0);
  });

  it('brightens (positive) for a score flagged as underexposed, matching aiSuggest.underexposed direction (score - 50 < -15)', () => {
    expect(computeAutoExposureFromScore(20)).toBeGreaterThan(0);
  });

  it('makes no correction when the photo has not been analyzed yet (undefined score)', () => {
    expect(computeAutoExposureFromScore(undefined)).toBe(0);
  });

  it('stays within the slider range for an extreme score', () => {
    const hot = computeAutoExposureFromScore(100);
    const cold = computeAutoExposureFromScore(0);
    expect(hot).toBeGreaterThanOrEqual(-100);
    expect(hot).toBeLessThanOrEqual(100);
    expect(cold).toBeGreaterThanOrEqual(-100);
    expect(cold).toBeLessThanOrEqual(100);
    expect(hot).toBeLessThan(0);
    expect(cold).toBeGreaterThan(0);
  });
});

describe('computeAutoHighlightsShadows', () => {
  it('does nothing below the 0.06 clipping threshold used by the suggestion text', () => {
    expect(computeAutoHighlightsShadows(0.06, 0.06)).toEqual({ highlights: 0, shadows: 0 });
    expect(computeAutoHighlightsShadows(0.02, 0.02)).toEqual({ highlights: 0, shadows: 0 });
  });

  it('recovers highlights (negative) once above the threshold', () => {
    const { highlights } = computeAutoHighlightsShadows(0.2, 0);
    expect(highlights).toBeLessThan(0);
  });

  it('lifts shadows (positive) once above the threshold', () => {
    const { shadows } = computeAutoHighlightsShadows(0, 0.2);
    expect(shadows).toBeGreaterThan(0);
  });

  it('treats missing fields as zero (no clipping data = no correction)', () => {
    expect(computeAutoHighlightsShadows(undefined, undefined)).toEqual({ highlights: 0, shadows: 0 });
  });

  it('stays within the slider range for extreme clipping fractions', () => {
    const { highlights, shadows } = computeAutoHighlightsShadows(1, 1);
    expect(highlights).toBeGreaterThanOrEqual(-100);
    expect(shadows).toBeLessThanOrEqual(100);
  });
});

describe('computeAutoContrast', () => {
  it('suggests no change for a perfectly flat solid-color frame', () => {
    expect(computeAutoContrast(solid(8, 8, [128, 128, 128]))).toBe(0);
  });

  it('never goes negative', () => {
    expect(computeAutoContrast(solid(8, 8, [40, 40, 40]))).toBeGreaterThanOrEqual(0);
  });

  it('increases contrast for a low-contrast (narrow histogram) frame', () => {
    const result = computeAutoContrast(
      makeImage(20, 20, (x, y) => { const v = 100 + ((x + y) % 40); return [v, v, v]; })
    );
    expect(result).toBeGreaterThan(0);
  });

  it('returns 0 for an empty (zero-length) image without throwing', () => {
    const empty = { data: new Uint8ClampedArray(0), width: 0, height: 0, colorSpace: 'srgb' } as ImageData;
    expect(computeAutoContrast(empty)).toBe(0);
  });

  it('stays within the slider range for an already high-contrast frame', () => {
    const result = computeAutoContrast(
      makeImage(20, 20, (x) => (x < 10 ? [0, 0, 0] : [255, 255, 255]))
    );
    expect(result).toBeGreaterThanOrEqual(0);
    expect(result).toBeLessThanOrEqual(100);
  });
});

// computeAutoCrop/computeAutoStraighten/computeAutoSaturation raspund la ACELEASI
// campuri/praguri deja folosite de aiExplanationGenerator.ts (generateSuggestions)
// pentru "aiSuggest.centered"/"aiSuggest.horizonTilt"/"aiSuggest.colorHarmony" —
// testele de mai jos verifica direct acea consistenta (Auto nu poate "vedea" o
// problema pe care panoul de explicatii n-o mentioneaza deloc).

describe('computeAutoCrop', () => {
  const faceAt = (cx: number, cy: number): AutoAdjustSignals['faces'] => [{ box: [cx - 0.05, cy - 0.05, 0.1, 0.1] }];

  it('does nothing without a face, matching aiSuggest.centered (gated on faceCount > 0)', () => {
    expect(computeAutoCrop({ faceCount: 0, ruleOfThirds: 0.1, faces: faceAt(0.5, 0.5) })).toBeUndefined();
  });

  it('does nothing when ruleOfThirds is already at/above the 0.4 threshold', () => {
    expect(computeAutoCrop({ faceCount: 1, ruleOfThirds: 0.4, faces: faceAt(0.5, 0.5) })).toBeUndefined();
    expect(computeAutoCrop({ faceCount: 1, ruleOfThirds: 0.9, faces: faceAt(0.5, 0.5) })).toBeUndefined();
  });

  it('proposes a crop for a centered subject below the threshold', () => {
    const crop = computeAutoCrop({ faceCount: 1, ruleOfThirds: 0.1, faces: faceAt(0.5, 0.5) });
    expect(crop).toBeDefined();
    expect(crop!.width).toBeGreaterThan(0);
    expect(crop!.height).toBeGreaterThan(0);
  });

  it('always stays within the [0,1] frame, even for a subject near the edge', () => {
    // Fata de dimensiune normala (20% din cadru, deasupra SMALL_FACE_HEIGHT_THRESHOLD)
    // ca sa ramana pe ramura "portret" (BODY_MARGIN_Y proportional) — o fata mica
    // aici ar declansa noua ramura "corp intreg" (safeBottom=1), care renunta
    // intentionat la recadrare langa marginea de sus a cadrului (vezi testul dedicat
    // "renunta la recadrare pentru un cadru de corp intreg" mai jos).
    const nearEdgeFace: AutoAdjustSignals['faces'] = [{ box: [0.02, 0.02, 0.2, 0.2] }];
    const crop = computeAutoCrop({ faceCount: 1, ruleOfThirds: 0.1, faces: nearEdgeFace });
    expect(crop).toBeDefined();
    expect(crop!.x).toBeGreaterThanOrEqual(0);
    expect(crop!.y).toBeGreaterThanOrEqual(0);
    expect(crop!.x + crop!.width).toBeLessThanOrEqual(1.0001);
    expect(crop!.y + crop!.height).toBeLessThanOrEqual(1.0001);
  });

  it('does nothing when faceCount is set but faces[] is empty (defensive — should not happen in practice)', () => {
    expect(computeAutoCrop({ faceCount: 1, ruleOfThirds: 0.1, faces: [] })).toBeUndefined();
  });

  // Bug real raportat de utilizator: recadrarea automata a sectionat bratul
  // unei persoane. Algoritmul vechi alinia DOAR centrul fetei la o intersectie
  // de treimi, fara nicio garantie ca zona din jur (unde poate fi un brat
  // ridicat/umeri) ramane in cadrul recadrat.
  describe('zona de siguranta din jurul fetei (brate/umeri) — fix pentru bug-ul de sectionare', () => {
    it('impinge fereastra sa acopere zona de siguranta, chiar daca strica alinierea perfecta pe treimi', () => {
      // Fata medie (20% din cadru), pozitionata astfel incat alinierea "doar pe
      // centru" ar lasa zona de siguranta din dreapta/de jos in afara ferestrei
      // de 0.78 — verificat manual: vechiul algoritm producea x:[0.08,0.86],
      // y:[0.08,0.86], in timp ce zona de siguranta cerea sa acopere pana la 0.94/1.0.
      const faces: AutoAdjustSignals['faces'] = [{ box: [0.5, 0.5, 0.2, 0.2] }];
      const crop = computeAutoCrop({ faceCount: 1, ruleOfThirds: 0.1, faces });
      expect(crop).toBeDefined();

      const [fx, fy, fw, fh] = faces![0].box;
      const safeLeft = Math.max(0, fx - fw * 1.2);
      const safeRight = Math.min(1, fx + fw + fw * 1.2);
      const safeTop = Math.max(0, fy - fh * 0.6);
      const safeBottom = Math.min(1, fy + fh + fh * 2.5);

      expect(crop!.x).toBeLessThanOrEqual(safeLeft + 1e-9);
      expect(crop!.x + crop!.width).toBeGreaterThanOrEqual(safeRight - 1e-9);
      expect(crop!.y).toBeLessThanOrEqual(safeTop + 1e-9);
      expect(crop!.y + crop!.height).toBeGreaterThanOrEqual(safeBottom - 1e-9);
    });

    it('renunta complet la recadrare cand zona de siguranta nu incape in fereastra (fata foarte mare/apropiata)', () => {
      // Fata ocupa 60% din latime — zona de siguranta (fw * (1+2*1.2) = 2.4*fw = 1.44,
      // clampata la [0,1]) depaseste CROP_SCALE (0.78) indiferent de pozitionare.
      const bigFace: AutoAdjustSignals['faces'] = [{ box: [0.2, 0.2, 0.6, 0.6] }];
      expect(computeAutoCrop({ faceCount: 1, ruleOfThirds: 0.1, faces: bigFace })).toBeUndefined();
    });

    // Bug real raportat de utilizator, DUPA fix-ul de mai sus pentru brate:
    // o poza cu corpul intreg vizibil (copil in picioare, la distanta — fata
    // mica fata de cadru) tot avea picioarele taiate. O marja proportionala
    // cu inaltimea fetei (2.5x, calibrata pentru un portret apropiat)
    // subestima drastic distanta reala pana la picioare intr-un cadru de
    // corp intreg.
    it('renunta la recadrare pentru un cadru de corp intreg (fata mica, mult spatiu vizibil dedesubt)', () => {
      // Fata mica (8% din cadru), aproape de partea de sus — tipic pentru o
      // poza cu subiectul vazut din cap pana in picioare, la distanta.
      const smallFace: AutoAdjustSignals['faces'] = [{ box: [0.4, 0.05, 0.08, 0.08] }];
      expect(computeAutoCrop({ faceCount: 1, ruleOfThirds: 0.1, faces: smallFace })).toBeUndefined();
    });

    // Feedback direct al utilizatorului dupa fix-ul de mai sus: "nu vreau sa
    // renunte, sa se orienteze corect" — o fata mica NU trebuie sa insemne
    // automat "fara nicio recompunere", doar "nu recompunerea IDEALA (0.78)".
    // Cand zona de siguranta cere o fereastra mai mare (ex. 0.85) dar tot mai
    // mica decat cadrul intreg, Auto foloseste acea fereastra mai larga —
    // o recompunere mai blanda, dar reala — in loc sa renunte complet.
    it('foloseste o fereastra mai larga (nu CROP_SCALE ideal, dar nici renuntare) cand corpul intreg cere putin mai mult spatiu', () => {
      const face: AutoAdjustSignals['faces'] = [{ box: [0.4, 0.2, 0.08, 0.08] }];
      const crop = computeAutoCrop({ faceCount: 1, ruleOfThirds: 0.1, faces: face });
      expect(crop).toBeDefined();
      expect(crop!.width).toBeGreaterThan(0.78); // CROP_SCALE (nu exportata) — recompunerea "ideala"
      expect(crop!.width).toBeLessThan(1);
      expect(crop!.height).toBe(crop!.width);
      // Tot corpul (fata + tot ce e dedesubt, pana la marginea de jos a cadrului) ramane in fereastra.
      expect(crop!.y).toBeLessThanOrEqual(0.2 - 0.08 * 0.6 + 1e-9);
      expect(crop!.y + crop!.height).toBeGreaterThanOrEqual(1 - 1e-9);
    });
  });
});

describe('computeAutoStraighten', () => {
  it('does nothing when faces are present, matching aiSuggest.horizonTilt (faceless-only)', () => {
    expect(computeAutoStraighten({ faceCount: 1, horizonTiltDeg: 6 })).toBe(0);
  });

  it('does nothing below the 2 degree threshold', () => {
    expect(computeAutoStraighten({ faceCount: 0, horizonTiltDeg: 1.5 })).toBe(0);
  });

  it('proposes a corrective rotation opposite the tilt direction, above the threshold', () => {
    expect(computeAutoStraighten({ faceCount: 0, horizonTiltDeg: 6 })).toBeLessThan(0);
    expect(computeAutoStraighten({ faceCount: 0, horizonTiltDeg: -6 })).toBeGreaterThan(0);
  });

  it('clamps to the max allowed rotation for an extreme tilt', () => {
    const r = computeAutoStraighten({ faceCount: 0, horizonTiltDeg: 45 });
    expect(Math.abs(r)).toBeLessThanOrEqual(8);
  });
});

describe('computeAutoSaturation', () => {
  it('does nothing above the 0.35 threshold', () => {
    expect(computeAutoSaturation({ colorHarmonyScore: 0.35 })).toBe(0);
    expect(computeAutoSaturation({ colorHarmonyScore: 0.8 })).toBe(0);
  });

  it('applies a modest desaturation (never a saturation increase) below the threshold', () => {
    expect(computeAutoSaturation({ colorHarmonyScore: 0.1 })).toBeLessThan(0);
  });

  it('does nothing when colorHarmonyScore is undefined', () => {
    expect(computeAutoSaturation({})).toBe(0);
  });
});

describe('isNeutral with crop/rotationDeg', () => {
  it('treats NEUTRAL_ADJUSTMENTS as neutral', () => {
    expect(isNeutral(NEUTRAL_ADJUSTMENTS)).toBe(true);
  });

  it('is not neutral once a crop is set, even with every slider at 0', () => {
    expect(isNeutral({ ...NEUTRAL_ADJUSTMENTS, crop: { x: 0.1, y: 0.1, width: 0.8, height: 0.8 } })).toBe(false);
  });

  it('is not neutral once rotationDeg is non-zero', () => {
    expect(isNeutral({ ...NEUTRAL_ADJUSTMENTS, rotationDeg: 3 })).toBe(false);
  });
});

// Sharpen/claritate/reducere zgomot — singurele ajustari cu nevoie de pixeli
// VECINI (nu doar transformare per-pixel independenta) — testate direct pe un
// Uint8ClampedArray construit manual, fara canvas real (jsdom nu il implementeaza,
// vezi makeImage() de mai sus, folosit deja pentru computeAutoContrast).
describe('applyDetailPass', () => {
  function pixels(w: number, h: number, paint: (x: number, y: number) => [number, number, number]): Uint8ClampedArray {
    return makeImage(w, h, paint).data;
  }
  const at = (data: Uint8ClampedArray, w: number, x: number, y: number): number => data[(y * w + x) * 4];

  it('leaves pixels completely unchanged when sharpen/clarity/noiseReduction are all 0', () => {
    const before = pixels(6, 6, (x, y) => [x * 40, y * 40, 100]);
    const data = before.slice();
    applyDetailPass(data, 6, 6, { ...NEUTRAL_ADJUSTMENTS });
    expect(Array.from(data)).toEqual(Array.from(before));
  });

  describe('noiseReduction', () => {
    it('leaves a perfectly flat image unchanged (blur of a constant is the constant)', () => {
      const before = pixels(6, 6, () => [120, 130, 140]);
      const data = before.slice();
      applyDetailPass(data, 6, 6, { ...NEUTRAL_ADJUSTMENTS, noiseReduction: 100 });
      expect(Array.from(data)).toEqual(Array.from(before));
    });

    it('pulls an isolated bright pixel toward its darker neighborhood', () => {
      const data = pixels(7, 7, (x, y) => (x === 3 && y === 3 ? [255, 255, 255] : [0, 0, 0]));
      const before = at(data, 7, 3, 3);
      applyDetailPass(data, 7, 7, { ...NEUTRAL_ADJUSTMENTS, noiseReduction: 100 });
      expect(at(data, 7, 3, 3)).toBeLessThan(before);
    });
  });

  describe('sharpen', () => {
    it('leaves a perfectly flat image unchanged (no edges to accentuate)', () => {
      const before = pixels(6, 6, () => [90, 90, 90]);
      const data = before.slice();
      applyDetailPass(data, 6, 6, { ...NEUTRAL_ADJUSTMENTS, sharpen: 100 });
      expect(Array.from(data)).toEqual(Array.from(before));
    });

    it('pushes an isolated bright pixel even brighter relative to its dark surroundings', () => {
      const data = pixels(7, 7, (x, y) => (x === 3 && y === 3 ? [200, 200, 200] : [50, 50, 50]));
      const before = at(data, 7, 3, 3);
      applyDetailPass(data, 7, 7, { ...NEUTRAL_ADJUSTMENTS, sharpen: 100 });
      expect(at(data, 7, 3, 3)).toBeGreaterThan(before);
    });
  });

  describe('clarity', () => {
    it('leaves a perfectly flat image unchanged (no local contrast to touch)', () => {
      const before = pixels(8, 8, () => [128, 128, 128]);
      const data = before.slice();
      applyDetailPass(data, 8, 8, { ...NEUTRAL_ADJUSTMENTS, clarity: 100 });
      expect(Array.from(data)).toEqual(Array.from(before));
    });

    it('widens the gap across a hard edge (positive clarity = more local contrast)', () => {
      const data = pixels(20, 4, x => (x < 10 ? [60, 60, 60] : [190, 190, 190]));
      applyDetailPass(data, 20, 4, { ...NEUTRAL_ADJUSTMENTS, clarity: 100 });
      const gap = at(data, 20, 10, 0) - at(data, 20, 9, 0);
      expect(gap).toBeGreaterThan(190 - 60);
    });

    it('narrows the gap across a hard edge (negative clarity = flatter/softer)', () => {
      const data = pixels(20, 4, x => (x < 10 ? [60, 60, 60] : [190, 190, 190]));
      applyDetailPass(data, 20, 4, { ...NEUTRAL_ADJUSTMENTS, clarity: -100 });
      const gap = at(data, 20, 10, 0) - at(data, 20, 9, 0);
      expect(gap).toBeLessThan(190 - 60);
    });
  });
});

describe('vinieta', () => {
  const plat = (w: number, h: number) => {
    const d = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < d.length; i += 4) { d[i] = 200; d[i + 1] = 200; d[i + 2] = 200; d[i + 3] = 255; }
    return d;
  };

  it('intuneca colturile si lasa centrul neatins', () => {
    const w = 41, h = 41;
    const d = plat(w, h);
    applyVignette(d, w, h, 100);
    const centru = d[(20 * w + 20) * 4];
    const colt = d[(0 * w + 0) * 4];
    expect(centru).toBe(200);
    expect(colt).toBeLessThan(120);
  });

  it('intensitate negativa deschide colturile', () => {
    const w = 41, h = 41;
    const d = plat(w, h);
    applyVignette(d, w, h, -100);
    expect(d[0]).toBeGreaterThan(200);
  });

  it('creste monoton spre colt, fara inel vizibil', () => {
    const w = 81, h = 81;
    const d = plat(w, h);
    applyVignette(d, w, h, 80);
    let precedent = 201;
    for (let x = 40; x >= 0; x--) {
      const v = d[(40 * w + x) * 4];
      expect(v).toBeLessThanOrEqual(precedent);
      precedent = v;
    }
  });

  it('zero nu schimba nimic', () => {
    const w = 20, h = 20;
    const d = plat(w, h);
    const inainte = d.slice();
    applyVignette(d, w, h, 0);
    expect(Array.from(d)).toEqual(Array.from(inainte));
  });
});

describe('isNeutral cu instrumentele noi', () => {
  it('o curba desenata conteaza ca editare', () => {
    expect(isNeutral({ ...NEUTRAL_ADJUSTMENTS, curves: { master: [{ x: 0, y: 0.2 }, { x: 1, y: 1 }] } })).toBe(false);
    expect(isNeutral({ ...NEUTRAL_ADJUSTMENTS, curves: { master: [{ x: 0, y: 0 }, { x: 1, y: 1 }] } })).toBe(true);
  });

  it('un punct de control pus dar neatins NU marcheaza poza ca editata', () => {
    const punct = { id: 'a', x: 0.5, y: 0.5, radius: 0.2, brightness: 0, contrast: 0, saturation: 0, structure: 0 };
    expect(isNeutral({ ...NEUTRAL_ADJUSTMENTS, controlPoints: [punct] })).toBe(true);
    expect(isNeutral({ ...NEUTRAL_ADJUSTMENTS, controlPoints: [{ ...punct, brightness: -30 }] })).toBe(false);
  });

  it('o tusa de vindecare conteaza ca editare', () => {
    expect(isNeutral({ ...NEUTRAL_ADJUSTMENTS, heal: [] })).toBe(true);
    expect(isNeutral({ ...NEUTRAL_ADJUSTMENTS, heal: [{ points: [{ x: 0.5, y: 0.5 }], radius: 0.04 }] })).toBe(false);
  });

  it('vinieta conteaza ca editare', () => {
    expect(isNeutral({ ...NEUTRAL_ADJUSTMENTS, vignette: 40 })).toBe(false);
  });
});

describe('conversia cadru intreg <-> cadru vizibil', () => {
  const neutru: EditAdjustments = { ...NEUTRAL_ADJUSTMENTS };

  it('fara recadrare si fara rotatie, coordonatele nu se schimba', () => {
    const c = originalToCanvas(0.3, 0.7, neutru, 800, 600);
    expect(c.x).toBeCloseTo(0.3, 6);
    expect(c.y).toBeCloseTo(0.7, 6);
  });

  it('recadrarea muta si intinde: coltul decupajului devine coltul canvas-ului', () => {
    const a: EditAdjustments = { ...neutru, crop: { x: 0.25, y: 0.25, width: 0.5, height: 0.5 } };
    const coltStanga = originalToCanvas(0.25, 0.25, a, 800, 600);
    expect(coltStanga.x).toBeCloseTo(0, 6);
    expect(coltStanga.y).toBeCloseTo(0, 6);
    const mijloc = originalToCanvas(0.5, 0.5, a, 800, 600);
    expect(mijloc.x).toBeCloseTo(0.5, 6);
    expect(mijloc.y).toBeCloseTo(0.5, 6);
  });

  it('inversa chiar readuce punctul de unde a plecat — cu recadrare si rotatie', () => {
    const a: EditAdjustments = {
      ...neutru, rotationDeg: 5, crop: { x: 0.1, y: 0.2, width: 0.7, height: 0.6 }
    };
    for (const [x, y] of [[0.3, 0.4], [0.15, 0.25], [0.75, 0.7]]) {
      const c = originalToCanvas(x, y, a, 1024, 768);
      const back = canvasToOriginal(c.x, c.y, a, 1024, 768);
      expect(back.x).toBeCloseTo(x, 6);
      expect(back.y).toBeCloseTo(y, 6);
    }
  });

  it('centrul ramane centru oricat s-ar roti cadrul', () => {
    const a: EditAdjustments = { ...neutru, rotationDeg: 8 };
    const c = originalToCanvas(0.5, 0.5, a, 900, 900);
    expect(c.x).toBeCloseTo(0.5, 6);
    expect(c.y).toBeCloseTo(0.5, 6);
  });

  it('raza creste odata cu decupajul, si ramane 1 fara decupaj', () => {
    expect(cropRadiusScale(neutru)).toBe(1);
    expect(cropRadiusScale({ ...neutru, crop: { x: 0, y: 0, width: 0.5, height: 0.5 } })).toBeCloseTo(2, 6);
  });
});

describe('expunerea judecata pe subiect, nu pe tot cadrul', () => {
  /** Imagine uniforma cu un dreptunghi de alta luminozitate acolo unde e "fata". */
  function cadru(fundal: number, fata: number, box: [number, number, number, number]): ImageData {
    const w = 100, h = 100;
    const d = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = fundal;
      d[i * 4 + 3] = 255;
    }
    const [fx, fy, fw, fh] = box;
    for (let y = Math.round(fy * h); y < Math.round((fy + fh) * h); y++) {
      for (let x = Math.round(fx * w); x < Math.round((fx + fw) * w); x++) {
        const i = (y * w + x) * 4;
        d[i] = d[i + 1] = d[i + 2] = fata;
      }
    }
    return { data: d, width: w, height: h, colorSpace: 'srgb' } as ImageData;
  }

  const box: [number, number, number, number] = [0.3, 0.3, 0.4, 0.4];

  it('contralumina: fundal stralucitor, fata in intuneric — lumineaza', () => {
    // exact cazul in care histograma globala ar spune "supraexpusa" si ar intuneca
    const e = computeAutoFaceExposure(cadru(250, 20, box), [{ box }]);
    expect(e).toBeGreaterThan(0);
  });

  it('fata arsa in alb — intuneca', () => {
    expect(computeAutoFaceExposure(cadru(30, 254, box), [{ box }])).toBeLessThan(0);
  });

  it('fata intr-o zona rezonabila — nu se baga', () => {
    // banda e larga deliberat: Auto n-are nicio parere despre cat de deschis
    // ar trebui sa fie cineva la fata
    expect(computeAutoFaceExposure(cadru(128, 90, box), [{ box }])).toBe(0);
    expect(computeAutoFaceExposure(cadru(128, 150, box), [{ box }])).toBe(0);
    expect(computeAutoFaceExposure(cadru(128, 200, box), [{ box }])).toBe(0);
  });

  it('tenul inchis intr-o poza bine expusa NU e tratat ca o eroare', () => {
    // regula "expune pielea la 70%" ar fi luminat aici; noi nu urmarim nicio tinta
    expect(computeAutoFaceExposure(cadru(120, 75, box), [{ box }])).toBe(0);
  });

  it('fara fete nu are ce judeca', () => {
    expect(computeAutoFaceExposure(cadru(128, 128, box), [])).toBe(0);
    expect(computeAutoFaceExposure(cadru(128, 128, box), undefined)).toBe(0);
  });

  it('ignora cutiile degenerate in loc sa cada', () => {
    expect(computeAutoFaceExposure(cadru(128, 20, box), [{ box: [0.3, 0.3, 0, 0] }])).toBe(0);
  });

  it('nu depaseste limita de corectie', () => {
    const e = computeAutoFaceExposure(cadru(255, 0, box), [{ box }]);
    expect(Math.abs(e)).toBeLessThanOrEqual(30);
  });

  it('mai multe fete se judeca impreuna', () => {
    const b2: [number, number, number, number] = [0.05, 0.05, 0.2, 0.2];
    const img = cadru(250, 20, box);
    // a doua fata cade pe fundalul stralucitor => media urca, corectia scade
    const doua = computeAutoFaceExposure(img, [{ box }, { box: b2 }]);
    const una = computeAutoFaceExposure(img, [{ box }]);
    expect(doua).toBeLessThan(una);
  });
});


// ── Auto: balans de alb, capete, vibranta ───────────────────────────────────
// Cerinta directa a utilizatorului dupa testarea pe telefon: "cand dau mod auto,
// astept imbunatatiri majore". Pana aici Auto nu atingea deloc culoarea (temp/
// tinta ramaneau 0) si nu misca deloc capetele histogramei.

describe('computeAutoWhiteBalance', () => {
  it('incalzeste o zapada albastruie (mai mult albastru decat rosu)', () => {
    const rece = solid(16, 16, [180, 195, 215]);
    const { temperature } = computeAutoWhiteBalance(rece);
    expect(temperature).toBeGreaterThan(0);
  });

  it('raceste o dominanta calda de interior', () => {
    const cald = solid(16, 16, [215, 195, 175]);
    expect(computeAutoWhiteBalance(cald).temperature).toBeLessThan(0);
  });

  it('nu atinge nimic pe un gri deja neutru', () => {
    expect(computeAutoWhiteBalance(solid(16, 16, [140, 140, 140]))).toEqual({ temperature: 0, tint: 0 });
  });

  it('scoate dominanta verde prin tinta', () => {
    expect(computeAutoWhiteBalance(solid(16, 16, [180, 200, 182])).tint).toBeLessThan(0);
  });

  it('tace cand nu exista destui pixeli aproape-neutri (cadru puternic colorat)', () => {
    // rosu saturat: (max-min)/max = 1, cu mult peste limita de referinta neutra
    expect(computeAutoWhiteBalance(solid(16, 16, [200, 20, 20]))).toEqual({ temperature: 0, tint: 0 });
  });

  it('la ora de aur corecteaza doar partial — dominanta calda e subiectul, nu defectul', () => {
    const cald = solid(16, 16, [215, 195, 175]);
    const normal = computeAutoWhiteBalance(cald, false).temperature;
    const auriu = computeAutoWhiteBalance(cald, true).temperature;
    expect(Math.abs(auriu)).toBeLessThan(Math.abs(normal));
    expect(Math.abs(auriu)).toBeGreaterThan(0);
  });
});

describe('computeAutoLevels', () => {
  it('ridica albul cand cel mai deschis pixel ramane departe de 255', () => {
    const spalacit = makeImage(16, 16, (x) => { const v = 60 + x * 6; return [v, v, v]; }); // 60..150
    expect(computeAutoLevels(spalacit).whites).toBeGreaterThan(0);
  });

  it('coboara negrul cand cel mai inchis pixel e cenusiu', () => {
    const fumuriu = makeImage(16, 16, (x) => { const v = 70 + x * 8; return [v, v, v]; });
    expect(computeAutoLevels(fumuriu).blacks).toBeLessThan(0);
  });

  it('nu atinge o poza care ajunge deja la ambele capete', () => {
    // Esantionajul ia fiecare al 4-lea pixel (step = 16 octeti), deci pe o
    // imagine de 16 px latime vede doar x = 0, 4, 8, 12 — degradeul e construit
    // pe acele coloane ca sa atinga chiar 0 si 255 in ce se masoara.
    const plina = makeImage(16, 16, (x) => { const v = Math.round((Math.min(x, 12) / 12) * 255); return [v, v, v]; });
    expect(computeAutoLevels(plina)).toEqual({ whites: 0, blacks: 0 });
  });
});

describe('computeAutoVibrance', () => {
  it('ridica saturatia unei poze sterse', () => {
    // saturatie ~0.09: sub pragul de "sters", peste pragul de alb-negru
    expect(computeAutoVibrance(solid(16, 16, [150, 140, 137]))).toBeGreaterThan(0);
  });

  it('nu coloreaza o poza alb-negru', () => {
    expect(computeAutoVibrance(solid(16, 16, [140, 140, 140]))).toBe(0);
  });

  it('nu mai adauga nimic unei poze deja colorate', () => {
    expect(computeAutoVibrance(solid(16, 16, [200, 90, 60]))).toBe(0);
  });
});
