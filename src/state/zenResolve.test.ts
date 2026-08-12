import { describe, it, expect } from 'vitest';
import { resolveGroupsWithConfidence } from './zenResolve';
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

describe('resolveGroupsWithConfidence', () => {
  it('marks a group confident when the score gap is large and faces are few', () => {
    const photos = [
      photo('a', { groupId: 'g1', aiScore: 90, faceCount: 1 }),
      photo('b', { groupId: 'g1', aiScore: 60, faceCount: 1 })
    ];
    const [res] = resolveGroupsWithConfidence(photos);
    expect(res.confident).toBe(true);
    expect(res.keepId).toBe('a');
    expect(res.rejectIds).toEqual(['b']);
  });

  it('marks a group uncertain when the score gap is small', () => {
    const photos = [
      photo('a', { groupId: 'g1', aiScore: 62, faceCount: 1 }),
      photo('b', { groupId: 'g1', aiScore: 60, faceCount: 1 })
    ];
    const [res] = resolveGroupsWithConfidence(photos);
    expect(res.confident).toBe(false);
  });

  it('marks a group uncertain when it has many faces, even with a large score gap', () => {
    const photos = [
      photo('a', { groupId: 'g1', aiScore: 90, faceCount: 5 }),
      photo('b', { groupId: 'g1', aiScore: 60, faceCount: 5 })
    ];
    const [res] = resolveGroupsWithConfidence(photos);
    expect(res.confident).toBe(false);
  });

  it('returns an empty array when no photos are grouped', () => {
    expect(resolveGroupsWithConfidence([photo('a')])).toEqual([]);
  });
});
