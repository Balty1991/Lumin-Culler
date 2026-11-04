import { describe, it, expect } from 'vitest';
import { project } from './clipSearch';

describe('clipSearch.project', () => {
  it('aplică stratul Dense și normalizează', () => {
    const w = new Float32Array([1, 0, 0, 0, 2, 0]); // 2×3
    const e = project([3, 4, 5], { w, out: 2, inp: 3 });
    expect(e[0]).toBeCloseTo(3 / Math.hypot(3, 8));
    expect(e[1]).toBeCloseTo(8 / Math.hypot(3, 8));
  });
});
