import { describe, expect, it } from 'vitest';
import { selectBulkRejectTargets, resolveGroups, selectTopPercent } from './batchOps';
import type { PhotoView } from './store';

function photo(overrides: Partial<PhotoView>): PhotoView {
  return {
    id: 'p', fileName: 'p.jpg', status: 'review', aiScore: 50, sceneType: 'detail',
    contextKey: 'detail', faceCount: 0, knownFaceCount: 0, strangerCount: 0, bestSmile: 0,
    allEyesOpen: true, sharpness: 50, exposure: 50, ruleOfThirds: 0.5, headroom: 0.5,
    aiFactors: [], personNames: [],
    ...overrides
  };
}

describe('selectBulkRejectTargets', () => {
  it('includes review/pending photos below the threshold', () => {
    const photos = [
      photo({ id: 'a', status: 'review', aiScore: 20 }),
      photo({ id: 'b', status: 'pending', aiScore: 30 })
    ];
    expect(selectBulkRejectTargets(photos, 35).map(p => p.id)).toEqual(['a', 'b']);
  });

  it('excludes photos at or above the threshold', () => {
    const photos = [photo({ id: 'a', status: 'review', aiScore: 40 })];
    expect(selectBulkRejectTargets(photos, 35)).toEqual([]);
  });

  it('never touches an already-selected photo, regardless of score', () => {
    const photos = [photo({ id: 'a', status: 'selected', aiScore: 5 })];
    expect(selectBulkRejectTargets(photos, 90)).toEqual([]);
  });

  it('excludes photos already rejected (no-op, avoid retraining the same decision)', () => {
    const photos = [photo({ id: 'a', status: 'rejected', aiScore: 5 })];
    expect(selectBulkRejectTargets(photos, 90)).toEqual([]);
  });
});

describe('resolveGroups', () => {
  it('keeps the highest-scored member of each group, rejects the rest', () => {
    const photos = [
      photo({ id: 'a', groupId: 'g1', aiScore: 40 }),
      photo({ id: 'b', groupId: 'g1', aiScore: 80 }),
      photo({ id: 'c', groupId: 'g1', aiScore: 60 })
    ];
    const result = resolveGroups(photos);
    expect(result).toHaveLength(1);
    expect(result[0].keepId).toBe('b');
    expect(result[0].rejectIds.sort()).toEqual(['a', 'c']);
  });

  it('handles multiple independent groups separately', () => {
    const photos = [
      photo({ id: 'a', groupId: 'g1', aiScore: 40 }),
      photo({ id: 'b', groupId: 'g1', aiScore: 80 }),
      photo({ id: 'c', groupId: 'g2', aiScore: 90 }),
      photo({ id: 'd', groupId: 'g2', aiScore: 10 })
    ];
    const result = resolveGroups(photos);
    expect(result).toHaveLength(2);
    const g1 = result.find(g => g.groupId === 'g1')!;
    const g2 = result.find(g => g.groupId === 'g2')!;
    expect(g1.keepId).toBe('b');
    expect(g2.keepId).toBe('c');
  });

  it('ignores photos with no groupId', () => {
    const photos = [photo({ id: 'a', groupId: undefined })];
    expect(resolveGroups(photos)).toEqual([]);
  });

  it('picks the first member as a tie-break when scores are equal', () => {
    const photos = [
      photo({ id: 'a', groupId: 'g1', aiScore: 50 }),
      photo({ id: 'b', groupId: 'g1', aiScore: 50 })
    ];
    const result = resolveGroups(photos);
    expect(result[0].keepId).toBe('a');
    expect(result[0].rejectIds).toEqual(['b']);
  });
});

describe('selectTopPercent', () => {
  it('keeps the top N% by score, rejects the rest', () => {
    const photos = [
      photo({ id: 'a', aiScore: 90 }),
      photo({ id: 'b', aiScore: 70 }),
      photo({ id: 'c', aiScore: 50 }),
      photo({ id: 'd', aiScore: 30 })
    ];
    const result = selectTopPercent(photos, 50); // top 2 of 4
    expect(result.selectIds.sort()).toEqual(['a', 'b']);
    expect(result.rejectIds.sort()).toEqual(['c', 'd']);
  });

  it('never touches photos already selected or rejected manually', () => {
    const photos = [
      photo({ id: 'a', status: 'selected', aiScore: 10 }),
      photo({ id: 'b', status: 'rejected', aiScore: 5 }),
      photo({ id: 'c', status: 'review', aiScore: 60 })
    ];
    const result = selectTopPercent(photos, 100);
    expect(result.selectIds).toEqual(['c']);
    expect(result.rejectIds).toEqual([]);
  });

  it('0% rejects everything undecided, keeps nothing', () => {
    const photos = [photo({ id: 'a', aiScore: 90 }), photo({ id: 'b', aiScore: 10 })];
    const result = selectTopPercent(photos, 0);
    expect(result.selectIds).toEqual([]);
    expect(result.rejectIds.sort()).toEqual(['a', 'b']);
  });

  it('100% selects everything undecided, rejects nothing', () => {
    const photos = [photo({ id: 'a', aiScore: 90 }), photo({ id: 'b', aiScore: 10 })];
    const result = selectTopPercent(photos, 100);
    expect(result.selectIds.sort()).toEqual(['a', 'b']);
    expect(result.rejectIds).toEqual([]);
  });

  it('rounds the keep-count to the nearest whole photo', () => {
    // 33% of 3 -> round(0.99) = 1 kept, 2 rejected
    const photos = [
      photo({ id: 'a', aiScore: 90 }),
      photo({ id: 'b', aiScore: 80 }),
      photo({ id: 'c', aiScore: 70 })
    ];
    const result = selectTopPercent(photos, 33);
    expect(result.selectIds).toEqual(['a']);
    expect(result.rejectIds.sort()).toEqual(['b', 'c']);
  });

  it('is a no-op when there are no undecided photos', () => {
    const photos = [photo({ id: 'a', status: 'selected', aiScore: 90 })];
    const result = selectTopPercent(photos, 50);
    expect(result).toEqual({ selectIds: [], rejectIds: [] });
  });
});
