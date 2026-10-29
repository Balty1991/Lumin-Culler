import { describe, it, expect } from 'vitest';
import { applyDetailPass } from './imageAdjust';

/** O poză 40x20: jumătatea stângă întunecată (umbră), dreapta aproape albă (cer ars). */
function split(dark: number, bright: number): Uint8ClampedArray {
  const w = 40, h = 20, d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4, v = x < w / 2 ? dark : bright;
    d[i] = v; d[i + 1] = v; d[i + 2] = v; d[i + 3] = 255;
  }
  return d;
}

describe('echilibrul local al luminii (toneMap)', () => {
  it('deschide umbrele și lasă cerul ars luminos', () => {
    const d = split(30, 250);
    applyDetailPass(d, 40, 20, { toneMap: 70 } as never);
    expect(d[(10 * 40 + 2) * 4]).toBeGreaterThan(45);
    expect(d[(10 * 40 + 37) * 4]).toBeGreaterThan(235);
  });

  it('lasă tonurile medii aproape neatinse', () => {
    const d = split(128, 128);
    applyDetailPass(d, 40, 20, { toneMap: 70 } as never);
    expect(Math.abs(d[(10 * 40 + 5) * 4] - 128)).toBeLessThan(8);
  });

  it('la 0 nu schimbă nimic', () => {
    const d = split(30, 250);
    const before = d.slice();
    applyDetailPass(d, 40, 20, { toneMap: 0 } as never);
    expect([...d]).toEqual([...before]);
  });
});
