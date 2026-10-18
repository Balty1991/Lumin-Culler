import { describe, expect, it } from 'vitest';
import { exposureFromPixels, laplacianVariance, sharpnessFromVariance } from './fastSignals';

/**
 * Bugetul pasului rapid, fără decodare și fără modele.
 *
 * Decodarea JPEG (înainte: 2048px, calitate mare; acum: 384px) se măsoară în
 * browser, pentru că jsdom nu decodează imagini. Aici se măsoară lucrul pe
 * pixeli, care înainte stătea pe firul principal la rezoluția de studio.
 */
function frame(width: number, height: number, seed: number): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4);
  let n = seed;
  for (let i = 0; i < data.length; i += 4) {
    n = (n * 1664525 + 1013904223) >>> 0;
    const g = n & 255;
    data[i] = g;
    data[i + 1] = g;
    data[i + 2] = g;
    data[i + 3] = 255;
  }
  return data;
}

function timeBatch(count: number, width: number, height: number): number {
  const started = performance.now();
  for (let i = 0; i < count; i++) {
    const data = frame(width, height, i + 1);
    const variance = laplacianVariance(data, width, height);
    sharpnessFromVariance(variance);
    exposureFromPixels(data);
  }
  return performance.now() - started;
}

describe('pasul rapid — buget pe pixeli', () => {
  it('14 cadre de 384×256 stau mult sub o secundă pe cadru', () => {
    const ms = timeBatch(14, 384, 256);
    expect(ms / 14).toBeLessThan(50);
    expect(ms).toBeLessThan(700);
  });

  it('100 cadre de 384×256 stau sub o secundă pe cadru', () => {
    const ms = timeBatch(100, 160, 120);
    expect(ms / 100).toBeLessThan(20);
    expect(ms).toBeLessThan(2000);
  });

  it('o varianță mică cade sub pragul de neclar, una mare nu', () => {
    expect(sharpnessFromVariance(10)).toBeLessThan(45);
    expect(sharpnessFromVariance(400)).toBeGreaterThan(45);
  });
});
