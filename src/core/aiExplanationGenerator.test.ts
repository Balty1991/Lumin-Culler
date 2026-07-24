import { describe, expect, it } from 'vitest';
import { generateExplanation, generateSuggestions } from './aiExplanationGenerator';
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
    expect(paragraphs.join(' ')).toMatch(/inceput/);
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
    expect(paragraphs.join(' ')).toMatch(/confirmat aceeasi alegere/);
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

describe('generateSuggestions', () => {
  it('returns no suggestions for a technically solid, well-composed photo', () => {
    const suggestions = generateSuggestions(analysis({
      sharpness: 80, exposure: 50, faceCount: 1, bestSmile: 0.9, allEyesOpen: true,
      ruleOfThirds: 0.8, headroom: 0.5
    }));
    expect(suggestions).toEqual([]);
  });

  it('flags a blurry photo', () => {
    const suggestions = generateSuggestions(analysis({ sharpness: 20 }));
    expect(suggestions.some(s => s.includes('stabilizarea') || s.includes('obturatorului'))).toBe(true);
  });

  it('flags under- and over-exposure distinctly', () => {
    const under = generateSuggestions(analysis({ exposure: 20 }));
    const over = generateSuggestions(analysis({ exposure: 80 }));
    expect(under.some(s => s.includes('subexpus'))).toBe(true);
    expect(over.some(s => s.includes('supraexpus'))).toBe(true);
  });

  it('flags closed eyes only when faces are present', () => {
    const noFaces = generateSuggestions(analysis({ faceCount: 0 }));
    const withClosedEyes = generateSuggestions(analysis({ faceCount: 1, allEyesOpen: false }));
    expect(noFaces.some(s => s.includes('ochii'))).toBe(false);
    expect(withClosedEyes.some(s => s.includes('ochii inchisi'))).toBe(true);
  });

  it('flags missing leading lines/symmetry only for faceless scenes', () => {
    const withFaces = generateSuggestions(analysis({ faceCount: 1, leadingLinesDetected: false, symmetryDetected: false }));
    const faceless = generateSuggestions(analysis({ faceCount: 0, leadingLinesDetected: false, symmetryDetected: false }));
    expect(withFaces.some(s => s.includes('linii directoare'))).toBe(false);
    expect(faceless.some(s => s.includes('linii directoare'))).toBe(true);
  });

  it('caps suggestions at 4, even when many issues apply', () => {
    const suggestions = generateSuggestions(analysis({
      sharpness: 20, exposure: 90, highlightClipping: 0.2, shadowClipping: 0.2, iso: 6400,
      faceCount: 1, headroom: 0.1, ruleOfThirds: 0.1, allEyesOpen: false
    }));
    expect(suggestions.length).toBeLessThanOrEqual(4);
  });

  it('generates suggestions in English when locale is "en"', () => {
    const suggestions = generateSuggestions(analysis({ sharpness: 20 }), 'en');
    expect(suggestions.some(s => s.toLowerCase().includes('stabilization'))).toBe(true);
  });
});

describe('locale support', () => {
  it('generateExplanation produces English text for locale "en"', () => {
    const paragraphs = generateExplanation(analysis({}), true, true, null, 'en');
    expect(paragraphs.join(' ')).toMatch(/clear/);
    expect(paragraphs.join(' ')).toMatch(/The AI/);
  });

  it('generateExplanation still defaults to Romanian when locale is omitted', () => {
    const paragraphs = generateExplanation(analysis({}), true, true, null);
    expect(paragraphs.join(' ')).toMatch(/Fotografia/);
  });

  it('English aiFactors paragraph uses English factor labels', () => {
    const paragraphs = generateExplanation(
      analysis({ aiFactors: [{ feature: 'sharpness', contribution: 0.9 }] }),
      true, true, null, 'en'
    );
    expect(paragraphs.some(p => p.includes('Sharpness'))).toBe(true);
    expect(paragraphs.some(p => p.includes('Main factors'))).toBe(true);
  });
});
