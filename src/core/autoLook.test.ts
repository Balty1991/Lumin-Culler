import { describe, expect, it } from 'vitest';
import { meanCast, meanLuma, type LookFace } from './autoLook';
import { renderLook } from './renderLook';

function paint(w: number, h: number, px: (x: number, y: number) => [number, number, number]): Uint8ClampedArray {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const [r, g, b] = px(x, y);
    const i = (y * w + x) * 4;
    d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = 255;
  }
  return d;
}

const face: LookFace = { box: [0.35, 0.22, 0.3, 0.34] };

describe('corecția automată pe telefon', () => {
  it('deschide o poză întunecată fără să o ardă', () => {
    const w = 80, h = 60;
    const src = paint(w, h, () => [28, 26, 24]);
    const { data, recipe } = renderLook(src, w, h);
    expect(recipe.issues).toContain('underexposed');
    expect(meanLuma(data)).toBeGreaterThan(meanLuma(src) + 0.08);
    expect(meanLuma(data)).toBeLessThan(0.75);
  });

  it('scoate dominanta albastră', () => {
    const w = 80, h = 60;
    const src = paint(w, h, (x, y) => (y < 20 ? [150, 170, 210] : [90, 100, 150]));
    const before = meanCast(src);
    const { data, recipe } = renderLook(src, w, h);
    expect(recipe.issues).toContain('cast');
    expect(recipe.adjustments.temperature).toBeGreaterThan(8);
    expect(meanCast(data)).toBeLessThan(before);
  });

  it('luminează fața din contralumina mai mult decât fundalul', () => {
    const w = 90, h = 70;
    const src = paint(w, h, (x, y) => {
      const u = x / w, v = y / h;
      const inFace = u > 0.38 && u < 0.62 && v > 0.28 && v < 0.55;
      return inFace ? [40, 32, 28] : [210, 206, 200];
    });
    const { data, recipe } = renderLook(src, w, h, [face]);
    expect(recipe.issues).toContain('backlit');
    expect(recipe.relight).toBeGreaterThan(40);
    const faceLuma = (buf: Uint8ClampedArray) => {
      let s = 0, n = 0;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const u = x / w, v = y / h;
        if (u < 0.4 || u > 0.6 || v < 0.3 || v > 0.52) continue;
        const i = (y * w + x) * 4;
        s += buf[i] + buf[i + 1] + buf[i + 2];
        n++;
      }
      return s / n;
    };
    expect(faceLuma(data)).toBeGreaterThan(faceLuma(src) + 25);
  });

  it('stinge o pupilă roșie', () => {
    const w = 80, h = 60;
    const src = paint(w, h, (x, y) => {
      const u = x / w, v = y / h;
      const eye = u > 0.46 && u < 0.52 && v > 0.32 && v < 0.4;
      if (eye) return [220, 40, 40];
      const skin = u > 0.35 && u < 0.65 && v > 0.22 && v < 0.56;
      return skin ? [190, 150, 120] : [80, 110, 70];
    });
    const { data, recipe } = renderLook(src, w, h, [face]);
    expect(recipe.issues).toContain('redEye');
    const i = (Math.floor(0.36 * h) * w + Math.floor(0.49 * w)) * 4;
    expect(data[i]).toBeLessThan(src[i] - 40);
  });

  it('nu strică o poză deja echilibrată', () => {
    const w = 64, h = 48;
    const src = paint(w, h, (x, y) => {
      const sky = y < 16 ? [120, 170, 220] : [90, 130, 70];
      const n = ((x * 13 + y * 7) % 9) - 4;
      return [sky[0] + n, sky[1] + n, sky[2] + n];
    });
    const { data } = renderLook(src, w, h);
    expect(Math.abs(meanLuma(data) - meanLuma(src))).toBeLessThan(0.12);
  });

  it('dă contrast unei poze plate și cetoase', () => {
    const w = 80, h = 60;
    const src = paint(w, h, (x, y) => {
      const base = 150 + (y / h) * 20;
      return [base, base + 2, base + 4];
    });
    const span = (buf: Uint8ClampedArray) => {
      let lo = 255, hi = 0;
      for (let i = 0; i < buf.length; i += 16) {
        const y = 0.299 * buf[i] + 0.587 * buf[i + 1] + 0.114 * buf[i + 2];
        if (y < lo) lo = y;
        if (y > hi) hi = y;
      }
      return hi - lo;
    };
    const { data, recipe } = renderLook(src, w, h);
    expect(recipe.issues.some(id => id === 'haze' || id === 'flat')).toBe(true);
    expect(span(data)).toBeGreaterThan(span(src) + 8);
  });
});
