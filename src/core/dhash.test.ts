import { describe, expect, it } from 'vitest';
import { dHashFromRgba, hamming64, thumbMetrics } from './dhash';

function solid(width: number, height: number, rgba: [number, number, number, number]): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = rgba[0];
    data[i + 1] = rgba[1];
    data[i + 2] = rgba[2];
    data[i + 3] = rgba[3];
  }
  return data;
}

describe('dHash 9x8', () => {
  it('un degrade stânga-dreapta aprinde toți biții', () => {
    const data = new Uint8ClampedArray(9 * 8 * 4);
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 9; x++) {
        const i = (y * 9 + x) * 4;
        const v = 255 - x * 20;
        data[i] = data[i + 1] = data[i + 2] = v;
        data[i + 3] = 255;
      }
    }
    expect(dHashFromRgba(data, 9)).toBe('1'.repeat(64));
    expect(dHashFromRgba(data, 9)).toHaveLength(64);
  });

  it('o imagine constantă are distanța zero față de ea însăși', () => {
    const hash = dHashFromRgba(solid(9, 8, [10, 20, 30, 255]), 9);
    expect(hamming64(hash, hash)).toBe(0);
    expect(hamming64(hash, '1'.repeat(64))).toBeGreaterThan(0);
  });

  it('expunerea urmărește lumina medie', () => {
    const dark = thumbMetrics(solid(9, 8, [0, 0, 0, 255]), 9);
    const mid = thumbMetrics(solid(9, 8, [128, 128, 128, 255]), 9);
    expect(dark.exposure).toBe(0);
    expect(mid.exposure).toBeGreaterThan(40);
    expect(mid.exposure).toBeLessThan(60);
  });
});
