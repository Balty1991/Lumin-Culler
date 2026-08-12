import { describe, it, expect } from 'vitest';
import { isGroupResolved, selectUnresolvedGroups } from './duplicateGroups';
import type { PhotoView } from './store';

function photo(id: string, opts: Partial<PhotoView> = {}): PhotoView {
  return {
    id, fileName: `${id}.jpg`, importedAt: 0, status: 'pending', rating: 0, aiScore: 50,
    sceneType: 'detail', contextKey: '', faceCount: 0, knownFaceCount: 0, strangerCount: 0,
    bestSmile: 0, allEyesOpen: true, sharpness: 0, exposure: 0, ruleOfThirds: 0, headroom: 0,
    aiFactors: [], personNames: [], personMatches: [],
    ...opts
  };
}

describe('isGroupResolved', () => {
  it('is resolved when only one member is not rejected', () => {
    expect(isGroupResolved([{ status: 'selected' }, { status: 'rejected' }, { status: 'rejected' }])).toBe(true);
  });
  it('is unresolved when two or more members are still kept', () => {
    expect(isGroupResolved([{ status: 'selected' }, { status: 'pending' }])).toBe(false);
  });
  it('is unresolved when nothing has been rejected yet', () => {
    expect(isGroupResolved([{ status: 'pending' }, { status: 'pending' }])).toBe(false);
  });
});

describe('selectUnresolvedGroups', () => {
  it('excludes photos without a groupId', () => {
    const photos = [photo('a'), photo('b')];
    expect(selectUnresolvedGroups(photos)).toEqual([]);
  });

  it('excludes groups already resolved (exactly one survivor)', () => {
    const photos = [
      photo('a', { groupId: 'g1', status: 'selected' }),
      photo('b', { groupId: 'g1', status: 'rejected' })
    ];
    expect(selectUnresolvedGroups(photos)).toEqual([]);
  });

  it('includes groups with 2+ members still not decided', () => {
    const photos = [
      photo('a', { groupId: 'g1', status: 'selected' }),
      photo('b', { groupId: 'g1', status: 'pending' })
    ];
    const groups = selectUnresolvedGroups(photos);
    expect(groups).toHaveLength(1);
    expect(groups[0][0]).toBe('g1');
    expect(groups[0][1].map(p => p.id)).toEqual(['a', 'b']);
  });

  it('sorts larger unresolved groups first', () => {
    const photos = [
      photo('a', { groupId: 'small', status: 'pending' }),
      photo('b', { groupId: 'small', status: 'pending' }),
      photo('c', { groupId: 'big', status: 'pending' }),
      photo('d', { groupId: 'big', status: 'pending' }),
      photo('e', { groupId: 'big', status: 'pending' })
    ];
    const groups = selectUnresolvedGroups(photos);
    expect(groups.map(([id]) => id)).toEqual(['big', 'small']);
  });
});
