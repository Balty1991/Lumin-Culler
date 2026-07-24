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
      avgEyeContact: undefined,
      faceEmbeddings: [],
      colorHarmonyScore: undefined
    });
  });

  it('extrage embedding-urile fetelor detectate (pentru rafinarea grupurilor in hashCompare.worker) si trece colorHarmonyScore', () => {
    const faceWithEmbedding = { box: [0, 0, 1, 1] as [number, number, number, number], faceScore: 0.9, smile: 0.5, eyesOpen: { left: 1, right: 1 }, isBlinking: false, personId: null, personName: null, similarity: 0, embedding: [1, 2, 3] };
    const faceWithoutEmbedding = { ...faceWithEmbedding, embedding: undefined };
    const input = toHashInput('id-2', 'abc', baseAnalysis({ faces: [faceWithEmbedding, faceWithoutEmbedding], colorHarmonyScore: 0.7 }));

    expect(input.faceEmbeddings).toEqual([[1, 2, 3]]);
    expect(input.colorHarmonyScore).toBe(0.7);
  });
});
