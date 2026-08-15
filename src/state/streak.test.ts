import { describe, it, expect } from 'vitest';
import { computeImportStreak, recordImportDay } from './streak';
import type { PhotoView } from './store';

function photo(id: string, importedAt: number): PhotoView {
  return {
    id, fileName: `${id}.jpg`, importedAt, status: 'pending', rating: 0, aiScore: 50,
    sceneType: 'detail', contextKey: '', faceCount: 0, knownFaceCount: 0, strangerCount: 0,
    bestSmile: 0, allEyesOpen: true, sharpness: 0, exposure: 0, ruleOfThirds: 0, headroom: 0,
    aiFactors: [], personNames: [], personMatches: []
  };
}

describe('computeImportStreak', () => {
  it('returns 0 for an empty library', () => {
    expect(computeImportStreak([], new Date(2026, 7, 11))).toBe(0);
  });

  it('counts a single day with imports today as a streak of 1', () => {
    const now = new Date(2026, 7, 11, 14, 0);
    const photos = [photo('a', new Date(2026, 7, 11, 9, 0).getTime())];
    expect(computeImportStreak(photos, now)).toBe(1);
  });

  it('counts consecutive days ending today', () => {
    const now = new Date(2026, 7, 11, 14, 0);
    const photos = [
      photo('a', new Date(2026, 7, 11).getTime()),
      photo('b', new Date(2026, 7, 10).getTime()),
      photo('c', new Date(2026, 7, 9).getTime())
    ];
    expect(computeImportStreak(photos, now)).toBe(3);
  });

  it('still counts the streak if today has no imports yet, anchored on yesterday', () => {
    const now = new Date(2026, 7, 11, 8, 0);
    const photos = [
      photo('a', new Date(2026, 7, 10).getTime()),
      photo('b', new Date(2026, 7, 9).getTime())
    ];
    expect(computeImportStreak(photos, now)).toBe(2);
  });

  it('stops at a gap day', () => {
    const now = new Date(2026, 7, 11);
    const photos = [
      photo('a', new Date(2026, 7, 11).getTime()),
      photo('b', new Date(2026, 7, 9).getTime()) // gap on the 10th
    ];
    expect(computeImportStreak(photos, now)).toBe(1);
  });

  it('returns 0 when the most recent import is more than a day old', () => {
    const now = new Date(2026, 7, 11);
    const photos = [photo('a', new Date(2026, 7, 8).getTime())];
    expect(computeImportStreak(photos, now)).toBe(0);
  });

  it('multiple photos on the same day only count once', () => {
    const now = new Date(2026, 7, 11);
    const photos = [
      photo('a', new Date(2026, 7, 11, 9, 0).getTime()),
      photo('b', new Date(2026, 7, 11, 18, 0).getTime())
    ];
    expect(computeImportStreak(photos, now)).toBe(1);
  });

  /**
   * Bug real raportat de utilizator: "nu a mai aparut acel 2 zile la rand".
   * Seria se calcula doar din pozele aflate ACUM in biblioteca, deci "Goleste
   * sesiunea" sau stergerea respinselor rescriau retroactiv zilele in care chiar
   * importase. Jurnalul de zile (localStorage) tine minte independent de poze.
   */
  it('keeps the streak after the photos themselves are gone', () => {
    localStorage.clear();
    const now = new Date(2026, 7, 15, 9, 0);
    recordImportDay(new Date(2026, 7, 14, 22, 0));
    recordImportDay(now);
    expect(computeImportStreak([], now)).toBe(2);
  });

  it('records a day only once, however many imports it holds', () => {
    localStorage.clear();
    const now = new Date(2026, 7, 15, 9, 0);
    recordImportDay(now);
    recordImportDay(new Date(2026, 7, 15, 18, 0));
    expect(localStorage.getItem('lumin-import-days')).toBe(JSON.stringify(['2026-7-15']));
    expect(computeImportStreak([], now)).toBe(1);
  });

  it('merges the journal with days read from photos already in the library', () => {
    localStorage.clear();
    const now = new Date(2026, 7, 15, 9, 0);
    recordImportDay(now);
    // poza importata ieri, dinainte ca jurnalul sa existe
    const yesterday = new Date(2026, 7, 14, 12, 0).getTime();
    expect(computeImportStreak([photo('a', yesterday)], now)).toBe(2);
  });
});
