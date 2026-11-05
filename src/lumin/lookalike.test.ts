import { describe, it, expect } from 'vitest';
import { shares } from './lookalike';

describe('shares', () => {
  it('împarte 100% după asemănare, mai mult celui mai asemănător', () => {
    const p = shares([0.6, 0.5]);
    expect(p[0] + p[1]).toBe(100);
    expect(p[0]).toBeGreaterThan(p[1]);
  });
  it('egal când asemănarea e egală', () => {
    expect(shares([0.4, 0.4])).toEqual([50, 50]);
  });
  it('trei oameni tot 100', () => {
    expect(shares([0.3, 0.35, 0.2]).reduce((a, b) => a + b, 0)).toBe(100);
  });
});
