import { beforeEach, describe, expect, it, vi } from 'vitest';
import { recordUsage, readMonthlyUsage } from './usage';

beforeEach(() => {
  localStorage.clear();
  vi.useRealTimers();
});

describe('readMonthlyUsage', () => {
  it('starts at 0 when nothing was recorded yet', () => {
    expect(readMonthlyUsage()).toBe(0);
  });
});

describe('recordUsage', () => {
  it('accumulates across calls within the same month', () => {
    expect(recordUsage(10)).toBe(10);
    expect(recordUsage(5)).toBe(15);
    expect(readMonthlyUsage()).toBe(15);
  });

  it('ignores non-positive counts without touching the stored total', () => {
    recordUsage(10);
    expect(recordUsage(0)).toBe(10);
    expect(recordUsage(-3)).toBe(10);
  });

  it('resets the counter when the calendar month changes', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-15T12:00:00Z'));
    recordUsage(20);
    expect(readMonthlyUsage()).toBe(20);

    vi.setSystemTime(new Date('2026-02-01T00:00:01Z'));
    expect(readMonthlyUsage()).toBe(0);
    expect(recordUsage(5)).toBe(5);
    vi.useRealTimers();
  });

  it('recovers gracefully from corrupted stored JSON instead of throwing', () => {
    localStorage.setItem('lumin-usage-monthly', 'not json{{');
    expect(readMonthlyUsage()).toBe(0);
    expect(recordUsage(3)).toBe(3);
  });
});
