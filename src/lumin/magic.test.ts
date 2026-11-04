import { describe, expect, it } from 'vitest';
import { aiSize, fillMasked, maskBounds, maskCoverage, skyMask } from './magic';

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

  it('cerul gri devine albastru doar în mască', () => {
    const w = 12, h = 10;
    const d = image(w, h, () => [180, 180, 180]);
    const mask = new Uint8Array(w * h);
    for (let i = 0; i < w * 4; i++) mask[i] = 1;
    fillMasked(d, mask, w, h, 'sky-blue');
    expect(d[2]).toBeGreaterThan(d[0]);
    const ground = (h - 1) * w * 4;
    expect(d[ground]).toBe(180);
  });

  it('mărimea pentru AI păstrează proporția, în multipli de 64', () => {
    expect(aiSize(4000, 3000)).toEqual({ width: 512, height: 384 });
    expect(aiSize(1000, 1000)).toEqual({ width: 512, height: 512 });
  });
});

describe('maskComponents', () => {
  it('separă semnele depărtate și le unește pe cele apropiate', async () => {
    const { maskComponents } = await import('./magic');
    const w = 40, h = 20, m = new Uint8Array(w * h);
    m[2 * w + 2] = 1; m[2 * w + 4] = 1; // aproape: o zonă
    m[15 * w + 35] = 1; // departe: altă zonă
    const c = maskComponents(m, w, h, 3);
    expect(c.length).toBe(2);
    expect(c[0]).toEqual({ x: 2, y: 2, w: 3, h: 1 });
  });
});
