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

describe('selectSortQueue: seriile trec in fata', () => {
  const t = (min: number) => Date.parse('2026-08-26T10:00:00Z') + min * 60_000;

  it('o serie vine inaintea pozelor singure, chiar daca e mai noua', () => {
    // Motivul e aritmetic: seria se rezolva cu O atingere si scoate trei poze
    // din coada; poza singura cere o decizie si scoate una.
    const queue = selectSortQueue([
      photo('singura-veche', { capturedAt: t(0) }),
      photo('s1', { capturedAt: t(50), groupId: 'g' }),
      photo('s2', { capturedAt: t(51), groupId: 'g' }),
      photo('s3', { capturedAt: t(52), groupId: 'g' }),
      photo('singura-noua', { capturedAt: t(90) })
    ]);
    expect(queue.map(p => p.id)).toEqual(['s1', 's2', 's3', 'singura-veche', 'singura-noua']);
  });

  it('seria mare inaintea celei mici', () => {
    const queue = selectSortQueue([
      photo('mic1', { capturedAt: t(0), groupId: 'mic' }),
      photo('mic2', { capturedAt: t(1), groupId: 'mic' }),
      photo('mare1', { capturedAt: t(30), groupId: 'mare' }),
      photo('mare2', { capturedAt: t(31), groupId: 'mare' }),
      photo('mare3', { capturedAt: t(32), groupId: 'mare' })
    ]);
    expect(queue.map(p => p.id)).toEqual(['mare1', 'mare2', 'mare3', 'mic1', 'mic2']);
  });

  it('membrii unei serii raman lipiti si in ordinea in care au fost facuti', () => {
    const queue = selectSortQueue([
      photo('b', { capturedAt: t(2), groupId: 'g' }),
      photo('a', { capturedAt: t(1), groupId: 'g' }),
      photo('c', { capturedAt: t(3), groupId: 'g' })
    ]);
    expect(queue.map(p => p.id)).toEqual(['a', 'b', 'c']);
  });

  it('o serie din care a mai ramas un singur cadru nedecis nu mai trece in fata', () => {
    // Nu mai e o comparatie, e o poza obisnuita — vezi undecidedPerGroup.
    const queue = selectSortQueue([
      photo('singura', { capturedAt: t(0) }),
      photo('rest-de-serie', { capturedAt: t(90), groupId: 'g' }),
      photo('deja-pastrata', { capturedAt: t(91), groupId: 'g', status: 'selected' }),
      photo('deja-respinsa', { capturedAt: t(92), groupId: 'g', status: 'rejected' })
    ]);
    expect(queue.map(p => p.id)).toEqual(['singura', 'rest-de-serie']);
  });

  it('fara nicio serie, ordinea ramane strict cronologica', () => {
    const queue = selectSortQueue([
      photo('c', { capturedAt: t(3) }),
      photo('a', { capturedAt: t(1) }),
      photo('b', { capturedAt: t(2) })
    ]);
    expect(queue.map(p => p.id)).toEqual(['a', 'b', 'c']);
  });
});
