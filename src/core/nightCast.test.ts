import { describe, expect, it } from 'vitest';
import { computeNightCast } from './imageAdjust';

function image(pixel: (i: number) => [number, number, number], n = 64 * 64): ImageData {
  const data = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) { const [r, g, b] = pixel(i); data.set([r, g, b, 255], i * 4); }
  return { data, width: 64, height: 64, colorSpace: 'srgb' } as ImageData;
}

describe('computeNightCast', () => {
  it('lumina roz peste toată scena: răcește și trage spre verde', () => {
    const c = computeNightCast(image(i => [200 - (i % 40), 120 - (i % 30), 170 - (i % 40)]));
    expect(c.temperature).toBeLessThan(-10);
    expect(c.tint).toBeGreaterThan(5);
    expect(c.tint).toBeLessThanOrEqual(20);
  });
  it('culori amestecate (nu o lumină colorată): aproape nimic', () => {
    const c = computeNightCast(image(i => (Math.floor(i / 4) % 2 ? [190, 120, 80] : [80, 120, 190])));
    expect(Math.abs(c.temperature)).toBeLessThan(6);
    expect(c.tint).toBe(0);
  });
  it('scenă neutră: nimic', () => {
    expect(computeNightCast(image(() => [140, 140, 140]))).toEqual({ temperature: 0, tint: 0 });
  });
});
