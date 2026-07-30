import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import { deriveContextKey, explainFactors, extractFeatures, FACE_ONLY_FEATURES, LANDSCAPE_ONLY_FEATURES, landscapeSharpness, ContextEngine } from './ContextEngine';
import { db, type AnalysisRecord } from '../db';

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

  // Feedback direct: pastila "+ Highlights arse" (contributie pozitiva) citea
  // ca "prezenta highlights-urilor arse a ajutat poza" — backwards. Valoarea
  // bruta a acestor feature-uri masoara CAT de mult dintr-un defect e prezent,
  // deci o contributie pozitiva inseamna de fapt "aproape deloc din defectul
  // asta", nu "defectul a ajutat". Eticheta trebuie sa reflecte asta.
  it('uses an "absence" label for a positive contribution on a defect-style feature (few/no blown highlights helped)', () => {
    const result = explainFactors([{ feature: 'highlightClipping', contribution: 0.3 }]);
    expect(result).toEqual([{ label: 'Fara highlights arse', positive: true }]);
  });

  it('uses the plain "defect present" label for a negative contribution on the same feature', () => {
    const result = explainFactors([{ feature: 'highlightClipping', contribution: -0.3 }]);
    expect(result).toEqual([{ label: 'Highlights arse', positive: false }]);
  });

  it('applies the same absence/presence distinction to shadowClipping, strangerPenalty and isoPenalty', () => {
    const result = explainFactors([
      { feature: 'shadowClipping', contribution: 0.2 },
      { feature: 'strangerPenalty', contribution: 0.2 },
      { feature: 'isoPenalty', contribution: 0.2 }
    ]);
    expect(result).toEqual([
      { label: 'Fara umbre blocate', positive: true },
      { label: 'Fara straini in cadru', positive: true },
      { label: 'ISO redus', positive: true }
    ]);
  });
});

// Bug real raportat: poze de peisaj/natura bune, respinse de AI. Cauza: pentru
// faceCount === 0 (nicio fata), campurile "filler" (bestSmile=0, ruleOfThirds=0.5
// etc. — vezi worker) intrau in vectorul de feature-uri exact ca niste masuratori
// reale, iar la cold-start predictia foloseste modelul GLOBAL (antrenat din TOATE
// corectiile, inclusiv portrete) — daca acela invatase ponderi pozitive pentru
// bestSmile/ruleOfThirds din portrete, o valoare "filler" (nu masurata) a unui
// peisaj se normaliza puternic negativ, o penalizare artificiala. Testele de mai
// jos verifica exact fix-ul: pentru faceCount === 0, aceste chei sunt ABSENTE din
// vector (nu doar 0/0.5), deci nu mai pot fi privite/actualizate de model.
describe('extractFeatures', () => {
  it('omits every face-only feature for a photo with no faces (landscape/nature/animals)', () => {
    const features = extractFeatures(baseAnalysis({ faceCount: 0, faces: [] }));
    for (const key of FACE_ONLY_FEATURES) {
      expect(features).not.toHaveProperty(key);
    }
  });

  it('includes every face-only feature once at least one face is present', () => {
    const features = extractFeatures(baseAnalysis({
      sceneType: 'portrait', faceCount: 1, knownFaceCount: 1, strangerCount: 0,
      faces: [{
        box: [0, 0, 0.1, 0.1], faceScore: 0.9, smile: 0.8,
        eyesOpen: { left: 1, right: 1 }, isBlinking: false,
        personId: null, personName: null, similarity: 0
      }]
    }));
    for (const key of FACE_ONLY_FEATURES) {
      expect(features).toHaveProperty(key);
    }
  });

  it('still computes the universal (scene-agnostic) features for a face-less photo', () => {
    const features = extractFeatures(baseAnalysis({
      faceCount: 0, faces: [], sharpness: 90, exposure: 60, highlightClipping: 0.02,
      colorHarmonyScore: 0.8, goldenHourDetected: true
    }));
    // 90/100 trece prin landscapeSharpness (vezi describe-ul dedicat mai jos), nu prin /100 brut
    expect(features.sharpness).toBeCloseTo(landscapeSharpness(90));
    expect(features.highlightClipping).toBeCloseTo(0.02);
    expect(features.colorHarmony).toBeCloseTo(0.8);
    expect(features.goldenHour).toBe(1);
  });

  it('uses the raw (uncompressed) sharpness for a photo with at least one face', () => {
    const features = extractFeatures(baseAnalysis({
      sceneType: 'portrait', faceCount: 1, knownFaceCount: 1, strangerCount: 0, sharpness: 48,
      faces: [{
        box: [0, 0, 0.1, 0.1], faceScore: 0.9, smile: 0.8,
        eyesOpen: { left: 1, right: 1 }, isBlinking: false,
        personId: null, personName: null, similarity: 0
      }]
    }));
    expect(features.sharpness).toBeCloseTo(0.48);
  });

  // Oglinda bug-ului FACE_ONLY_FEATURES de mai sus: horizonTiltDeg e calculat
  // DOAR pentru faceCount === 0 (faceAnalysis.worker.ts) — inainte de fix,
  // horizonLevel intra totusi in vector cu o valoare filler (0.5) pentru orice
  // portret/poza de grup, contaminand modelul GLOBAL folosit la cold-start
  // pentru peisaje. Vezi LANDSCAPE_ONLY_FEATURES.
  it('omits horizonLevel for photos with faces (structural niciodata masurat acolo)', () => {
    const features = extractFeatures(baseAnalysis({
      sceneType: 'portrait', faceCount: 1, knownFaceCount: 1, strangerCount: 0,
      faces: [{
        box: [0, 0, 0.1, 0.1], faceScore: 0.9, smile: 0.8,
        eyesOpen: { left: 1, right: 1 }, isBlinking: false,
        personId: null, personName: null, similarity: 0
      }]
    }));
    for (const key of LANDSCAPE_ONLY_FEATURES) {
      expect(features).not.toHaveProperty(key);
    }
  });

  it('includes horizonLevel for a face-less photo, with the real tilt when available', () => {
    const features = extractFeatures(baseAnalysis({ faceCount: 0, faces: [], horizonTiltDeg: 6 }));
    expect(features.horizonLevel).toBeCloseTo(1 - 6 / 15);
  });

  it('falls back to the neutral 0.5 for a face-less photo when the tilt could not be estimated', () => {
    const features = extractFeatures(baseAnalysis({ faceCount: 0, faces: [], horizonTiltDeg: undefined }));
    expect(features.horizonLevel).toBe(0.5);
  });
});

