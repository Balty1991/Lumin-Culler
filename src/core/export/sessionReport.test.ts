import { describe, expect, it } from 'vitest';
import { buildSessionReportText } from './sessionReport';
import type { LibraryStats } from '../stats';

function stats(overrides: Partial<LibraryStats>): LibraryStats {
  return {
    total: 10, selected: 4, rejected: 3, review: 3, pending: 0,
    ratingCounts: [0, 0, 0, 0, 0, 0], seriesCount: 0, avgAiScore: 55,
    ...overrides
  };
}

describe('buildSessionReportText', () => {
  it('includes project name, totals, percentages and average score', () => {
    const text = buildSessionReportText({
      stats: stats({}),
      projectName: 'Nunta Ana & Mihai',
      earliestImportedAt: null,
      generatedAt: Date.now()
    });
    expect(text).toContain('Proiect: Nunta Ana & Mihai');
    expect(text).toContain('Poze totale: 10');
    expect(text).toContain('Selectate: 4 (40%)');
    expect(text).toContain('De verificat: 3 (30%)');
    expect(text).toContain('Respinse: 3 (30%)');
    expect(text).toContain('Scor AI mediu: 55');
  });

  it('falls back to a placeholder when no project name is set', () => {
    const text = buildSessionReportText({
      stats: stats({}), projectName: '', earliestImportedAt: null, generatedAt: Date.now()
    });
    expect(text).toContain('Proiect: (fara nume)');
  });

  it('omits the pending line when there are no undecided photos', () => {
    const text = buildSessionReportText({
      stats: stats({ pending: 0 }), projectName: 'X', earliestImportedAt: null, generatedAt: Date.now()
    });
    expect(text).not.toContain('Nedecise');
  });

  it('includes the pending line and percentage when some photos are undecided', () => {
    const text = buildSessionReportText({
      stats: stats({ total: 10, selected: 2, rejected: 2, review: 2, pending: 4 }),
      projectName: 'X', earliestImportedAt: null, generatedAt: Date.now()
    });
    expect(text).toContain('Nedecise: 4 (40%)');
  });

  it('formats the session span in minutes for short sessions', () => {
    const generatedAt = Date.UTC(2026, 0, 1, 12, 45);
    const earliestImportedAt = Date.UTC(2026, 0, 1, 12, 0);
    const text = buildSessionReportText({ stats: stats({}), projectName: 'X', earliestImportedAt, generatedAt });
    expect(text).toContain('Durata de la primul import: 45m');
  });

  it('formats the session span in hours+minutes for multi-hour sessions', () => {
    const generatedAt = Date.UTC(2026, 0, 1, 14, 15);
    const earliestImportedAt = Date.UTC(2026, 0, 1, 12, 0);
    const text = buildSessionReportText({ stats: stats({}), projectName: 'X', earliestImportedAt, generatedAt });
    expect(text).toContain('Durata de la primul import: 2h 15m');
  });

  it('formats the session span in days+hours for multi-day sessions', () => {
    const generatedAt = Date.UTC(2026, 0, 4, 16, 0);
    const earliestImportedAt = Date.UTC(2026, 0, 1, 12, 0);
    const text = buildSessionReportText({ stats: stats({}), projectName: 'X', earliestImportedAt, generatedAt });
    expect(text).toContain('Durata de la primul import: 3z 4h');
  });

  it('omits the session-start section entirely when earliestImportedAt is null', () => {
    const text = buildSessionReportText({
      stats: stats({}), projectName: 'X', earliestImportedAt: null, generatedAt: Date.now()
    });
    expect(text).not.toContain('Sesiune incepusa');
    expect(text).not.toContain('Durata de la primul import');
  });

  it('includes the series count only when greater than zero', () => {
    const withSeries = buildSessionReportText({
      stats: stats({ seriesCount: 5 }), projectName: 'X', earliestImportedAt: null, generatedAt: Date.now()
    });
    expect(withSeries).toContain('Serii/duplicate: 5');
    const withoutSeries = buildSessionReportText({
      stats: stats({ seriesCount: 0 }), projectName: 'X', earliestImportedAt: null, generatedAt: Date.now()
    });
    expect(withoutSeries).not.toContain('Serii/duplicate');
  });
});
