import { describe, it, expect } from 'vitest';
import {
  computeNextPeriod, SUPERVISOR_PERIOD_MS, periodMonthsToMs, listAllPeriods, isPeriodAlreadyCovered,
  isSupervisorBannerDismissedToday
} from './gallerySupervisor';

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

describe('periodMonthsToMs', () => {
  it('scales linearly with the chosen number of months', () => {
    expect(periodMonthsToMs(1) * 2).toBe(periodMonthsToMs(2));
    expect(periodMonthsToMs(2)).toBe(SUPERVISOR_PERIOD_MS);
    expect(periodMonthsToMs(3) > periodMonthsToMs(2)).toBe(true);
  });
});

describe('listAllPeriods', () => {
  it('covers the whole span from earliest to now in fixed-size chunks', () => {
    const earliestMs = 0;
    const periodMs = 30 * DAY;
    const nowMs = periodMs * 3 + 5 * DAY; // 3 perioade intregi + o bucata partiala
    const periods = listAllPeriods({ earliestMs, nowMs, coveredUntilMs: null, periodMs });
    expect(periods).toHaveLength(4);
    expect(periods[0]).toEqual({ start: 0, end: periodMs, covered: false });
    expect(periods[periods.length - 1].end).toBe(nowMs);
  });

  it('marks periods entirely before the cursor as covered', () => {
    const earliestMs = 0;
    const periodMs = 30 * DAY;
    const coveredUntilMs = periodMs * 2;
    const nowMs = periodMs * 4;
    const periods = listAllPeriods({ earliestMs, nowMs, coveredUntilMs, periodMs });
    expect(periods.map(p => p.covered)).toEqual([true, true, false, false]);
  });

  it('returns an empty list when the gallery has no span to cover', () => {
    expect(listAllPeriods({ earliestMs: 1000, nowMs: 1000, coveredUntilMs: null, periodMs: DAY })).toEqual([]);
    expect(listAllPeriods({ earliestMs: 2000, nowMs: 1000, coveredUntilMs: null, periodMs: DAY })).toEqual([]);
  });
});

describe('isPeriodAlreadyCovered', () => {
  it('is false when nothing was ever covered', () => {
    expect(isPeriodAlreadyCovered({ start: 0, end: 1000 }, null)).toBe(false);
  });
  it('is true when the period starts before the cursor', () => {
    expect(isPeriodAlreadyCovered({ start: 0, end: 1000 }, 500)).toBe(true);
  });
  it('is false when the period starts at or after the cursor', () => {
    expect(isPeriodAlreadyCovered({ start: 1000, end: 2000 }, 1000)).toBe(false);
  });
});

describe('isSupervisorBannerDismissedToday', () => {
  it('is false when never dismissed', () => {
    expect(isSupervisorBannerDismissedToday(null)).toBe(false);
  });
  it('is true for the same day it was dismissed', () => {
    const now = new Date(2026, 2, 15, 10, 0, 0);
    expect(isSupervisorBannerDismissedToday(`${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`, now)).toBe(true);
  });
  it('is false once the day has changed', () => {
    const dismissedOn = new Date(2026, 2, 15);
    const nextDay = new Date(2026, 2, 16);
    expect(isSupervisorBannerDismissedToday(`${dismissedOn.getFullYear()}-${dismissedOn.getMonth()}-${dismissedOn.getDate()}`, nextDay)).toBe(false);
  });
});
