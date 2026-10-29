import { describe, expect, it } from 'vitest';
import { aiSize, maskBounds, maskCoverage, skyMask } from './magic';

function image(w: number, h: number, px: (x: number, y: number) => [number, number, number]): Uint8ClampedArray {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const [r, g, b] = px(x, y);
    d.set([r, g, b, 255], (y * w + x) * 4);
  }
  return d;
}

describe('magic', () => {
  it('cerul de sus e găsit, copacii de jos nu', () => {
    const w = 20, h = 20;
    const d = image(w, h, (_x, y) => (y < 8 ? [150, 190, 235] : [40, 110, 40]));
    const m = skyMask(d, w, h);
    expect(maskCoverage(m)).toBeCloseTo(8 / 20, 2);
    expect(m[19 * w]).toBe(0);
  });

  it('un perete alb jos, nelegat de cer, nu e cer', () => {
    const w = 10, h = 10;
    const d = image(w, h, (_x, y) => (y < 3 ? [150, 190, 235] : y < 6 ? [30, 30, 30] : [240, 240, 240]));
    expect(skyMask(d, w, h)[8 * w]).toBe(0);
  });

  it('cutia măștii, lărgită și ținută în poză', () => {
    const w = 100, h = 100;
    const m = new Uint8Array(w * h);
    for (let y = 40; y < 50; y++) for (let x = 40; x < 50; x++) m[y * w + x] = 1;
    const r = maskBounds(m, w, h)!;
    expect(r.x).toBeLessThan(40);
    expect(r.x + r.w).toBeGreaterThan(50);
    expect(r.x).toBeGreaterThanOrEqual(0);
    expect(maskBounds(new Uint8Array(4), 2, 2)).toBeNull();
  });

  it('mărimea pentru AI păstrează proporția, în multipli de 64', () => {
    expect(aiSize(4000, 3000)).toEqual({ width: 512, height: 384 });
    expect(aiSize(1000, 1000)).toEqual({ width: 512, height: 512 });
  });
});
