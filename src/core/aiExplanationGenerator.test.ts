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

  // Bug real raportat de utilizator la testare: textul spunea "zambeste natural"
  // pentru orice zambet larg, indiferent daca semnalul de autenticitate (marker
  // Duchenne, groupGenuineSmileRatio) confirma sau nu — o afirmatie nesustinuta.
  it('claims "natural" only when groupGenuineSmileRatio actually confirms it (solo)', () => {
    const genuine = generateExplanation(
      analysis({ faceCount: 1, bestSmile: 0.9, allEyesOpen: true, groupGenuineSmileRatio: 0.9 }),
      true, true, null
    );
    expect(genuine.some(p => p.includes('zâmbește natural'))).toBe(true);

    const posed = generateExplanation(
      analysis({ faceCount: 1, bestSmile: 0.9, allEyesOpen: true, groupGenuineSmileRatio: 0 }),
      true, true, null
    );
    expect(posed.some(p => p.includes('zâmbește natural'))).toBe(false);
    expect(posed.some(p => p.includes('zâmbește larg'))).toBe(true);
  });

  it('falls back to the non-committal wording when groupGenuineSmileRatio is entirely absent (older records)', () => {
    const paragraphs = generateExplanation(
      analysis({ faceCount: 1, bestSmile: 0.9, allEyesOpen: true }),
      true, true, null
    );
    expect(paragraphs.some(p => p.includes('zâmbește natural'))).toBe(false);
    expect(paragraphs.some(p => p.includes('zâmbește larg'))).toBe(true);
  });

  it('uses singular-friendly wording for a 2-person group instead of the vague plural "cativa zambesc"', () => {
    const paragraphs = generateExplanation(
      analysis({
        faceCount: 2, knownFaceCount: 2, sceneType: 'group', bestSmile: 0.5,
        groupSmileRatio: 0.5, allEyesOpen: true, groupEyesOpenRatio: 1
      }),
      true, true, null
    );
    const subject = paragraphs.find(p => p.startsWith('Cele'));
    expect(subject).toContain('unul dintre ei zâmbește');
    expect(subject).not.toContain('câțiva zâmbesc');
  });

  it('still uses "cativa zambesc" for larger groups in the same mid-smile bracket', () => {
    const paragraphs = generateExplanation(
      analysis({
        faceCount: 4, knownFaceCount: 4, sceneType: 'group', bestSmile: 0.5,
        groupSmileRatio: 0.5, allEyesOpen: true, groupEyesOpenRatio: 1
      }),
      true, true, null
    );
    const subject = paragraphs.find(p => p.startsWith('Cele'));
    expect(subject).toContain('câțiva zâmbesc');
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

  // Bug real gasit de auditul QA: pentru un peisaj/scena fara fete, textul
  // tot spunea "neclara, cu blur vizibil" pe baza claritatii BRUTE, chiar si
  // pentru un cadru pe care ContextEngine.landscapeSharpness (perspectiva
  // atmosferica) il trateaza deja indulgent la scorare — contrazicand direct
  // decizia AI-ului pentru acelasi cadru. Fix: acelasi calcul, si aici.
  it('nu descrie un peisaj cu claritate atmosferica moderata drept "neclar" (aliniat cu scorarea)', () => {
    const paragraphs = generateExplanation(analysis({ faceCount: 0, sharpness: 40 }), true, true, null);
    expect(paragraphs[0]).not.toMatch(/neclar/);
  });

  it('tot descrie un portret cu aceeasi claritate bruta drept "neclar" (fara schimbare pentru fete)', () => {
    const paragraphs = generateExplanation(analysis({ faceCount: 1, sharpness: 40 }), true, true, null);
    expect(paragraphs[0]).toMatch(/neclar/);
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
    expect(suggestions.some(s => s.text.includes('stabilizarea') || s.text.includes('obturatorului'))).toBe(true);
  });

  it('nu sugereaza stabilizare pentru un peisaj cu claritate atmosferica moderata (nu genuine blur)', () => {
    const suggestions = generateSuggestions(analysis({ faceCount: 0, sharpness: 40 }));
    expect(suggestions.some(s => s.text.includes('stabilizarea') || s.text.includes('obturatorului'))).toBe(false);
  });

  it('tot sugereaza stabilizare pentru un portret cu aceeasi claritate bruta (fara schimbare pentru fete)', () => {
    const suggestions = generateSuggestions(analysis({ faceCount: 1, sharpness: 40 }));
    expect(suggestions.some(s => s.text.includes('stabilizarea') || s.text.includes('obturatorului'))).toBe(true);
  });

  it('flags under- and over-exposure distinctly, both as nextTime (no in-app fix at this severity)', () => {
    const under = generateSuggestions(analysis({ exposure: 20 }));
    const over = generateSuggestions(analysis({ exposure: 80 }));
    expect(under.some(s => s.text.includes('subexpus') && s.when === 'nextTime')).toBe(true);
    expect(over.some(s => s.text.includes('supraexpus') && s.when === 'nextTime')).toBe(true);
  });

  it('flags closed eyes only when faces are present', () => {
    const noFaces = generateSuggestions(analysis({ faceCount: 0 }));
    const withClosedEyes = generateSuggestions(analysis({ faceCount: 1, allEyesOpen: false }));
    expect(noFaces.some(s => s.text.includes('ochii'))).toBe(false);
    expect(withClosedEyes.some(s => s.text.includes('ochii închiși'))).toBe(true);
  });

  it('flags missing leading lines/symmetry only for faceless scenes', () => {
    const withFaces = generateSuggestions(analysis({ faceCount: 1, leadingLinesDetected: false, symmetryDetected: false }));
    const faceless = generateSuggestions(analysis({ faceCount: 0, leadingLinesDetected: false, symmetryDetected: false }));
    expect(withFaces.some(s => s.text.includes('linii directoare'))).toBe(false);
    expect(faceless.some(s => s.text.includes('linii directoare'))).toBe(true);
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
    expect(suggestions.some(s => s.text.toLowerCase().includes('stabilization'))).toBe(true);
  });

  it('tags fixable-now suggestions with the matching fix, so the "Aplica" button in EditPanel knows what to do', () => {
    const highlights = generateSuggestions(analysis({ highlightClipping: 0.2 }));
    expect(highlights.find(s => s.fix === 'highlights')?.when).toBe('now');

    const shadows = generateSuggestions(analysis({ shadowClipping: 0.2 }));
    expect(shadows.find(s => s.fix === 'shadows')?.when).toBe('now');

    const centered = generateSuggestions(analysis({ faceCount: 1, ruleOfThirds: 0.1 }));
    expect(centered.find(s => s.fix === 'crop')?.when).toBe('now');

    const tilted = generateSuggestions(analysis({ faceCount: 0, horizonTiltDeg: 6 }));
    expect(tilted.find(s => s.fix === 'straighten')?.when).toBe('now');

    const dissonant = generateSuggestions(analysis({ colorHarmonyScore: 0.1 }));
    expect(dissonant.find(s => s.fix === 'saturation')?.when).toBe('now');
  });

  it('leaves "next time" (shooting-technique) suggestions without a fix, since nothing in-app can apply them', () => {
    const blurry = generateSuggestions(analysis({ sharpness: 20 }));
    expect(blurry.every(s => s.when === 'nextTime' ? s.fix === undefined : true)).toBe(true);
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
