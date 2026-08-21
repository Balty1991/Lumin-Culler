import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import { deriveContextKey, explainFactors, extractFeatures, FACE_ONLY_FEATURES, LANDSCAPE_ONLY_FEATURES, landscapeSharpness, ContextEngine, updateWeight, priorAnchor, hasProminentSubject, lacksCameraMetadata } from './ContextEngine';
import { db, type AnalysisRecord } from '../db';
import { t } from '../../i18n';

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
      { label: 'Expunere echilibrată', positive: false }
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
    expect(result).toEqual([{ label: 'Fără highlights arse', positive: true }]);
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
      { label: 'Fără umbre blocate', positive: true },
      { label: 'Fără străini în cadru', positive: true },
      { label: 'ISO redus', positive: true }
    ]);
  });

  it('applies the same absence/presence distinction to bodyCroppedAtEdge (pose-based limb-crop signal)', () => {
    expect(explainFactors([{ feature: 'bodyCroppedAtEdge', contribution: 0.2 }]))
      .toEqual([{ label: 'Nimic tăiat de cadru', positive: true }]);
    expect(explainFactors([{ feature: 'bodyCroppedAtEdge', contribution: -0.2 }]))
      .toEqual([{ label: 'Membru tăiat de cadru', positive: false }]);
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

  // bodyCroppedAtEdge (Android nativ, PoseDetection) — absent pe web/PWA si pe
  // inregistrari mai vechi, tratat neutru (0.5), la fel ca subjectInFocus/
  // bokehQuality mai sus, nu "asumat fara defect" (0).
  it('defaults bodyCroppedAtEdge to the neutral 0.5 when the signal was never computed (web, or older records)', () => {
    const features = extractFeatures(baseAnalysis({ sceneType: 'portrait', faceCount: 1, bodyCroppedAtEdge: undefined }));
    expect(features.bodyCroppedAtEdge).toBe(0.5);
  });

  it('reflects a real bodyCroppedAtEdge value (true/false) as 1/0', () => {
    const cropped = extractFeatures(baseAnalysis({ sceneType: 'portrait', faceCount: 1, bodyCroppedAtEdge: true }));
    const clean = extractFeatures(baseAnalysis({ sceneType: 'portrait', faceCount: 1, bodyCroppedAtEdge: false }));
    expect(cropped.bodyCroppedAtEdge).toBe(1);
    expect(clean.bodyCroppedAtEdge).toBe(0);
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

// Cerinta directa a utilizatorului: un mic toast IMEDIAT dupa o corectie
// ("Am invatat: X"), distinct de panoul agregat "Preferinte AI" (deja
// existent, InsightsPanel.tsx) pe care trebuie sa-l deschizi manual.
describe('ContextEngine.recordCorrection topShift ("Am invatat: X")', () => {
  it('returneaza topShift: null la un ACORD (AI si utilizatorul coincid) — nimic nou de anuntat', async () => {
    const engine = new ContextEngine();
    const result = await engine.recordCorrection({
      photoId: 'p1', analysis: baseAnalysis({ sharpness: 90, aiScore: 80 }), aiDecision: true, userDecision: true
    });
    expect(result.topShift).toBeNull();
  });

  it('returneaza un topShift tradus la un DEZACORD real, cu pondere schimbata suficient', async () => {
    const engine = new ContextEngine();
    const result = await engine.recordCorrection({
      photoId: 'p1',
      analysis: baseAnalysis({ sharpness: 95, exposure: 50, faceCount: 1, bestSmile: 0.9, allEyesOpen: true, aiScore: 80 }),
      aiDecision: true, userDecision: false // AI a propus selectare, utilizatorul a respins -> dezacord real
    });
    expect(result.topShift).not.toBeNull();
    expect(typeof result.topShift?.feature).toBe('string');
    expect(result.topShift?.label).toBeTruthy();
    // label-ul e traducerea (insightsPref.<feature>.pos/neg), nu cheia bruta a feature-ului
    expect(result.topShift?.label).not.toBe(result.topShift?.feature);
  });

  it('nu raporteaza niciodata un feature specific fetelor pentru o poza fara fete (faceCount 0)', async () => {
    const engine = new ContextEngine();
    const result = await engine.recordCorrection({
      photoId: 'p1',
      analysis: baseAnalysis({ faceCount: 0, sharpness: 30, aiScore: 20 }),
      aiDecision: false, userDecision: true
    });
    if (result.topShift) {
      expect(FACE_ONLY_FEATURES as readonly string[]).not.toContain(result.topShift.feature);
    }
  });

  it('respecta parametrul locale (en) pentru textul lui topShift', async () => {
    const engine = new ContextEngine();
    const result = await engine.recordCorrection({
      photoId: 'p1',
      analysis: baseAnalysis({ sharpness: 95, exposure: 50, faceCount: 1, bestSmile: 0.9, allEyesOpen: true, aiScore: 80 }),
      aiDecision: true, userDecision: false, locale: 'en'
    });
    // pragul/feature-ul castigator e acelasi calcul numeric, indiferent de locale —
    // doar verificam ca textul nu ramane in romana cand se cere engleza.
    if (result.topShift) {
      const roLabel = t('ro', `insightsPref.${result.topShift.feature}.pos`);
      const roLabelNeg = t('ro', `insightsPref.${result.topShift.feature}.neg`);
      expect([roLabel, roLabelNeg]).not.toContain(result.topShift.label);
    }
  });
});

// Afinitatea de continut e un feature ca oricare altul, dar cu o regula stricta:
// e ABSENT cand nu stim, nu "neutru" — vezi nota despre horizonLevel din
// ContextEngine.ts pentru ce strica un filler trimis la fiecare poza.
describe('extractFeatures — semnalele de memorie', () => {
  it('lipsesc complet cand nu se stie nimic', () => {
    const none = extractFeatures(baseAnalysis());
    expect('contentAffinity' in none).toBe(false);
    expect('subjectAffinity' in none).toBe(false);
    const nulls = extractFeatures(baseAnalysis(), { contentAffinity: null, subjectAffinity: null });
    expect('contentAffinity' in nulls).toBe(false);
    expect('subjectAffinity' in nulls).toBe(false);
  });

  it('apar doar cand chiar exista o valoare, independent unul de altul', () => {
    const onlyContent = extractFeatures(baseAnalysis(), { contentAffinity: 0.8, subjectAffinity: null });
    expect(onlyContent.contentAffinity).toBe(0.8);
    expect('subjectAffinity' in onlyContent).toBe(false);

    const onlySubject = extractFeatures(baseAnalysis(), { subjectAffinity: 0.2 });
    expect(onlySubject.subjectAffinity).toBe(0.2);
    expect('contentAffinity' in onlySubject).toBe(false);
  });

  it('textCoverage devine feature cand a fost masurat, si lipseste cand nu', () => {
    expect('textCoverage' in extractFeatures(baseAnalysis())).toBe(false);
    expect(extractFeatures(baseAnalysis({ textCoverage: 0.7 })).textCoverage).toBe(0.7);
  });
});

// Cerinta directa a utilizatorului: motorul de baza sa fie puternic de la prima
// poza, iar autoinvatarea sa fie ADAPTARE peste el, nu inlocuirea lui in timp.
// Regula de actualizare e testata aici direct (nu prin capatul celalalt al unui
// import de sute de poze, unde efectul ei se amesteca inseparabil cu invatarea
// reala din date).
describe('updateWeight — regularizare spre prior, nu spre zero', () => {
  const LR = 0.05; // ordinul de marime al lui BASE_LR/sqrt(n) pentru un model deja antrenat

  it('fara niciun gradient, o pondere ramane practic pe ancora ei', () => {
    let w = priorAnchor('sharpness'); // 0.9
    for (let i = 0; i < 1000; i++) w = updateWeight(w, 0, LR, priorAnchor('sharpness'));
    expect(w).toBeCloseTo(0.9, 6);
  });

  it('fara niciun gradient, o pondere deviata se intoarce SPRE ancora, nu spre zero', () => {
    const anchor = priorAnchor('sharpness');
    let w = 0.2; // impinsa mult sub prior de o serie de decizii
    for (let i = 0; i < 1000; i++) w = updateWeight(w, 0, LR, anchor);
    expect(w).toBeGreaterThan(0.2);
    expect(w).toBeLessThanOrEqual(anchor);
    // revenirea e lenta si asimptotica, nu un salt inapoi peste ce s-a invatat
    expect(updateWeight(0.2, 0, LR, anchor) - 0.2).toBeLessThan(0.01);
  });

  it('o pondere peste ancora e trasa in jos de acelasi termen (simetric)', () => {
    const anchor = priorAnchor('sharpness');
    expect(updateWeight(2.0, 0, LR, anchor)).toBeLessThan(2.0);
    expect(updateWeight(2.0, 0, LR, anchor)).toBeGreaterThan(anchor);
  });

  it('un feature fara prior fotografic se comporta exact ca inainte: revine spre zero', () => {
    // negativeSpace/lightHard sunt deliberat 0 in PRIOR_WEIGHTS (preferinte de
    // stil, fara directie universala) — ancora lor E zero.
    expect(priorAnchor('negativeSpace')).toBe(0);
    let w = 0.8;
    for (let i = 0; i < 2000; i++) w = updateWeight(w, 0, LR, priorAnchor('negativeSpace'));
    expect(w).toBeLessThan(0.4);
  });

  it('un gradient consistent invinge revenirea — utilizatorul chiar isi poate muta preferinta', () => {
    const anchor = priorAnchor('sharpness');
    let w = anchor;
    // presiune modesta, dar mereu in aceeasi directie
    for (let i = 0; i < 200; i++) w = updateWeight(w, 0.4, LR, anchor);
    expect(w).toBeLessThan(0); // a trecut chiar si de zero
  });

  it('dar nu poate inversa complet cunostinta de baza: banda ±1.5 in jurul ancorei', () => {
    const anchor = priorAnchor('sharpness'); // 0.9
    let w = anchor;
    for (let i = 0; i < 5000; i++) w = updateWeight(w, 5, LR, anchor);
    expect(w).toBeGreaterThanOrEqual(anchor - 1.5 - 1e-9);
    expect(w).toBeCloseTo(anchor - 1.5, 6);

    let up = anchor;
    for (let i = 0; i < 5000; i++) up = updateWeight(up, -5, LR, anchor);
    expect(up).toBeCloseTo(anchor + 1.5, 6);
  });
});

// Cele trei feature-uri de mai jos intrau in vector fara statistici de referinta,
// deci normalize() le trata ca valori BRUTE pentru primele lor 3 aparitii —
// vezi nota din PRIOR_FEATURE_STATS.
describe('ContextEngine — semnalele noi sunt centrate de la prima poza', () => {
  it('o afinitate de continut NEUTRA nu misca scorul fata de o poza fara niciun semnal de continut', async () => {
    const engine = new ContextEngine();
    // memoria de continut are nevoie de decizii de ambele parti ca sa se activeze
    for (let i = 0; i < 6; i++) {
      await engine.recordCorrection({
        photoId: `k${i}`, analysis: baseAnalysis({ imageEmbedding: [1, 0] }), aiDecision: true, userDecision: true
      });
      await engine.recordCorrection({
        photoId: `r${i}`, analysis: baseAnalysis({ imageEmbedding: [-1, 0] }), aiDecision: false, userDecision: false
      });
    }

    // [0, 1] e la fel de departe de ambele centroide -> afinitate exact 0.5 (neutru)
    const neutralSignal = await engine.predict(baseAnalysis({ photoId: 'x', imageEmbedding: [0, 1] }));
    const noSignal = await engine.predict(baseAnalysis({ photoId: 'y' }));

    // Fara statistici de referinta, 0.5 intra BRUT in model si adauga
    // 0.5 x ponderea la fiecare poza — o inclinare constanta spre "pastreaza",
    // care nu vine din nimic observat. Centrat pe 0.5, z-scorul e 0.
    expect(neutralSignal.score).toBe(noSignal.score);
  });

  it('text mult in cadru coboara scorul inca de la prima poza analizata vreodata', async () => {
    const engine = new ContextEngine();
    const document = await engine.predict(baseAnalysis({ photoId: 'doc', textCoverage: 0.85 }));
    const photo = await engine.predict(baseAnalysis({ photoId: 'foto', textCoverage: 0.02 }));
    expect(document.score).toBeLessThan(photo.score);
  });
});

/** O fata cu aria data (fractiune din cadru), patrata, in coltul stanga-sus. */
function faceOfArea(area: number) {
  const side = Math.sqrt(area);
  return {
    box: [0, 0, side, side] as [number, number, number, number],
    faceScore: 0.9, smile: 0.5, eyesOpen: { left: 1, right: 1 }, isBlinking: false,
    personId: null, personName: null, similarity: 0
  };
}

// "Exista o fata" nu inseamna "fotografia e despre acea persoana": un trecator
// la 30 de metri intr-un peisaj transforma cadrul in portret pentru tot restul
// motorului, si dezactiveaza exact compensarea (landscapeSharpness) scrisa
// pentru genul acela de cadru.
describe('hasProminentSubject', () => {
  it('nu vede subiect intr-o poza fara fete', () => {
    expect(hasProminentSubject({ faceCount: 0, faces: [] })).toBe(false);
  });

  it('vede subiect intr-un portret normal', () => {
    expect(hasProminentSubject({ faceCount: 1, faces: [faceOfArea(0.06)] })).toBe(true);
  });

  it('nu vede subiect intr-un trecator minuscul dintr-un peisaj', () => {
    expect(hasProminentSubject({ faceCount: 1, faces: [faceOfArea(0.0004)] })).toBe(false);
  });

  it('e destul ca UNA dintre fete sa fie prominenta', () => {
    expect(hasProminentSubject({ faceCount: 3, faces: [faceOfArea(0.0002), faceOfArea(0.0003), faceOfArea(0.05)] })).toBe(true);
  });

  it('pastreaza comportamentul vechi cand cutiile lipsesc (inregistrari mai vechi)', () => {
    expect(hasProminentSubject({ faceCount: 2, faces: [] })).toBe(true);
  });
});

describe('extractFeatures — subiect prominent vs. fata detectata', () => {
  it('aplica compensarea de peisaj unei poze cu un trecator minuscul, nu regula de portret', () => {
    const features = extractFeatures(baseAnalysis({
      sceneType: 'portrait', faceCount: 1, strangerCount: 1, sharpness: 48, faces: [faceOfArea(0.0004)]
    }));
    expect(features.sharpness).toBeCloseTo(landscapeSharpness(48));
  });

  it('lasa claritatea bruta pentru un portret real', () => {
    const features = extractFeatures(baseAnalysis({
      sceneType: 'portrait', faceCount: 1, sharpness: 48, faces: [faceOfArea(0.06)]
    }));
    expect(features.sharpness).toBeCloseTo(0.48);
  });

  it('masoara cat de mare e omul in cadru, nu doar ca exista', () => {
    const departe = extractFeatures(baseAnalysis({ faceCount: 1, faces: [faceOfArea(0.0004)] }));
    const aproape = extractFeatures(baseAnalysis({ faceCount: 1, faces: [faceOfArea(0.16)] }));
    expect(departe.subjectProminence).toBeLessThan(aproape.subjectProminence);
    expect(aproape.subjectProminence).toBeCloseTo(0.8); // sqrt(0.16) = 0.4, adica 0.4/0.5
  });

  it('omite prominenta cand cutiile fetelor lipsesc — "nu stiu" nu inseamna "subiect minuscul"', () => {
    expect('subjectProminence' in extractFeatures(baseAnalysis({ faceCount: 1, faces: [] }))).toBe(false);
  });
});

// Intr-o galerie de telefon, fisierele fara nicio urma de aparat foto sunt
// aproape exact categoria "poze care nu sunt pozele tale" — capturi de ecran,
// meme-uri, imagini primite pe mesagerie (care sterge metadatele).
describe('lacksCameraMetadata', () => {
  it('recunoaste un fisier fara nicio urma de aparat', () => {
    expect(lacksCameraMetadata({})).toBe(true);
  });

  it('e destul UN singur camp de aparat ca sa nu mai fie considerat asa', () => {
    expect(lacksCameraMetadata({ iso: 100 })).toBe(false);
    expect(lacksCameraMetadata({ cameraMake: 'Google' })).toBe(false);
    expect(lacksCameraMetadata({ exposureTime: 0.004 })).toBe(false);
    expect(lacksCameraMetadata({ focalLength: 24 })).toBe(false);
  });

  it('coboara scorul unei capturi de ecran fata de aceeasi poza facuta cu aparatul, de la prima poza', async () => {
    const engine = new ContextEngine();
    const capturaDeEcran = await engine.predict(baseAnalysis({ photoId: 'captura' }));
    const pozaReala = await engine.predict(baseAnalysis({ photoId: 'poza', cameraMake: 'Google', iso: 100, fNumber: 1.8 }));
    expect(capturaDeEcran.score).toBeLessThan(pozaReala.score);
  });
});

// Orizontul e a doua jumatate a aceleiasi probleme: un peisaj cu un trecator mic
// e tot un peisaj, si are tot un orizont de judecat.
describe('extractFeatures — orizontul unui peisaj cu om mic in cadru', () => {
  it('include orizontul cand analiza chiar l-a masurat, desi exista o fata mica', () => {
    const features = extractFeatures(baseAnalysis({
      sceneType: 'portrait', faceCount: 1, faces: [faceOfArea(0.0004)], horizonTiltDeg: 6
    }));
    expect(features.horizonLevel).toBeCloseTo(1 - 6 / 15);
  });

  it('nu-l include pentru un portret real, oricat de masurat ar fi', () => {
    const features = extractFeatures(baseAnalysis({
      sceneType: 'portrait', faceCount: 1, faces: [faceOfArea(0.06)], horizonTiltDeg: 6
    }));
    expect('horizonLevel' in features).toBe(false);
  });

  it('nu trimite filler pentru inregistrarile vechi, unde poarta de analiza era inca "fara nicio fata"', () => {
    // fata mica + orizont niciodata masurat: OMIS, nu 0.5 — un filler constant
    // strica exact statisticile de normalizare pe care le protejeaza
    // LANDSCAPE_ONLY_FEATURES.
    const features = extractFeatures(baseAnalysis({ faceCount: 1, faces: [faceOfArea(0.0004)] }));
    expect('horizonLevel' in features).toBe(false);
  });

  it('pastreaza 0.5 pentru o poza chiar fara fete, unde masuratoarea a esuat (prea putine muchii)', () => {
    expect(extractFeatures(baseAnalysis({ faceCount: 0, faces: [] })).horizonLevel).toBe(0.5);
  });
});

// EXIF citit de mult, dar folosit doar pentru afisare, niciodata la decizie.
describe('extractFeatures — semnalele EXIF ramase nefolosite', () => {
  it('foloseste echivalentul 35mm, singurul comparabil intre aparate', () => {
    // Bug real: scala porneste de la 10mm, deci TOATE focalele brute de telefon
    // (2-9mm) se prabuseau in 0 — ultrawide, camera principala si teleobiectivul
    // erau indistinctibile exact pe platforma unde conteaza cel mai mult.
    const ultrawide = extractFeatures(baseAnalysis({ focalLength: 2.2, focalLength35mm: 13 }));
    const principala = extractFeatures(baseAnalysis({ focalLength: 6.9, focalLength35mm: 26 }));
    const tele = extractFeatures(baseAnalysis({ focalLength: 9, focalLength35mm: 77 }));
    expect(ultrawide.focalLengthRaw).toBeLessThan(principala.focalLengthRaw);
    expect(principala.focalLengthRaw).toBeLessThan(tele.focalLengthRaw);

    // fara echivalent, focala bruta ramane rezerva (comportamentul de dinainte)
    const brut = extractFeatures(baseAnalysis({ focalLength: 50 }));
    expect(brut.focalLengthRaw).toBeCloseTo(Math.log2(5) / 8);
    // si 0.5 (neutru) cand nu stim nimic despre focala
    expect(extractFeatures(baseAnalysis()).focalLengthRaw).toBe(0.5);
  });

  it('marcheaza blitzul, si presupune "fara blitz" cand EXIF-ul lipseste', () => {
    expect(extractFeatures(baseAnalysis({ flashFired: true })).flashFired).toBe(1);
    expect(extractFeatures(baseAnalysis({ flashFired: false })).flashFired).toBe(0);
    expect(extractFeatures(baseAnalysis()).flashFired).toBe(0);
  });

  it('recunoaste ca fotograful a umblat pe setari', () => {
    expect(extractFeatures(baseAnalysis({ exposureBias: -1 })).deliberateSettings).toBe(1);
    expect(extractFeatures(baseAnalysis({ whiteBalance: 'manual' })).deliberateSettings).toBe(1);
    // compensarea zero (sau microscopica) nu e o interventie
    expect(extractFeatures(baseAnalysis({ exposureBias: 0, whiteBalance: 'auto' })).deliberateSettings).toBe(0);
    expect(extractFeatures(baseAnalysis()).deliberateSettings).toBe(0);
  });
});

/**
 * Bug real gasit de auditul QA — vezi comentariile lungi de la normalize() si
 * updateWeight() in ContextEngine.ts. Rezumat: o singura valoare ne-finita
 * (feature corupt) sau o singura pondere ne-finita (model restaurat dintr-un
 * backup editat/trunchiat, pe care restoreBackup il scrie verbatim cu bulkPut
 * fara nicio validare) transforma `aiScore` in NaN — iar `aiScore` e camp
 * INDEXAT in db.analyses, unde NaN nu e o cheie valida: inregistrarea dispare
 * tacut din index, deci readLibraryScores()/deriveThresholds n-o mai vad, si
 * decidePhotoStatus(NaN) blocheaza poza in 'review' pentru orice prag.
 */
describe('ContextEngine — o valoare/pondere corupta nu mai otraveste tot scorul', () => {
  it('un feature NaN devine neutru, restul pozei se scoreaza normal', async () => {
    const engine = new ContextEngine();
    const corrupt = await engine.predict(baseAnalysis({ photoId: 'nan', sharpness: NaN }));
    expect(Number.isFinite(corrupt.score)).toBe(true);
    expect(corrupt.score).toBeGreaterThanOrEqual(0);
    expect(corrupt.score).toBeLessThanOrEqual(100);
    expect(corrupt.topFactors.every(f => Number.isFinite(f.contribution))).toBe(true);
  });

  it('un feature Infinity e tratat la fel (neutru), nu ca un maxim absolut', async () => {
    const engine = new ContextEngine();
    const infinite = await engine.predict(baseAnalysis({ photoId: 'inf', exposure: Infinity }));
    expect(Number.isFinite(infinite.score)).toBe(true);
  });

  it('nu contamineaza permanent statisticile contextului (poza URMATOARE, curata, se scoreaza ca inainte)', async () => {
    const clean = new ContextEngine();
    const reference = await clean.predict(baseAnalysis({ photoId: 'ref' }));

    const poisoned = new ContextEngine();
    await poisoned.recordCorrection({
      photoId: 'nan', analysis: baseAnalysis({ sharpness: NaN }), aiDecision: true, userDecision: true
    });
    const after = await poisoned.predict(baseAnalysis({ photoId: 'ref' }));

    expect(Number.isFinite(after.score)).toBe(true);
    // un singur pas de antrenare misca scorul putin, dar nu-l scoate din scala
    expect(Math.abs(after.score - reference.score)).toBeLessThan(25);
  });

  it('updateWeight readuce pe ancora o pondere deja ne-finita, in loc s-o lase NaN pe veci', () => {
    expect(updateWeight(NaN, 0.1, 0.3, priorAnchor('sharpness'))).toBe(priorAnchor('sharpness'));
    expect(updateWeight(Infinity, 0.1, 0.3, priorAnchor('negativeSpace'))).toBe(priorAnchor('negativeSpace'));
    // comportamentul pentru valori normale ramane neschimbat
    expect(updateWeight(0.5, 0.1, 0.3, 0.5)).toBeCloseTo(0.47, 5);
  });
});

/**
 * Bug real gasit de auditul QA — vezi ContextEngine.repair(). Validarea din
 * core/backupService.ts opreste scrierile NOI de modele stricate, dar nu repara
 * bazele utilizatorilor care au restaurat un backup trunchiat INAINTE de acel
 * fix: inregistrarea stricata traieste in IndexedDB, deci `model.weights[k]` pe
 * un `weights` undefined arunca la fiecare poza scorata, la nesfarsit, si nici
 * reload-ul paginii nici reimportul pozelor n-o repara.
 */
describe('ContextEngine — model deja corupt in IndexedDB se repara la citire', () => {
  it('scoreaza normal un context al carui model si-a pierdut `weights` (inainte: TypeError la fiecare poza)', async () => {
    await db.contextModels.clear();
    await db.contextModels.put({ contextKey: 'landscape' } as unknown as Parameters<typeof db.contextModels.put>[0]);

    const engine = new ContextEngine();
    const prediction = await engine.predict(baseAnalysis({ photoId: 'x' }));

    expect(Number.isFinite(prediction.score)).toBe(true);
    expect(prediction.contextKey).toBe('landscape');
  });

  it('repara si `featureStats`/`bias`/`sampleCount` lipsa sau de tip gresit', async () => {
    await db.contextModels.clear();
    await db.contextModels.put({
      contextKey: 'landscape', weights: { sharpness: 0.9 }, bias: 'zero', sampleCount: -5
    } as unknown as Parameters<typeof db.contextModels.put>[0]);

    const engine = new ContextEngine();
    const prediction = await engine.predict(baseAnalysis({ photoId: 'x' }));

    expect(Number.isFinite(prediction.score)).toBe(true);
    expect(prediction.confidence).toBe('cold'); // sampleCount negativ readus la 0
  });

  it('nu atinge un model VALID (ponderile invatate raman exact cum erau)', async () => {
    await db.contextModels.clear();
    await db.contextModels.put({
      contextKey: 'landscape', weights: { sharpness: 0.42 },
      featureStats: { sharpness: { mean: 0.6, m2: 0.2, n: 10 } },
      bias: 0.3, sampleCount: 50, updatedAt: 1
    });

    const engine = new ContextEngine();
    await engine.predict(baseAnalysis({ photoId: 'x' }));
    const summaries = await engine.summarize();
    const landscape = summaries.find(s => s.contextKey === 'landscape')!;

    expect(landscape.sampleCount).toBe(50);
    expect(landscape.allWeights.find(w => w.feature === 'sharpness')?.weight).toBe(0.42);
  });
});

describe('ce NU stie motorul nu trebuie sa conteze impotriva pozei', () => {
  const cuOameni = baseAnalysis({
    photoId: 'familie', faceCount: 2, knownFaceCount: 0, strangerCount: 2,
    faces: [
      { box: [0.2, 0.2, 0.2, 0.3], faceScore: 0.9, smile: 0.8, eyesOpen: { left: 1, right: 1 }, isBlinking: false, personId: null, personName: null, similarity: 0 },
      { box: [0.6, 0.2, 0.2, 0.3], faceScore: 0.9, smile: 0.8, eyesOpen: { left: 1, right: 1 }, isBlinking: false, personId: null, personName: null, similarity: 0 }
    ]
  });

  it('cat timp nu e inrolat nimeni, "cine e in poza" lipseste din vector, nu apasa in jos', () => {
    // Bug real: knownFaceCount e 0 si strangerCount egal cu numarul de fete pe
    // ORICE poza cat timp utilizatorul n-a inrolat pe nimeni — nu pentru ca ar
    // fi straini, ci pentru ca aplicatia n-are cum sa stie. Tratate ca straini,
    // scadeau scorul fiecarei poze cu oameni, exact la utilizatorii noi.
    const faraNimeniInrolat = extractFeatures(cuOameni, undefined, false);
    expect(faraNimeniInrolat.knownFaceRatio).toBeUndefined();
    expect(faraNimeniInrolat.strangerPenalty).toBeUndefined();
  });

  it('de indata ce exista cineva inrolat, cele doua semnale revin', () => {
    const cuCinevaInrolat = extractFeatures(cuOameni, undefined, true);
    expect(cuCinevaInrolat.knownFaceRatio).toBe(0);
    expect(cuCinevaInrolat.strangerPenalty).toBe(1);
  });

  it('restul semnalelor despre fete raman neatinse in ambele cazuri', () => {
    const fara = extractFeatures(cuOameni, undefined, false);
    const cu = extractFeatures(cuOameni, undefined, true);
    for (const k of ['bestSmile', 'allEyesOpen', 'faceCount', 'faceScore'] as const) {
      expect(fara[k]).toBe(cu[k]);
    }
  });

  it('implicit se comporta ca inainte — apelantii care nu stiu de parametru nu se schimba', () => {
    expect(extractFeatures(cuOameni).strangerPenalty).toBe(1);
  });
});

describe('invatarea din comparatii, nu din etichete', () => {
  /** Doua cadre ale aceleiasi clipe: difera la claritate, identice in rest. */
  function rafala() {
    const comun = {
      faceCount: 1, knownFaceCount: 0, strangerCount: 1, allEyesOpen: true,
      bestSmile: 0.7, exposure: 50, sceneType: 'portrait' as const,
      cameraMake: 'Xiaomi', iso: 400
    };
    return {
      bun: baseAnalysis({ photoId: 'bun', sharpness: 88, ...comun }),
      slab: baseAnalysis({ photoId: 'slab', sharpness: 42, ...comun })
    };
  }

  it('dupa cateva serii, cadrul clar e prezis mai sus decat cel moale', async () => {
    const engine = new ContextEngine();
    const { bun, slab } = rafala();
    const inainte = (await engine.predict(bun)).score - (await engine.predict(slab)).score;
    for (let i = 0; i < 6; i++) {
      await engine.recordPreference({ winner: { photoId: 'bun', analysis: bun }, losers: [{ photoId: 'slab', analysis: slab }], genre: 'test-directie' });
    }
    const dupa = (await engine.predict(bun)).score - (await engine.predict(slab)).score;
    expect(dupa).toBeGreaterThanOrEqual(inainte);
  });

  it('NU muta pragul absolut — o comparatie nu spune de la cat in sus merita pastrata o poza', async () => {
    const engine = new ContextEngine();
    const { bun, slab } = rafala();
    await engine.recordPreference({ winner: { photoId: 'bun', analysis: bun }, losers: [{ photoId: 'slab', analysis: slab }], genre: 'test-bias' });
    const model = await db.contextModels.get(deriveContextKey(bun, 'test-bias'));
    expect(model?.bias).toBe(0);
  });

  it('nu atinge trasaturile identice intre cele doua cadre', async () => {
    // Acelasi aparat in ambele poze: alegerea n-a avut nicio legatura cu el.
    const engine = new ContextEngine();
    const { bun, slab } = rafala();
    await engine.recordPreference({ winner: { photoId: 'bun', analysis: bun }, losers: [{ photoId: 'slab', analysis: slab }], genre: 'test-identice' });
    const model = await db.contextModels.get(deriveContextKey(bun, 'test-identice'));
    expect(model?.weights.isoPenalty).toBe(priorAnchor('isoPenalty'));
    expect(model?.weights.noCameraMetadata).toBe(priorAnchor('noCameraMetadata'));
  });

  it('o serie rezolvata = O decizie, oricate cadre ar avea', async () => {
    const engine = new ContextEngine();
    const { bun, slab } = rafala();
    const alt = baseAnalysis({ photoId: 'alt', sharpness: 50, faceCount: 1 });
    await engine.recordPreference({
      winner: { photoId: 'bun', analysis: bun },
      losers: [{ photoId: 'slab', analysis: slab }, { photoId: 'alt', analysis: alt }],
      genre: 'test-numarare'
    });
    const model = await db.contextModels.get(deriveContextKey(bun, 'test-numarare'));
    // doua perechi, dar o singura decizie de-a omului
    expect(model?.sampleCount).toBe(1);
  });

  it('fara pierzatori nu are ce invata', async () => {
    const engine = new ContextEngine();
    const { bun } = rafala();
    await engine.recordPreference({ winner: { photoId: 'bun', analysis: bun }, losers: [], genre: 'test-gol' });
    expect(await db.contextModels.get(deriveContextKey(bun, 'test-gol'))).toBeUndefined();
  });
});
