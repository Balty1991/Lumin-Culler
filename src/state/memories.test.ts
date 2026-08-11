import { describe, it, expect } from 'vitest';
import { findMemories, isMemoryDismissedToday, type MemoryGroup } from './memories';
import type { PhotoView } from './store';

function photo(id: string, capturedAt: number | undefined): PhotoView {
  return {
    id, fileName: `${id}.jpg`, importedAt: 0, status: 'pending', rating: 0, aiScore: 50,
    sceneType: 'detail', contextKey: '', faceCount: 0, knownFaceCount: 0, strangerCount: 0,
    bestSmile: 0, allEyesOpen: true, sharpness: 0, exposure: 0, ruleOfThirds: 0, headroom: 0,
    aiFactors: [], personNames: [], personMatches: [], capturedAt
  };
}

describe('findMemories', () => {
  it('groups photos captured on the same month/day in a previous year', () => {
    const now = new Date(2026, 7, 9); // 9 august 2026
    const photos = [
      photo('a', new Date(2023, 7, 9).getTime()),
      photo('b', new Date(2023, 7, 9).getTime()),
      photo('c', new Date(2022, 7, 9).getTime())
    ];
    const groups = findMemories(photos, now);
    expect(groups).toEqual<MemoryGroup[]>([
      { year: 2023, yearsAgo: 3, photos: [photos[0], photos[1]] },
      { year: 2022, yearsAgo: 4, photos: [photos[2]] }
    ]);
  });

  it('ignores photos from a different day', () => {
    const now = new Date(2026, 7, 9);
    const photos = [photo('a', new Date(2023, 7, 10).getTime())];
    expect(findMemories(photos, now)).toEqual([]);
  });

  it('ignores photos without capturedAt', () => {
    const now = new Date(2026, 7, 9);
    const photos = [photo('a', undefined)];
    expect(findMemories(photos, now)).toEqual([]);
  });

  it('ignores photos captured this year or in the future', () => {
    const now = new Date(2026, 7, 9);
    const photos = [photo('a', new Date(2026, 7, 9).getTime()), photo('b', new Date(2027, 7, 9).getTime())];
    expect(findMemories(photos, now)).toEqual([]);
  });

  it('handles a leap-day capture only matching a leap-day "now"', () => {
    const leapCapture = new Date(2024, 1, 29).getTime();
    const photos = [photo('a', leapCapture)];
    expect(findMemories(photos, new Date(2026, 1, 28))).toEqual([]);
    expect(findMemories(photos, new Date(2028, 1, 29))).toEqual([
      { year: 2024, yearsAgo: 4, photos: [photos[0]] }
    ]);
  });

  it('returns an empty array for an empty library', () => {
    expect(findMemories([], new Date(2026, 7, 9))).toEqual([]);
  });
});

describe('isMemoryDismissedToday', () => {
  it('is false when nothing was dismissed', () => {
    expect(isMemoryDismissedToday(null, new Date(2026, 7, 9))).toBe(false);
  });

  it('is true when dismissed the same day', () => {
    const now = new Date(2026, 7, 9);
    expect(isMemoryDismissedToday(`${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`, now)).toBe(true);
  });

  it('is false when dismissed on a different day', () => {
    const dismissedYesterday = '2026-7-8';
    expect(isMemoryDismissedToday(dismissedYesterday, new Date(2026, 7, 9))).toBe(false);
  });
});
