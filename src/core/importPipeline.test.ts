import { describe, expect, it } from 'vitest';
import { toHashInput } from './importPipeline';
import type { AnalysisRecord } from './db';

function baseAnalysis(overrides: Partial<AnalysisRecord> = {}): AnalysisRecord {
  return {
    photoId: 'p1',
    faces: [],
    faceCount: 0,
    knownFaceCount: 0,
    strangerCount: 0,
    bestSmile: 0.4,
    allEyesOpen: true,
    sharpness: 77,
    exposure: 52,
    sceneType: 'landscape',
    aiScore: 63,
    analyzedAt: Date.now(),
    ...overrides
  };
}

describe('toHashInput', () => {
  it('carries the id/hash and the fields groupSelection.pickBestInGroup needs, straight from the analysis', () => {
    const input = toHashInput('id-1', 'deadbeef', baseAnalysis({ compositionScore: 0.8, faceCount: 2, bestSmile: 0.9 }));
    expect(input).toEqual({
      id: 'id-1',
      hash: 'deadbeef',
      score: 63,
      sharpness: 77,
      exposure: 52,
      compositionScore: 0.8,
      faceCount: 2,
      bestSmile: 0.9,
      groupSmileRatio: undefined,
      allEyesOpen: true,
      groupEyesOpenRatio: undefined,
      avgEyeContact: undefined
    });
  });
});
