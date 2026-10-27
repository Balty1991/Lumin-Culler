import { describe, expect, it } from 'vitest';
import { dayStats, startOfDay } from './todayDigest';

describe('dayStats', () => {
  const now = new Date(2026, 9, 27, 21, 0, 0).getTime();
  const today = startOfDay(now) + 3_600_000;
  const yesterday = startOfDay(now) - 3_600_000;

  it('numără doar pozele de azi, fără documente', () => {
    const s = dayStats([
      { id: 'a', capturedAt: today, status: 'selected' },
      { id: 'b', capturedAt: today, status: 'rejected' },
      { id: 'c', capturedAt: today, status: 'review' },
      { id: 'd', capturedAt: today, status: 'review', aside: 'document' },
      { id: 'e', capturedAt: yesterday, status: 'selected' },
      { id: 'f', status: 'selected' }
    ], now);
    expect(s).toEqual({ total: 3, kept: 1, rejected: 1, reviewIds: ['c'], keptIds: ['a'] });
  });
});
