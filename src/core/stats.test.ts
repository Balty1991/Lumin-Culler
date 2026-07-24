import { describe, expect, it } from 'vitest';
import { computePersonRecognitionStats, computeAgreementTrend } from './stats';
import type { AnalysisRecord, CorrectionRecord } from './db';

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

function correction(ts: number, agreed: boolean): CorrectionRecord {
  return { photoId: 'p', contextKey: 'ctx', features: {}, aiDecision: true, userDecision: agreed, ts };
}

describe('computeAgreementTrend', () => {
  it('returns an empty array when there are fewer than 2x bucketCount corrections (not enough for a meaningful trend)', () => {
    const corrections = Array.from({ length: 5 }, (_, i) => correction(i, true));
    expect(computeAgreementTrend(corrections, 3)).toEqual([]);
  });

  it('buckets chronologically by COUNT, not by calendar time, and computes agreement rate per bucket', () => {
    // 6 corrections, bucketCount=3 -> 2 per bucket. First bucket all agree,
    // second bucket half agree, third bucket none agree — regardless of ts spacing.
    const corrections = [
      correction(1, true), correction(2, true),
      correction(3, true), correction(4, false),
      correction(5, false), correction(6, false)
    ];
    const trend = computeAgreementTrend(corrections, 3);
    expect(trend).toEqual([
      { index: 0, count: 2, agreementRate: 1 },
      { index: 1, count: 2, agreementRate: 0.5 },
      { index: 2, count: 2, agreementRate: 0 }
    ]);
  });

  it('sorts by ts before bucketing, regardless of input order', () => {
    const corrections = [correction(3, false), correction(1, true), correction(2, true), correction(4, false)];
    const trend = computeAgreementTrend(corrections, 2);
    // sorted by ts: [1:true, 2:true, 3:false, 4:false] -> bucket0=[true,true], bucket1=[false,false]
    expect(trend).toEqual([
      { index: 0, count: 2, agreementRate: 1 },
      { index: 1, count: 2, agreementRate: 0 }
    ]);
  });

  it('defaults to 6 buckets', () => {
    const corrections = Array.from({ length: 12 }, (_, i) => correction(i, true));
    expect(computeAgreementTrend(corrections)).toHaveLength(6);
  });
});
