import { describe, expect, it } from 'vitest';
import { computePersonRecognitionStats } from './stats';
import type { AnalysisRecord } from './db';

function analysisWithFaces(faces: AnalysisRecord['faces']): AnalysisRecord {
  return {
    photoId: 'p', faces, faceCount: faces.length, knownFaceCount: faces.filter(f => f.personId).length,
    strangerCount: faces.filter(f => !f.personId).length, bestSmile: 0, allEyesOpen: true,
    sharpness: 50, exposure: 50, sceneType: 'portrait', aiScore: 50, analyzedAt: Date.now()
  };
}

function face(personId: string | null, similarity: number): AnalysisRecord['faces'][number] {
  return {
    box: [0, 0, 10, 10], faceScore: 0.9, smile: 0, eyesOpen: { left: 1, right: 1 },
    isBlinking: false, personId, personName: personId ? 'Ami' : null, similarity
  };
}

describe('computePersonRecognitionStats', () => {
  it('averages similarity per person across multiple photos', () => {
    const stats = computePersonRecognitionStats([
      analysisWithFaces([face('id1', 0.8)]),
      analysisWithFaces([face('id1', 0.6)])
    ]);
    expect(stats.get('id1')).toEqual({ matchCount: 2, avgSimilarity: 0.7 });
  });

  it('ignores unrecognized (stranger) faces entirely', () => {
    const stats = computePersonRecognitionStats([analysisWithFaces([face(null, 0)])]);
    expect(stats.size).toBe(0);
  });

  it('counts faces individually, not photos (a burst can match the same person repeatedly)', () => {
    const stats = computePersonRecognitionStats([
      analysisWithFaces([face('id1', 0.9), face('id2', 0.7)]),
      analysisWithFaces([face('id1', 0.7)])
    ]);
    expect(stats.get('id1')).toEqual({ matchCount: 2, avgSimilarity: 0.8 });
    expect(stats.get('id2')).toEqual({ matchCount: 1, avgSimilarity: 0.7 });
  });
});
