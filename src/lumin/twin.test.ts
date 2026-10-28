import { describe, expect, it } from 'vitest';
import { twinFrom, type TwinEntry } from './twin';
import { formatBytes, freedSummary, recordFreed } from '../core/freedSpace';

const log = (n: number, sameEvery: number, start = 0): TwinEntry[] =>
  Array.from({ length: n }, (_, i) => ({ t: start + i, same: i % sameEvery !== 0 }));

describe('twin', () => {
  it('says it is still learning with too few decisions', () => {
    expect(twinFrom(log(5, 2)).percent).toBeNull();
    expect(twinFrom(log(5, 2)).level).toBe('learning');
  });
  it('falls back to the taste test pairs', () => {
    expect(twinFrom([], { hits: 7, total: 10 }).percent).toBe(70);
  });
  it('measures recent agreement and the trend', () => {
    const old = Array.from({ length: 120 }, (_, i) => ({ t: i, same: i % 2 === 0 }));
    const recent = Array.from({ length: 120 }, (_, i) => ({ t: 200 + i, same: i % 10 !== 0 }));
    const s = twinFrom([...old, ...recent]);
    expect(s.percent).toBe(90);
    expect(s.level).toBe('twin');
    expect(s.trend).toBeGreaterThan(30);
  });
});

describe('freed space', () => {
  it('adds up per month and formats', () => {
    const at = new Date(2026, 9, 10).getTime();
    recordFreed(1.5e9, at);
    recordFreed(0.5e9, at);
    recordFreed(-5, at);
    expect(freedSummary(at).month).toBe(2e9);
    expect(formatBytes(2.4e9, 'ro')).toBe('2,4 GB');
    expect(formatBytes(350e6, 'en')).toBe('350 MB');
  });
});
