import { describe, expect, it } from 'vitest';
import { computeAutoContrast, computeAutoExposureFromScore, computeAutoHighlightsShadows } from './imageAdjust';

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
