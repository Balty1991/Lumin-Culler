import { describe, it, expect } from 'vitest';
import {
  computeControlMask, applyControlPoint, boundsFor, createControlPoint,
  isNeutralControlPoint, hasNoControlPoints, type ControlPoint
} from './selectiveEdit';

/** Imagine de test: jumatatea de sus albastra (cer), jumatatea de jos roz (piele). */
function skyAndSkin(w: number, h: number): Uint8ClampedArray {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const sus = y < h / 2;
      d[i] = sus ? 90 : 225;
      d[i + 1] = sus ? 140 : 175;
      d[i + 2] = sus ? 220 : 160;
      d[i + 3] = 255;
    }
  }
  return d;
}

const pt = (over: Partial<ControlPoint> = {}): ControlPoint =>
  ({ ...createControlPoint(0.5, 0.25, 'p1'), ...over });

describe('puncte de control selective', () => {
  it('un punct proaspat nu schimba nimic', () => {
    expect(isNeutralControlPoint(createControlPoint(0.5, 0.5, 'x'))).toBe(true);
    expect(hasNoControlPoints([createControlPoint(0.5, 0.5, 'x')])).toBe(true);
    expect(hasNoControlPoints(undefined)).toBe(true);
    expect(hasNoControlPoints([pt({ brightness: -40 })])).toBe(false);
  });

  it('masca e maxima sub punct si scade spre marginea razei', () => {
    const w = 80, h = 80;
    const d = skyAndSkin(w, h);
    const p = pt({ x: 0.5, y: 0.25, radius: 0.3 });
    const { mask, x0, y0, x1 } = computeControlMask(d, w, h, p);
    const mw = x1 - x0;
    const centru = mask[(Math.round(0.25 * h) - y0) * mw + (Math.round(0.5 * w) - x0)];
    const spreMargine = mask[(Math.round(0.25 * h) - y0) * mw + (Math.round(0.5 * w) - x0) + 20];
    expect(centru).toBeGreaterThan(0.9);
    expect(spreMargine).toBeLessThan(centru);
  });

  it('selectia se opreste la granita de culoare: cerul da, pielea nu', () => {
    const w = 80, h = 80;
    const d = skyAndSkin(w, h);
    // raza acopera si jumatatea de jos, deci doar culoarea poate separa
    const p = pt({ x: 0.5, y: 0.25, radius: 0.9 });
    const { mask, x0, y0, x1 } = computeControlMask(d, w, h, p);
    const mw = x1 - x0;
    const inCer = mask[(20 - y0) * mw + (40 - x0)];
    const inPiele = mask[(60 - y0) * mw + (40 - x0)];
    expect(inCer).toBeGreaterThan(0.5);
    expect(inPiele).toBeLessThan(0.05);
  });

  it('in afara dreptunghiului masca e zero — de-aia bucla se poate limita la el', () => {
    const w = 200, h = 100;
    const p = pt({ x: 0.5, y: 0.5, radius: 0.1 });
    const b = boundsFor(p, w, h);
    expect(b.x0).toBeGreaterThan(0);
    expect(b.x1).toBeLessThan(w);
    // un pixel din afara: aplicam si verificam ca nu s-a atins
    const d = skyAndSkin(w, h);
    const inainte = d.slice();
    applyControlPoint(d, w, h, pt({ x: 0.5, y: 0.5, radius: 0.1, brightness: 100 }));
    const iDeparte = (10 * w + 5) * 4;
    expect(d[iDeparte]).toBe(inainte[iDeparte]);
    expect(d[iDeparte + 1]).toBe(inainte[iDeparte + 1]);
  });

  it('intunecarea cerului nu atinge pielea de dedesubt', () => {
    const w = 80, h = 80;
    const d = skyAndSkin(w, h);
    const inainte = d.slice();
    applyControlPoint(d, w, h, pt({ x: 0.5, y: 0.25, radius: 0.9, brightness: -80 }));
    const iCer = (20 * w + 40) * 4;
    const iPiele = (60 * w + 40) * 4;
    expect(d[iCer + 2]).toBeLessThan(inainte[iCer + 2] - 20);
    expect(Math.abs(d[iPiele] - inainte[iPiele])).toBeLessThan(4);
  });

  it('un punct neutru nu atinge niciun pixel', () => {
    const w = 40, h = 40;
    const d = skyAndSkin(w, h);
    const inainte = d.slice();
    applyControlPoint(d, w, h, pt({ radius: 1 }));
    expect(Array.from(d)).toEqual(Array.from(inainte));
  });

  it('saturatia locala schimba culoarea, nu luminozitatea medie', () => {
    const w = 60, h = 60;
    const d = skyAndSkin(w, h);
    const i = (15 * w + 30) * 4;
    const lumInainte = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    applyControlPoint(d, w, h, pt({ x: 0.5, y: 0.25, radius: 0.5, saturation: 80 }));
    const lumDupa = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    expect(Math.abs(lumDupa - lumInainte)).toBeLessThan(6);
    // dar canalul dominant s-a departat de luminanta
    expect(d[i + 2] - lumDupa).toBeGreaterThan(220 - lumInainte);
  });

  it('valorile raman in 0..255 chiar la maxim pe toate axele', () => {
    const w = 40, h = 40;
    const d = skyAndSkin(w, h);
    applyControlPoint(d, w, h, pt({ x: 0.5, y: 0.5, radius: 1, brightness: 100, contrast: 100, saturation: 100, structure: 100 }),
      new Float32Array(w * h));
    for (let i = 0; i < d.length; i++) {
      expect(d[i]).toBeGreaterThanOrEqual(0);
      expect(d[i]).toBeLessThanOrEqual(255);
    }
  });
});
