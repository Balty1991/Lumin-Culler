import { describe, it, expect } from 'vitest';
import { computeWorkerCount } from './workerPool';

describe('computeWorkerCount', () => {
  it('caps at 4 when deviceMemory is unknown (Firefox/Safari)', () => {
    expect(computeWorkerCount(8, undefined)).toBe(4);
    expect(computeWorkerCount(2, undefined)).toBe(1);
  });

  it('forces a single worker on low-RAM devices (<=4GB), matching the proven Honor 8X fix', () => {
    expect(computeWorkerCount(8, 4)).toBe(1);
    expect(computeWorkerCount(8, 2)).toBe(1);
  });

  it('keeps the old 4-worker cap on mid-range RAM (6GB)', () => {
    expect(computeWorkerCount(8, 6)).toBe(4);
    expect(computeWorkerCount(2, 6)).toBe(1);
  });

  it('allows up to 6 workers on high-RAM devices (8GB+)', () => {
    expect(computeWorkerCount(8, 8)).toBe(6);
    expect(computeWorkerCount(16, 16)).toBe(6);
  });

  it('never exceeds the core budget (cores - 1), regardless of RAM', () => {
    expect(computeWorkerCount(3, 8)).toBe(2);
    expect(computeWorkerCount(1, 8)).toBe(1);
  });
});
