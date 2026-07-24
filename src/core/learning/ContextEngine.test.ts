import { describe, expect, it } from 'vitest';
import { deriveContextKey, explainFactors } from './ContextEngine';
import type { AnalysisRecord } from '../db';

function baseAnalysis(overrides: Partial<AnalysisRecord> = {}): AnalysisRecord {
  return {
    photoId: 'p1',
    faces: [],
    faceCount: 0,
    knownFaceCount: 0,
    strangerCount: 0,
    bestSmile: 0,
    allEyesOpen: true,
    sharpness: 80,
    exposure: 50,
    sceneType: 'landscape',
    aiScore: 0,
    analyzedAt: Date.now(),
    ...overrides
  };
}

describe('deriveContextKey', () => {
  it('falls back to sceneType alone when there is no genre and no faces', () => {
    expect(deriveContextKey(baseAnalysis())).toBe('landscape');
  });

  it('distinguishes known/stranger/mixed subjects, exactly as before genre existed', () => {
    expect(deriveContextKey(baseAnalysis({ sceneType: 'portrait', faceCount: 1, knownFaceCount: 1, strangerCount: 0 }))).toBe('portrait:known');
    expect(deriveContextKey(baseAnalysis({ sceneType: 'portrait', faceCount: 1, knownFaceCount: 0, strangerCount: 1 }))).toBe('portrait:strangers');
    expect(deriveContextKey(baseAnalysis({ sceneType: 'group', faceCount: 2, knownFaceCount: 1, strangerCount: 1 }))).toBe('group:mixed');
  });

  it('prefixes the key with the genre when one is given, keeping scenes fully separate per genre', () => {
    expect(deriveContextKey(baseAnalysis(), 'Nunta')).toBe('Nunta:landscape');
    expect(deriveContextKey(baseAnalysis({ sceneType: 'portrait', faceCount: 1, knownFaceCount: 1 }), 'Nunta')).toBe('Nunta:portrait:known');
  });

  it('treats an empty/whitespace-only genre as "no genre", identical to omitting it', () => {
    expect(deriveContextKey(baseAnalysis(), '')).toBe('landscape');
    expect(deriveContextKey(baseAnalysis(), '   ')).toBe('landscape');
  });
});

describe('explainFactors', () => {
  const factors = [
    { feature: 'sharpness', contribution: 0.8 },
    { feature: 'exposureBalance', contribution: -0.4 },
    { feature: 'unknownFeature', contribution: 0.9 }, // fara eticheta -> exclus, ca inainte
    { feature: 'allEyesOpen', contribution: 0.01 } // sub pragul de 0.03 -> exclus
  ];

  it('defaults to Romanian labels when locale is omitted', () => {
    const result = explainFactors(factors);
    expect(result).toEqual([
      { label: 'Claritate', positive: true },
      { label: 'Expunere echilibrata', positive: false }
    ]);
  });

  it('produces English labels when locale is "en"', () => {
    const result = explainFactors(factors, 'en');
    expect(result).toEqual([
      { label: 'Sharpness', positive: true },
      { label: 'Balanced exposure', positive: false }
    ]);
  });

  it('still excludes unlabeled features and negligible contributions regardless of locale', () => {
    const result = explainFactors(factors, 'en');
    expect(result.some(f => f.label === 'unknownFeature')).toBe(false);
    expect(result).toHaveLength(2);
  });
});
