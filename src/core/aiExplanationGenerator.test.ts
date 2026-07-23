import { describe, expect, it } from 'vitest';
import { generateExplanation } from './aiExplanationGenerator';
import type { AnalysisRecord, ContextModelRecord } from './db';

function analysis(overrides: Partial<AnalysisRecord>): AnalysisRecord {
  return {
    photoId: 'p', faces: [], faceCount: 0, knownFaceCount: 0, strangerCount: 0,
    bestSmile: 0, allEyesOpen: true, sharpness: 60, exposure: 50, sceneType: 'detail',
    aiScore: 50, analyzedAt: 0,
    ...overrides
  };
}

function model(overrides: Partial<ContextModelRecord>): ContextModelRecord {
  return { contextKey: 'detail', weights: {}, bias: 0, featureStats: {}, sampleCount: 0, updatedAt: 0, ...overrides };
}

describe('generateExplanation', () => {
  it('always includes at least a technical and a verdict paragraph', () => {
    const paragraphs = generateExplanation(analysis({}), true, true, null);
    expect(paragraphs.length).toBeGreaterThanOrEqual(2);
    expect(paragraphs[0]).toMatch(/clar|neclar/);
  });

  it('mentions cold-start confidence when no context model exists yet', () => {
    const paragraphs = generateExplanation(analysis({}), true, null, null);
    expect(paragraphs.join(' ')).toMatch(/început/);
  });

  it('mentions "trained" confidence with a model that has many samples', () => {
    const paragraphs = generateExplanation(analysis({}), true, true, model({ sampleCount: 100 }));
    expect(paragraphs.join(' ')).toMatch(/antrenat/);
  });

  it('flags a disagreement when the AI would keep but the user rejected', () => {
    const paragraphs = generateExplanation(analysis({}), true, false, null);
    expect(paragraphs.join(' ')).toMatch(/ai fost respins-o|tu ai respins-o/);
  });

  it('confirms agreement when AI and user both selected', () => {
    const paragraphs = generateExplanation(analysis({}), true, true, null);
    expect(paragraphs.join(' ')).toMatch(/confirmat aceeași alegere/);
  });

  it('adds a subject paragraph only when faces are present', () => {
    const withoutFaces = generateExplanation(analysis({ faceCount: 0 }), true, true, null);
    const withFaces = generateExplanation(
      analysis({ faceCount: 1, bestSmile: 0.9, allEyesOpen: true, avgEyeContact: 0.8 }),
      true, true, null
    );
    expect(withoutFaces.some(p => p.startsWith('Subiectul'))).toBe(false);
    expect(withFaces.some(p => p.startsWith('Subiectul'))).toBe(true);
  });

  it('surfaces weighted aiFactors as a dedicated paragraph', () => {
    const paragraphs = generateExplanation(
      analysis({ aiFactors: [{ feature: 'sharpness', contribution: 0.9 }, { feature: 'exposureBalance', contribution: -0.5 }] }),
      true, true, null
    );
    expect(paragraphs.some(p => p.includes('Principalii factori'))).toBe(true);
  });
});