// Feedback real: o poza de munte cu cer dramatic, respinsa de AI aproape doar
// din cauza factorului "Claritate" — dar claritatea GLOBALA pe tot cadrul e o
// masura nepotrivita pentru peisaj: perspectiva atmosferica (principiu de baza
// in fotografia de peisaj) face ca planurile indepartate sa apara natural mai
// putin definite, fara sa fie un defect real. landscapeSharpness comprima
// exact acest efect pentru scene fara subiect uman.
describe('landscapeSharpness', () => {
  it('leaves a fully sharp photo essentially unchanged', () => {
    expect(landscapeSharpness(100)).toBeCloseTo(1);
  });

  it('leaves a completely blurred photo at zero', () => {
    expect(landscapeSharpness(0)).toBe(0);
  });

  it('meaningfully softens the penalty for moderate (atmospheric-haze-like) softness', () => {
    const curved = landscapeSharpness(48);
    expect(curved).toBeGreaterThan(0.48); // mai putin punitiv decat scorul brut
    expect(curved).toBeCloseTo(0.6438, 3);
  });

  it('still clearly penalizes a genuinely blurry photo, not just a hazy one', () => {
    const curved = landscapeSharpness(20);
    expect(curved).toBeLessThan(0.5); // ramane sub medie, nu "spalat" complet
    expect(curved).toBeCloseTo(0.3807, 3);
  });

  it('is monotonically increasing (never reorders two photos by sharpness)', () => {
    const samples = [0, 10, 25, 40, 48, 60, 75, 90, 100];
    for (let i = 1; i < samples.length; i++) {
      expect(landscapeSharpness(samples[i])).toBeGreaterThan(landscapeSharpness(samples[i - 1]));
    }
  });
});

// Bug real gasit de auditul QA: doua apeluri concurente in init() pe un engine
// virgin nu asteptau aceeasi incarcare — fiecare pornea propria citire
// db.contextModels.toArray(), riscand ca o mutatie intre cele doua citiri sa
// fie suprascrisa silentios de a doua. fake-indexeddb da un `db` real (nu
// mockat) — doar interogarea db.contextModels e spionata, ca sa numaram cate
// citiri chiar au pornit.
describe('ContextEngine.init concurrency', () => {
  it('two concurrent init() calls on a virgin engine share a single underlying load', async () => {
    const engine = new ContextEngine();
    const toArraySpy = vi.spyOn(db.contextModels, 'toArray');

    await Promise.all([engine.init(), engine.init()]);

    expect(toArraySpy).toHaveBeenCalledTimes(1);
    toArraySpy.mockRestore();
  });

  it('a later, sequential init() call after loading is a true no-op (no second read)', async () => {
    const engine = new ContextEngine();
    await engine.init();
    const toArraySpy = vi.spyOn(db.contextModels, 'toArray');

    await engine.init();

    expect(toArraySpy).not.toHaveBeenCalled();
    toArraySpy.mockRestore();
  });
});
