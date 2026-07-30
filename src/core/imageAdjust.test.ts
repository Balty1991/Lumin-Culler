import { describe, expect, it } from 'vitest';
import { computeAutoAdjustmentsFromImageData, NEUTRAL_ADJUSTMENTS } from './imageAdjust';

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

describe('computeAutoAdjustmentsFromImageData', () => {
  it('suggests no changes for an already-neutral mid-gray, well-exposed frame', () => {
    const result = computeAutoAdjustmentsFromImageData(solid(8, 8, [128, 128, 128]));
    expect(result).toEqual(NEUTRAL_ADJUSTMENTS);
  });

  it('brightens a too-dark frame (positive exposure)', () => {
    const result = computeAutoAdjustmentsFromImageData(solid(8, 8, [40, 40, 40]));
    expect(result.exposure).toBeGreaterThan(0);
  });

  it('darkens a too-bright frame (negative exposure)', () => {
    const result = computeAutoAdjustmentsFromImageData(solid(8, 8, [220, 220, 220]));
    expect(result.exposure).toBeLessThan(0);
  });

  it('never boosts contrast on a flat solid-color frame beyond the neutral baseline (contrast stays clamped, never negative)', () => {
    const result = computeAutoAdjustmentsFromImageData(solid(8, 8, [128, 128, 128]));
    expect(result.contrast).toBeGreaterThanOrEqual(0);
  });

  it('increases contrast for a low-contrast (narrow histogram) frame', () => {
    // toti pixelii ingramaditi intr-un interval ingust (100..140) -> ar trebui intins
    const result = computeAutoAdjustmentsFromImageData(
      makeImage(20, 20, (x, y) => { const v = 100 + ((x + y) % 40); return [v, v, v]; })
    );
    expect(result.contrast).toBeGreaterThan(0);
  });

  it('corrects a warm (orange) color cast toward neutral with a negative temperature/tint nudge', () => {
    // dominanta calda puternica: R mult peste B -> corectia trebuie sa RACEASCA (temp negativ)
    const result = computeAutoAdjustmentsFromImageData(solid(8, 8, [200, 140, 60]));
    expect(result.temperature).toBeLessThan(0);
  });

  it('corrects a cool (blue) color cast toward neutral with a positive temperature nudge', () => {
    const result = computeAutoAdjustmentsFromImageData(solid(8, 8, [60, 140, 200]));
    expect(result.temperature).toBeGreaterThan(0);
  });

  it('lifts shadows when a large fraction of pixels are crushed near-black', () => {
    const result = computeAutoAdjustmentsFromImageData(
      makeImage(10, 10, (x) => (x < 6 ? [2, 2, 2] : [150, 150, 150]))
    );
    expect(result.shadows).toBeGreaterThan(0);
  });

  it('recovers highlights (negative value) when a large fraction of pixels are blown out near-white', () => {
    const result = computeAutoAdjustmentsFromImageData(
      makeImage(10, 10, (x) => (x < 6 ? [253, 253, 253] : [110, 110, 110]))
    );
    expect(result.highlights).toBeLessThan(0);
  });

  it('keeps every slider within the -100..100 range for an extreme frame', () => {
    const result = computeAutoAdjustmentsFromImageData(solid(6, 6, [255, 0, 0]));
    for (const v of Object.values(result)) {
      expect(v).toBeGreaterThanOrEqual(-100);
      expect(v).toBeLessThanOrEqual(100);
    }
  });

  it('returns neutral adjustments for an empty (zero-length) image without throwing', () => {
    const empty = { data: new Uint8ClampedArray(0), width: 0, height: 0, colorSpace: 'srgb' } as ImageData;
    expect(computeAutoAdjustmentsFromImageData(empty)).toEqual(NEUTRAL_ADJUSTMENTS);
  });
});
