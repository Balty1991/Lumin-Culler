import { describe, it, expect } from 'vitest';
import { faceSharperThanFrame } from './faceFocus';

function frame(w: number, h: number, sharpBox?: [number, number, number, number]): Float32Array {
  const g = new Float32Array(w * h).fill(128);
  // Fundal neted; în casetă, un model în șah (detalii fine = claritate).
  if (sharpBox) {
    const [x0, y0, bw, bh] = sharpBox.map((v, i) => Math.round(v * (i % 2 ? h : w)));
    for (let y = y0; y < y0 + bh; y++) for (let x = x0; x < x0 + bw; x++) g[y * w + x] = (x + y) % 2 ? 200 : 60;
  }
  return g;
}

describe('faceSharperThanFrame', () => {
  it('portret cu fundal estompat: fața e în focus', () => {
    expect(faceSharperThanFrame(frame(100, 100, [0.3, 0.2, 0.4, 0.4]), 100, 100, [0.3, 0.2, 0.4, 0.4])).toBe(true);
  });
  it('poză neclară peste tot: nu', () => {
    expect(faceSharperThanFrame(frame(100, 100), 100, 100, [0.3, 0.2, 0.4, 0.4])).toBe(false);
  });
});
