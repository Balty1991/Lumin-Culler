import { describe, expect, it } from 'vitest';
import { scoreMatrix } from './clipSearch';

describe('scoreMatrix', () => {
  it('ia scorul cel mai bun dintre texte, pe fiecare poză', () => {
    const m = new Float32Array(2 * 512);
    m[0] = 1; m[512 + 1] = 1;
    const a = new Float32Array(512); a[0] = 0.3;
    const b = new Float32Array(512); b[1] = 0.5;
    const s = scoreMatrix(m, 2, [a, b]);
    expect(s[0]).toBeCloseTo(0.3);
    expect(s[1]).toBeCloseTo(0.5);
  });
});
