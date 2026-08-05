import { describe, expect, it } from 'vitest';
import {
  computeAutoContrast, computeAutoExposureFromScore, computeAutoHighlightsShadows,
  computeAutoCrop, computeAutoStraighten, computeAutoSaturation, isNeutral, NEUTRAL_ADJUSTMENTS,
  type AutoAdjustSignals
} from './imageAdjust';

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
    const crop = computeAutoCrop({ faceCount: 1, ruleOfThirds: 0.1, faces: faceAt(0.02, 0.02) });
    expect(crop).toBeDefined();
    expect(crop!.x).toBeGreaterThanOrEqual(0);
    expect(crop!.y).toBeGreaterThanOrEqual(0);
    expect(crop!.x + crop!.width).toBeLessThanOrEqual(1.0001);
    expect(crop!.y + crop!.height).toBeLessThanOrEqual(1.0001);
  });

  it('does nothing when faceCount is set but faces[] is empty (defensive — should not happen in practice)', () => {
    expect(computeAutoCrop({ faceCount: 1, ruleOfThirds: 0.1, faces: [] })).toBeUndefined();
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
