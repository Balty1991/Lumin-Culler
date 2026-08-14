import { describe, it, expect, beforeEach } from 'vitest';
import {
  computeNextPeriod, computeRemainingPeriod, SUPERVISOR_PERIOD_MS, periodMonthsToMs, listAllPeriods,
  isPeriodAlreadyCovered, isSupervisorBannerDismissedToday, computeGalleryCoveragePercent,
  readImportedFolderIds, writeImportedFolderIds, readCoveredUntil, writeCoveredUntil
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

describe('computeRemainingPeriod', () => {
  it('spans from the earliest photo to now when nothing was covered yet', () => {
    const earliestMs = 1_000_000;
    const nowMs = earliestMs + 365 * DAY;
    const period = computeRemainingPeriod({ earliestMs, nowMs, coveredUntilMs: null });
    expect(period).toEqual({ start: earliestMs, end: nowMs });
  });

  it('spans from the cursor to now, in one single period', () => {
    const earliestMs = 1_000_000;
    const coveredUntilMs = earliestMs + 40 * DAY;
    const nowMs = coveredUntilMs + 300 * DAY;
    const period = computeRemainingPeriod({ earliestMs, nowMs, coveredUntilMs });
    expect(period).toEqual({ start: coveredUntilMs, end: nowMs });
  });

  it('returns null once fully caught up', () => {
    const nowMs = 1_000_000;
    expect(computeRemainingPeriod({ earliestMs: 0, nowMs, coveredUntilMs: nowMs })).toBeNull();
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

describe('computeGalleryCoveragePercent', () => {
  it('is 0 when nothing was ever covered', () => {
    const earliestMs = 1_000_000;
    const nowMs = earliestMs + 100 * DAY;
    expect(computeGalleryCoveragePercent({ earliestMs, nowMs, coveredUntilMs: null })).toBe(0);
  });

  it('is 50 when the cursor has reached the midpoint of the gallery span', () => {
    const earliestMs = 0;
    const nowMs = 100 * DAY;
    const coveredUntilMs = 50 * DAY;
    expect(computeGalleryCoveragePercent({ earliestMs, nowMs, coveredUntilMs })).toBe(50);
  });

  it('is 100 once the cursor reaches or passes now', () => {
    const earliestMs = 0;
    const nowMs = 100 * DAY;
    expect(computeGalleryCoveragePercent({ earliestMs, nowMs, coveredUntilMs: nowMs })).toBe(100);
    expect(computeGalleryCoveragePercent({ earliestMs, nowMs, coveredUntilMs: nowMs + 500 * DAY })).toBe(100);
  });

  it('is 100 when the gallery has no span to cover', () => {
    expect(computeGalleryCoveragePercent({ earliestMs: 1000, nowMs: 1000, coveredUntilMs: null })).toBe(100);
    expect(computeGalleryCoveragePercent({ earliestMs: 2000, nowMs: 1000, coveredUntilMs: null })).toBe(100);
  });
});

describe('readImportedFolderIds / writeImportedFolderIds', () => {
  beforeEach(() => localStorage.clear());

  it('is empty when nothing was ever written', () => {
    expect(readImportedFolderIds()).toEqual(new Set());
  });

  it('round-trips a set of folder ids through localStorage', () => {
    writeImportedFolderIds(new Set(['folder-a', 'folder-b']));
    expect(readImportedFolderIds()).toEqual(new Set(['folder-a', 'folder-b']));
  });

  it('ignores corrupted storage content', () => {
    localStorage.setItem('lumin-gallery-supervisor-imported-folders', '{not valid json');
    expect(readImportedFolderIds()).toEqual(new Set());
  });
});

/**
 * Bug real gasit de auditul QA — vezi readFiniteNumber in gallerySupervisor.ts.
 * Dintre toate citirile numerice din localStorage, aici NaN-ul se vedea cel mai
 * tare: intra direct in computeNextPeriod, care intorcea { start: NaN, end: NaN },
 * deci supervizorul cerea galeriei telefonului pozele dintr-un interval
 * inexistent, iar cardul de acoperire de pe Acasa afisa NaN%.
 */
describe('gallerySupervisor — cursor corupt in localStorage', () => {
  beforeEach(() => localStorage.clear());

  it('trateaza un cursor ne-numeric drept absent, nu drept NaN', () => {
    localStorage.setItem('lumin-gallery-supervisor-covered-until', 'nu-e-numar');
    expect(readCoveredUntil()).toBeNull();
  });

  it('perioada urmatoare ramane un interval REAL dupa un cursor corupt (inainte: start/end NaN)', () => {
    localStorage.setItem('lumin-gallery-supervisor-covered-until', 'stricat');
    const nowMs = Date.UTC(2026, 0, 15);
    const earliestMs = nowMs - 365 * DAY;
    const period = computeNextPeriod({ earliestMs, nowMs, coveredUntilMs: readCoveredUntil() })!;
    expect(Number.isFinite(period.start)).toBe(true);
    expect(Number.isFinite(period.end)).toBe(true);
    expect(period.start).toBe(earliestMs);
  });

  it('procentul de acoperire ramane un numar dupa un cursor corupt (inainte: NaN%)', () => {
    localStorage.setItem('lumin-gallery-supervisor-covered-until', '{}');
    const nowMs = Date.UTC(2026, 0, 15);
    const percent = computeGalleryCoveragePercent({
      earliestMs: nowMs - 100 * DAY, nowMs, coveredUntilMs: readCoveredUntil()
    });
    expect(Number.isFinite(percent)).toBe(true);
    expect(percent).toBe(0);
  });

  it('un cursor VALID (inclusiv scris prin writeCoveredUntil) se citeste neschimbat', () => {
    const ts = Date.UTC(2026, 0, 1);
    writeCoveredUntil(ts);
    expect(readCoveredUntil()).toBe(ts);
  });
});
