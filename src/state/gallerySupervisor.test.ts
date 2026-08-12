import { describe, it, expect } from 'vitest';
import { computeNextPeriod, SUPERVISOR_PERIOD_MS } from './gallerySupervisor';

const DAY = 24 * 60 * 60 * 1000;

describe('computeNextPeriod', () => {
  it('starts at the earliest photo when nothing was covered yet', () => {
    const earliestMs = 1_000_000;
    const nowMs = earliestMs + 365 * DAY;
    const period = computeNextPeriod({ earliestMs, nowMs, coveredUntilMs: null });
    expect(period?.start).toBe(earliestMs);
    expect(period?.end).toBe(earliestMs + SUPERVISOR_PERIOD_MS);
  });

  it('continues from the covered boundary, not from the earliest photo again', () => {
    const earliestMs = 1_000_000;
    const coveredUntilMs = earliestMs + SUPERVISOR_PERIOD_MS;
    const nowMs = coveredUntilMs + 365 * DAY;
    const period = computeNextPeriod({ earliestMs, nowMs, coveredUntilMs });
    expect(period?.start).toBe(coveredUntilMs);
    expect(period?.end).toBe(coveredUntilMs + SUPERVISOR_PERIOD_MS);
  });

  it('clamps the period end to now, never recommending future dates', () => {
    const earliestMs = 1_000_000;
    const nowMs = earliestMs + 10 * DAY; // mult sub o perioada intreaga
    const period = computeNextPeriod({ earliestMs, nowMs, coveredUntilMs: null });
    expect(period?.end).toBe(nowMs);
  });

  it('returns null once fully caught up to now', () => {
    const earliestMs = 1_000_000;
    const nowMs = earliestMs + 5 * DAY;
    const period = computeNextPeriod({ earliestMs, nowMs, coveredUntilMs: nowMs });
    expect(period).toBeNull();
  });

  it('never goes backwards even if coveredUntilMs predates the earliest photo', () => {
    const earliestMs = 5_000_000;
    const nowMs = earliestMs + 365 * DAY;
    const period = computeNextPeriod({ earliestMs, nowMs, coveredUntilMs: 1000 });
    expect(period?.start).toBe(earliestMs);
  });
});
