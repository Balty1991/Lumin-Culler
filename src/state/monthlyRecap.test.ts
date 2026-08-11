import { describe, it, expect } from 'vitest';
import { selectMonthlyRecap } from './monthlyRecap';
import type { PhotoView } from './store';

function photo(id: string, capturedAt: number | undefined, aiScore: number, status: PhotoView['status'] = 'selected'): PhotoView {
  return {
    id, fileName: `${id}.jpg`, importedAt: 0, status, rating: 0, aiScore,
    sceneType: 'detail', contextKey: '', faceCount: 0, knownFaceCount: 0, strangerCount: 0,
    bestSmile: 0, allEyesOpen: true, sharpness: 0, exposure: 0, ruleOfThirds: 0, headroom: 0,
    aiFactors: [], personNames: [], personMatches: [], capturedAt
  };
}

const DAY = 24 * 60 * 60 * 1000;

describe('selectMonthlyRecap', () => {
  it('keeps only photos from the last 30 days, sorted by AI score descending', () => {
    const now = new Date(2026, 5, 15).getTime();
    const photos = [
      photo('old', now - 40 * DAY, 90),
      photo('a', now - 5 * DAY, 70),
      photo('b', now - 2 * DAY, 95)
    ];
    const recap = selectMonthlyRecap(photos, new Date(now));
    expect(recap.map(p => p.id)).toEqual(['b', 'a']);
  });

  it('excludes rejected photos even if recent and high-scoring', () => {
    const now = new Date(2026, 5, 15).getTime();
    const photos = [photo('a', now - 1 * DAY, 99, 'rejected'), photo('b', now - 1 * DAY, 50, 'selected')];
    const recap = selectMonthlyRecap(photos, new Date(now));
    expect(recap.map(p => p.id)).toEqual(['b']);
  });

  it('excludes photos without a capture date', () => {
    const now = new Date(2026, 5, 15).getTime();
    const photos = [photo('a', undefined, 90)];
    expect(selectMonthlyRecap(photos, new Date(now))).toEqual([]);
  });

  it('caps the result at maxCount', () => {
    const now = new Date(2026, 5, 15).getTime();
    const photos = Array.from({ length: 10 }, (_, i) => photo(`p${i}`, now - i * DAY, 50 + i));
    expect(selectMonthlyRecap(photos, new Date(now), 3)).toHaveLength(3);
  });

  it('returns an empty array for an empty library', () => {
    expect(selectMonthlyRecap([], new Date())).toEqual([]);
  });
});
