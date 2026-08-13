import { describe, it, expect } from 'vitest';
import { selectSortQueue, selectScopedQueue, countSeriesSiblings } from './tiktokSort';
import type { PhotoView } from './store';

function photo(id: string, opts: Partial<PhotoView> = {}): PhotoView {
  return {
    id, fileName: `${id}.jpg`, importedAt: 0, status: 'pending', rating: 0, aiScore: 50,
    sceneType: 'detail', contextKey: '', faceCount: 0, knownFaceCount: 0, strangerCount: 0,
    bestSmile: 0, allEyesOpen: true, sharpness: 0, exposure: 0, ruleOfThirds: 0, headroom: 0,
    aiFactors: [], personNames: [], personMatches: [], capturedAt: undefined,
    ...opts
  };
}

describe('selectSortQueue', () => {
  it('includes pending and review photos, excludes selected/rejected', () => {
    const photos = [
      photo('a', { status: 'pending' }),
      photo('b', { status: 'review' }),
      photo('c', { status: 'selected' }),
      photo('d', { status: 'rejected' })
    ];
    expect(selectSortQueue(photos).map(p => p.id)).toEqual(['a', 'b']);
  });

  it('sorts by capturedAt ascending, undated photos first (treated as 0)', () => {
    const photos = [
      photo('newer', { capturedAt: 2000 }),
      photo('undated', { capturedAt: undefined }),
      photo('older', { capturedAt: 1000 })
    ];
    expect(selectSortQueue(photos).map(p => p.id)).toEqual(['undated', 'older', 'newer']);
  });

  it('returns an empty array when nothing is pending/review', () => {
    expect(selectSortQueue([photo('a', { status: 'selected' })])).toEqual([]);
  });
});

describe('selectScopedQueue', () => {
  // Bug real raportat de utilizator: "Verifica deciziile la limita" arata "Totul
  // sortat!" — pozele cerute erau deja decise automat, iar apelantul le filtra
  // prin selectSortQueue (care tine doar nedecisele), deci nu ramanea niciuna.
  it('keeps photos the undecided queue would drop (selected/rejected)', () => {
    const photos = [
      photo('a', { status: 'selected' }),
      photo('b', { status: 'rejected' }),
      photo('c', { status: 'pending' })
    ];
    expect(selectSortQueue(photos).map(p => p.id)).toEqual(['c']);
    expect(selectScopedQueue(photos, ['a', 'b']).map(p => p.id)).toEqual(['a', 'b']);
  });

  it('preserves the order it was given, not capture order', () => {
    const photos = [
      photo('old', { capturedAt: 1000, status: 'selected' }),
      photo('new', { capturedAt: 2000, status: 'selected' })
    ];
    expect(selectScopedQueue(photos, ['new', 'old']).map(p => p.id)).toEqual(['new', 'old']);
  });

  it('skips ids that no longer exist instead of leaving a gap', () => {
    const photos = [photo('a', { status: 'selected' })];
    expect(selectScopedQueue(photos, ['a', 'deleted']).map(p => p.id)).toEqual(['a']);
  });
});

describe('countSeriesSiblings', () => {
  it('returns 0 for a photo without a groupId', () => {
    const photos = [photo('a')];
    expect(countSeriesSiblings(photos, photos[0])).toBe(0);
  });

  it('counts all members sharing the same groupId, including the photo itself', () => {
    const photos = [
      photo('a', { groupId: 'g1' }),
      photo('b', { groupId: 'g1' }),
      photo('c', { groupId: 'g1' }),
      photo('d', { groupId: 'g2' })
    ];
    expect(countSeriesSiblings(photos, photos[0])).toBe(3);
  });
});
