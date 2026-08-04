import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FaceAnalysisService as FaceAnalysisServiceType } from './faceAnalysis.worker';
import type { blendSubjectSharpness as blendSubjectSharpnessType } from './faceAnalysis.worker';
import type { regionLaplacianVariance as regionLaplacianVarianceType } from './faceAnalysis.worker';
import type { varianceToSharpnessScore as varianceToSharpnessScoreType } from './faceAnalysis.worker';
import type { detectSymmetry as detectSymmetryType } from './faceAnalysis.worker';
import type { negativeSpaceScore as negativeSpaceScoreType } from './faceAnalysis.worker';
import type { analyzeColor as analyzeColorType } from './faceAnalysis.worker';
import type { scoreFocusAndBokeh as scoreFocusAndBokehType } from './faceAnalysis.worker';
import type { mainObjectBox as mainObjectBoxType } from './faceAnalysis.worker';
import type { isAwkwardExpression as isAwkwardExpressionType } from './faceAnalysis.worker';
import type { isGenuineSmile as isGenuineSmileType } from './faceAnalysis.worker';
import type { computeGroupGenuineSmileRatio as computeGroupGenuineSmileRatioType } from './faceAnalysis.worker';
import type { detectCatchlight as detectCatchlightType } from './faceAnalysis.worker';
import type { hasNaturalSkinTone as hasNaturalSkinToneType } from './faceAnalysis.worker';
import type { FaceInsight } from '../core/db';
import type { ObjectResult } from '@vladmandic/human';

/**
 * Regression pentru bug-ul real raportat (nu doar sandbox): pe unele telefoane,
 * atat WebGPU cat si WebGL raman blocate la infinit in load()/warmup() (fara
 * sa arunce nicio eroare), ceea ce inainte de aceasta cascada bloca definitiv
 * init() — deci intreg pipeline-ul de import ("Se incarca modelele AI" la
 * nesfarsit). Mock-uim @vladmandic/human ca sa simulam exact acest scenariu
 * fara sa astept aducem modele reale (lent/nedeterminist intr-un test).
 */
vi.mock('@vladmandic/human', () => {
  class MockHuman {
    private backendName = 'unknown';
    tf = { getBackend: () => this.backendName };
    constructor(private config: { backend?: string }) {}
    async load(): Promise<void> {
      if (this.config.backend === 'cpu') { this.backendName = 'cpu'; return; }
      // webgpu/webgl: simuleaza blocajul real raportat — nu se rezolva niciodata
      await new Promise<void>(() => {});
    }
    async warmup(): Promise<void> {}
  }
  return { Human: MockHuman };
});

// jsdom nu implementeaza OffscreenCanvas (folosit doar pentru statistici
// aditionale, complet neatinse de acest test) — stub minimal, doar ca modulul
// sa se poata incarca fara sa arunce la constructia serviciului.
class StubOffscreenCanvas {
  constructor(public width: number, public height: number) {}
  getContext() { return null; }
}
vi.stubGlobal('OffscreenCanvas', StubOffscreenCanvas);

let FaceAnalysisService: typeof FaceAnalysisServiceType;
let blendSubjectSharpness: typeof blendSubjectSharpnessType;
let regionLaplacianVariance: typeof regionLaplacianVarianceType;
let varianceToSharpnessScore: typeof varianceToSharpnessScoreType;
let detectSymmetry: typeof detectSymmetryType;
let negativeSpaceScore: typeof negativeSpaceScoreType;
let analyzeColor: typeof analyzeColorType;
let scoreFocusAndBokeh: typeof scoreFocusAndBokehType;
let mainObjectBox: typeof mainObjectBoxType;
let isAwkwardExpression: typeof isAwkwardExpressionType;
let isGenuineSmile: typeof isGenuineSmileType;
let computeGroupGenuineSmileRatio: typeof computeGroupGenuineSmileRatioType;
let detectCatchlight: typeof detectCatchlightType;
let hasNaturalSkinTone: typeof hasNaturalSkinToneType;
beforeEach(async () => {
  ({
    FaceAnalysisService, blendSubjectSharpness, regionLaplacianVariance, varianceToSharpnessScore,
    detectSymmetry, negativeSpaceScore, analyzeColor, scoreFocusAndBokeh, mainObjectBox, isAwkwardExpression,
    isGenuineSmile, computeGroupGenuineSmileRatio, detectCatchlight, hasNaturalSkinTone
  } = await import('./faceAnalysis.worker'));
});

describe('FaceAnalysisService.init — cascada WebGPU -> WebGL -> CPU', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    Reflect.deleteProperty(navigator, 'gpu');
  });

  it('cade pe backend CPU (fara sa ramana blocat) daca WebGPU si WebGL raman ambele blocate la infinit', async () => {
    Object.defineProperty(navigator, 'gpu', { value: {}, configurable: true });
    const service = new FaceAnalysisService();

    const initPromise = service.init();
    // avanseaza peste timeout-ul WebGPU (6s) + timeout-ul WebGL (20s)
    await vi.advanceTimersByTimeAsync(30000);
    const backend = await initPromise;

    expect(backend).toBe('cpu');
  });

  it('foloseste direct CPU (fara sa incerce WebGPU) cand navigator.gpu nu exista', async () => {
    const service = new FaceAnalysisService();

    const initPromise = service.init();
    await vi.advanceTimersByTimeAsync(30000);
    const backend = await initPromise;

    expect(backend).toBe('cpu');
  });

  it('cu forcedBackend, foloseste direct backend-ul indicat, fara cascada completa (evita detectie redundanta pe workeri multipli)', async () => {
    const service = new FaceAnalysisService();

    // 'cpu' rezolva instant in mock — proba ca forcedBackend sare direct la acel
    // backend, fara sa mai astepte intai timeout-urile WebGPU/WebGL din cascada completa
    const backend = await service.init(undefined, undefined, 'cpu');

    expect(backend).toBe('cpu');
  });

  it('cu forcedBackend care esueaza, cade tot pe CPU ca refugiu final', async () => {
    const service = new FaceAnalysisService();

    const initPromise = service.init(undefined, undefined, 'webgl');
    // fara timeout scurt dedicat pentru forcedBackend (foloseste WEBGL_INIT_TIMEOUT_MS = 20s)
    await vi.advanceTimersByTimeAsync(20000);
    const backend = await initPromise;

    expect(backend).toBe('cpu');
  });
});

describe('varianceToSharpnessScore', () => {
  it('maps variance 0 to score 0', () => {
    expect(varianceToSharpnessScore(0)).toBe(0);
  });

  it('clamps negative variance (should not happen in practice) to 0, not a negative score', () => {
    expect(varianceToSharpnessScore(-5)).toBe(0);
  });

  it('clamps large variance at 100', () => {
    expect(varianceToSharpnessScore(10000)).toBe(100);
  });

  it('matches the exact scaling used by the whole-frame sharpness score (sqrt(variance) * 2.2)', () => {
    expect(varianceToSharpnessScore(100)).toBe(22); // sqrt(100)=10, 10*2.2=22
  });
});

describe('blendSubjectSharpness', () => {
  it('falls back to the global (whole-frame) score when no subject region was measurable (no faces / region too small)', () => {
    expect(blendSubjectSharpness(undefined, 55)).toBe(55);
  });

  it('weighs the subject (face) region at 70% and the global frame at 30%', () => {
    // sharp face (80) on a busy/textured background (50, e.g. detailed foliage) ->
    // should score MUCH closer to the face's own sharpness than a naive average would
    expect(blendSubjectSharpness(80, 50)).toBe(71); // round(0.7*80 + 0.3*50) = round(71)
  });

  it('rewards intentional bokeh (sharp subject, deliberately blurred background) instead of penalizing it', () => {
    const sharpSubjectBlurryBg = blendSubjectSharpness(/* subject */ 90, /* global, dragged down by bokeh */ 30);
    const naiveGlobalOnly = 30; // what the OLD (whole-frame-only) sharpness would have scored this photo
    expect(sharpSubjectBlurryBg).toBeGreaterThan(naiveGlobalOnly);
  });
});

/**
 * regionLaplacianVariance() alimenteaza atat bokehQuality/subjectInFocus (deja
 * existente), cat si noul blendSubjectSharpness — testat direct, cu date
 * sintetice (fara nevoie de imagini reale/Canvas). Grile OMOGENE (o singura
 * valoare/tipar pe tot cadrul, mascate integral) — nu doua regiuni alaturate,
 * ca sa nu "contamineze" masuratoarea de la granita (vecinii unui pixel de la
 * marginea unei regiuni ar apartine celeilalte regiuni, umflând artificial
 * varianta exact acolo unde masuram "plat").
 */
describe('regionLaplacianVariance', () => {
  const W = 12, H = 12;
  function flatGrid(): { gray: Float32Array; mask: Uint8Array } {
    return { gray: new Float32Array(W * H).fill(128), mask: new Uint8Array(W * H).fill(1) };
  }
  function checkerboardGrid(): { gray: Float32Array; mask: Uint8Array } {
    const gray = new Float32Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) gray[y * W + x] = (x + y) % 2 === 0 ? 0 : 255;
    return { gray, mask: new Uint8Array(W * H).fill(1) };
  }

  it('returns exactly 0 variance for a perfectly flat region (no local contrast anywhere)', () => {
    const { gray, mask } = flatGrid();
    expect(regionLaplacianVariance(gray, W, H, mask, true)).toBe(0);
  });

  it('returns high variance for a high-frequency checkerboard region', () => {
    const { gray: flatGray, mask: flatMask } = flatGrid();
    const { gray: checkerGray, mask: checkerMask } = checkerboardGrid();
    const flat = regionLaplacianVariance(flatGray, W, H, flatMask, true);
    const checkerboard = regionLaplacianVariance(checkerGray, W, H, checkerMask, true);
    expect(checkerboard).toBeGreaterThan(flat);
  });

  it('the inside/outside mask actually filters pixels — an all-excluded mask leaves nothing to measure', () => {
    const { gray } = checkerboardGrid();
    const nothingMasked = new Uint8Array(W * H); // toti 0 -> "inside" (mask===1) nu selecteaza niciun pixel
    expect(regionLaplacianVariance(gray, W, H, nothingMasked, true)).toBe(-1);
  });

  it('returns -1 when the masked region has too few pixels for a stable measurement', () => {
    const gray = new Float32Array(9); // grila 3x3 -> bucla interioara (fara margine) are un singur pixel
    const mask = new Uint8Array(9).fill(1);
    expect(regionLaplacianVariance(gray, 3, 3, mask, true)).toBe(-1);
  });
});

describe('detectSymmetry', () => {
  const W = 32, H = 32;

  it('detects a perfect left-right mirror (correlation exactly 1)', () => {
    const mag = new Float32Array(W * H);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W / 2; x++) {
        const v = (x * 7 + y * 3) % 50; // orice tipar variat, atat timp cat e IDENTIC in oglinda
        mag[y * W + x] = v;
        mag[y * W + (W - 1 - x)] = v;
      }
    }
    expect(detectSymmetry(mag, W, H)).toBe(true);
  });

  it('returns false (via the denominator guard) when one side has no measurable energy at all', () => {
    const mag = new Float32Array(W * H);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W / 2; x++) mag[y * W + x] = (x * 7 + y * 3) % 50; // stanga are muchii, dreapta ramane 0
    }
    expect(detectSymmetry(mag, W, H)).toBe(false);
  });
});

describe('negativeSpaceScore', () => {
  const W = 40, H = 40; // divizibil exact la grila 10x10 folosita intern

  it('scores a perfectly flat frame as all-negative-space (every block has zero variance)', () => {
    const gray = new Float32Array(W * H).fill(128);
    expect(negativeSpaceScore(gray, W, H)).toBe(1);
  });

  it('scores a busy checkerboard frame as having no negative space (every block has high variance)', () => {
    const gray = new Float32Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) gray[y * W + x] = (x + y) % 2 === 0 ? 0 : 255;
    expect(negativeSpaceScore(gray, W, H)).toBe(0);
  });
});

describe('analyzeColor', () => {
  function solidImage(w: number, h: number, [r, g, b]: [number, number, number]): ImageData {
    const data = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) { data[i * 4] = r; data[i * 4 + 1] = g; data[i * 4 + 2] = b; data[i * 4 + 3] = 255; }
    return { data, width: w, height: h, colorSpace: 'srgb' } as ImageData;
  }

  it('treats a near-gray (low-saturation) frame as harmonious by convention, with no dominant colors', () => {
    const result = analyzeColor(solidImage(8, 8, [128, 128, 128]), 50);
    expect(result.colorHarmonyScore).toBe(0.85);
    expect(result.dominantColors).toEqual([]);
    expect(result.goldenHourDetected).toBe(false);
  });

  it('scores a single saturated hue as maximally harmonious, with exactly one dominant color', () => {
    const result = analyzeColor(solidImage(8, 8, [255, 0, 0]), 50);
    expect(result.colorHarmonyScore).toBe(1);
    expect(result.dominantColors).toHaveLength(1);
  });

  it('detects golden-hour lighting for a warm, saturated, mid-exposure frame', () => {
    const result = analyzeColor(solidImage(8, 8, [230, 150, 60]), 50); // portocaliu cald, hue ~32°
    expect(result.goldenHourDetected).toBe(true);
  });

  it('does not flag golden hour for a cool-toned frame, even at the same exposure/saturation', () => {
    const result = analyzeColor(solidImage(8, 8, [60, 80, 230]), 50); // albastru, hue ~233°
    expect(result.goldenHourDetected).toBe(false);
  });
});

describe('scoreFocusAndBokeh', () => {
  const W = 40, H = 40;
  function face(box: [number, number, number, number]): FaceInsight {
    return { box, faceScore: 0.9, smile: 0, eyesOpen: { left: 1, right: 1 }, isBlinking: false, personId: null, personName: null, similarity: 0 };
  }
  function fillBox(gray: Float32Array, box: [number, number, number, number], pattern: 'checkerboard' | 'flat') {
    const [bx, by, bw, bh] = box;
    const x0 = Math.round(bx * W), y0 = Math.round(by * H), x1 = Math.round((bx + bw) * W), y1 = Math.round((by + bh) * H);
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) gray[y * W + x] = pattern === 'checkerboard' ? ((x + y) % 2 === 0 ? 0 : 255) : 128;
  }

  it('returns bokehQuality "n/a" with no subject data when there are no faces', () => {
    const gray = new Float32Array(W * H).fill(128);
    expect(scoreFocusAndBokeh(gray, W, H, [])).toEqual({ bokehQuality: 'n/a' });
  });

  it('returns bokehQuality "n/a" when the face box is too small for a stable measurement', () => {
    const gray = new Float32Array(W * H).fill(128);
    const result = scoreFocusAndBokeh(gray, W, H, [face([0.48, 0.48, 0.02, 0.02])]);
    expect(result.bokehQuality).toBe('n/a');
    expect(result.subjectInFocus).toBeUndefined();
  });

  it('detects good bokeh: a sharp subject against a smooth, out-of-focus background', () => {
    const gray = new Float32Array(W * H).fill(128); // fundal plat (bgVar ~0)
    fillBox(gray, [0.25, 0.25, 0.5, 0.5], 'checkerboard'); // subiect ascutit
    const result = scoreFocusAndBokeh(gray, W, H, [face([0.25, 0.25, 0.5, 0.5])]);
    expect(result.subjectInFocus).toBe(true);
    expect(result.bokehQuality).toBe('good');
  });

  it('detects poor bokeh: the background is just as busy as the subject (no separation)', () => {
    const gray = new Float32Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) gray[y * W + x] = (x + y) % 2 === 0 ? 0 : 255; // acelasi tipar peste tot
    const result = scoreFocusAndBokeh(gray, W, H, [face([0.25, 0.25, 0.5, 0.5])]);
    expect(result.bokehQuality).toBe('poor');
  });

  it('does not judge bokeh when the subject itself is out of focus (background sharpness is irrelevant then)', () => {
    const gray = new Float32Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) gray[y * W + x] = (x + y) % 2 === 0 ? 0 : 255; // fundal ascutit
    // zona plata trebuie sa fie mai mare decat cutia fetei propriu-zisa — altfel
    // Laplacianul de la granita cutiei "vede" vecinii din checkerboard-ul de
    // afara si umfla artificial variatia masurata STRICT in interiorul cutiei
    // (acelasi motiv pentru care testele de mai sus pentru regionLaplacianVariance
    // folosesc grile OMOGENE, nu doua regiuni alaturate)
    fillBox(gray, [0.15, 0.15, 0.7, 0.7], 'flat');
    const result = scoreFocusAndBokeh(gray, W, H, [face([0.25, 0.25, 0.5, 0.5])]);
    expect(result.subjectInFocus).toBe(false);
    expect(result.bokehQuality).toBe('n/a');
  });

  it('judges focus/bokeh on the CenterNet object box when there are no faces (macro/product/animal shots)', () => {
    const gray = new Float32Array(W * H).fill(128); // fundal plat (bgVar ~0)
    fillBox(gray, [0.25, 0.25, 0.5, 0.5], 'checkerboard'); // "subiectul" — o floare, un caine etc.
    const result = scoreFocusAndBokeh(gray, W, H, [], [0.25, 0.25, 0.5, 0.5]);
    expect(result.subjectInFocus).toBe(true);
    expect(result.bokehQuality).toBe('good');
  });

  it('still returns "n/a" with no faces AND no usable object box', () => {
    const gray = new Float32Array(W * H).fill(128);
    expect(scoreFocusAndBokeh(gray, W, H, [], undefined)).toEqual({ bokehQuality: 'n/a' });
  });
});

describe('mainObjectBox', () => {
  function obj(score: number, box: [number, number, number, number]): ObjectResult {
    return { id: 0, score, class: 0, label: 'dog', box, boxRaw: box };
  }

  it('returns undefined when there are no objects', () => {
    expect(mainObjectBox([])).toBeUndefined();
  });

  it('ignores low-confidence and tiny detections', () => {
    expect(mainObjectBox([obj(0.2, [0.1, 0.1, 0.5, 0.5])])).toBeUndefined(); // sub prag de incredere
    expect(mainObjectBox([obj(0.9, [0.1, 0.1, 0.05, 0.05])])).toBeUndefined(); // prea mic (0.25% din cadru)
  });

  it('picks the largest qualifying object, not merely the most confident one', () => {
    const small = obj(0.95, [0.1, 0.1, 0.2, 0.2]);   // incredere mare, dar mic (4% din cadru)
    const large = obj(0.4, [0.1, 0.1, 0.6, 0.6]);    // incredere mai mica, dar domina cadrul (36%)
    expect(mainObjectBox([small, large])).toEqual(large.boxRaw);
  });
});

describe('isAwkwardExpression', () => {
  function face(overrides: Partial<FaceInsight> = {}): FaceInsight {
    return {
      box: [0, 0, 0.1, 0.1], faceScore: 0.9, smile: 0, eyesOpen: { left: 1, right: 1 },
      isBlinking: false, personId: null, personName: null, similarity: 0, ...overrides
    };
  }

  it('is false when the mouth is closed, regardless of emotion', () => {
    expect(isAwkwardExpression(face({ mouthOpen: false }))).toBe(false);
  });

  it('is false for an open mouth explained by a real smile', () => {
    expect(isAwkwardExpression(face({ mouthOpen: true, emotion: { happy: 0.8, surprise: 0, neutral: 0, negative: 0 } }))).toBe(false);
  });

  it('is false for an open mouth explained by genuine surprise', () => {
    expect(isAwkwardExpression(face({ mouthOpen: true, emotion: { happy: 0, surprise: 0.7, neutral: 0, negative: 0 } }))).toBe(false);
  });

  it('is true for an open mouth with neither smile nor surprise — a mid-speech/yawn moment', () => {
    expect(isAwkwardExpression(face({ mouthOpen: true, emotion: { happy: 0.05, surprise: 0.1, neutral: 0.8, negative: 0.05 } }))).toBe(true);
  });

  it('treats a missing emotion vector as neutral (0), not as an exemption', () => {
    expect(isAwkwardExpression(face({ mouthOpen: true }))).toBe(true);
  });
});

/**
 * Prag calibrat pe date reale (vezi GENUINE_SMILE_EYE_THRESHOLD in worker):
 * 90 de fete rulate prin Human.js real (backend WASM in Node, nu mock) au dat
 * eyeOpen mediu 0.657 pentru zambet autentic vs 0.873 pentru zambet fortat —
 * testele de mai jos fixeaza acel comportament calibrat, nu doar logica generala.
 */
describe('isGenuineSmile', () => {
  function face(overrides: Partial<FaceInsight> = {}): FaceInsight {
    return {
      box: [0, 0, 0.1, 0.1], faceScore: 0.9, smile: 0, eyesOpen: { left: 1, right: 1 },
      isBlinking: false, personId: null, personName: null, similarity: 0, ...overrides
    };
  }

  it('is false without a real smile, regardless of how narrowed the eyes are', () => {
    expect(isGenuineSmile(face({ smile: 0.1, eyesOpen: { left: 0.5, right: 0.5 } }))).toBe(false);
  });

  it('is false for a smile with wide-open eyes (the "fortat" pattern from calibration data)', () => {
    expect(isGenuineSmile(face({ smile: 0.8, eyesOpen: { left: 0.9, right: 0.9 } }))).toBe(false);
  });

  it('is true for a smile with narrowed eyes (the "autentic" pattern from calibration data)', () => {
    expect(isGenuineSmile(face({ smile: 0.8, eyesOpen: { left: 0.6, right: 0.6 } }))).toBe(true);
  });

  it('averages both eyes — one narrowed eye is not enough if the other stays wide open', () => {
    expect(isGenuineSmile(face({ smile: 0.8, eyesOpen: { left: 0.6, right: 1.0 } }))).toBe(false); // avg 0.8 > threshold
  });
});

describe('computeGroupGenuineSmileRatio', () => {
  function face(overrides: Partial<FaceInsight> = {}): FaceInsight {
    return {
      box: [0, 0, 0.1, 0.1], faceScore: 0.9, smile: 0.8, eyesOpen: { left: 0.6, right: 0.6 }, // genuine by default
      isBlinking: false, personId: null, personName: null, similarity: 0, ...overrides
    };
  }

  it('is undefined with no faces, regardless of light quality', () => {
    expect(computeGroupGenuineSmileRatio([], 'soft')).toBeUndefined();
  });

  it('computes the normal ratio in soft/mixed/unknown light', () => {
    const faces = [face(), face({ smile: 0.8, eyesOpen: { left: 0.95, right: 0.95 } })]; // 1 genuine, 1 not
    expect(computeGroupGenuineSmileRatio(faces, 'soft')).toBe(0.5);
    expect(computeGroupGenuineSmileRatio(faces, 'mixed')).toBe(0.5);
    expect(computeGroupGenuineSmileRatio(faces, 'unknown')).toBe(0.5);
  });

  // Bug real evitat inainte sa ajunga in productie: ochii ingustati intr-o lumina
  // puternica/directa (soare in fata) pot fi doar clipit, nu zambet autentic —
  // isGenuineSmile nu poate distinge, deci in lumina 'hard' nu facem nicio afirmatie.
  it('is undefined in harsh/direct light, even with faces that would otherwise look genuine', () => {
    const faces = [face(), face()]; // ambele "genuine" dupa geometrie
    expect(computeGroupGenuineSmileRatio(faces, 'hard')).toBeUndefined();
  });
});

describe('detectCatchlight', () => {
  function grayImage(size: number, level: number): ImageData {
    const data = new Uint8ClampedArray(size * size * 4);
    for (let i = 0; i < size * size; i++) { data[i * 4] = level; data[i * 4 + 1] = level; data[i * 4 + 2] = level; data[i * 4 + 3] = 255; }
    return { data, width: size, height: size, colorSpace: 'srgb' } as ImageData;
  }
  function withBrightSpot(size: number, baseLevel: number, spotLevel: number, cx: number, cy: number): ImageData {
    const img = grayImage(size, baseLevel);
    const idx = (cy * size + cx) * 4;
    img.data[idx] = spotLevel; img.data[idx + 1] = spotLevel; img.data[idx + 2] = spotLevel;
    return img;
  }

  it('detects a small, localized bright spot against a dark iris/pupil (a real catchlight)', () => {
    expect(detectCatchlight(withBrightSpot(16, 40, 255, 8, 8))).toBe(true);
  });

  it('does not flag a uniformly dark eye (no light source reflected)', () => {
    expect(detectCatchlight(grayImage(16, 40))).toBe(false);
  });

  it('does not flag a uniformly bright/overexposed crop — brightness alone is not a catchlight', () => {
    expect(detectCatchlight(grayImage(16, 230))).toBe(false);
  });

  it('does not flag a moderately bright spot that is not bright enough in absolute terms', () => {
    expect(detectCatchlight(withBrightSpot(16, 40, 180, 8, 8))).toBe(false); // sub pragul absolut de 200
  });
});

describe('hasNaturalSkinTone', () => {
  function solidBoxImage(size: number, [r, g, b]: [number, number, number]): ImageData {
    const data = new Uint8ClampedArray(size * size * 4);
    for (let i = 0; i < size * size; i++) { data[i * 4] = r; data[i * 4 + 1] = g; data[i * 4 + 2] = b; data[i * 4 + 3] = 255; }
    return { data, width: size, height: size, colorSpace: 'srgb' } as ImageData;
  }
  const FULL_BOX: [number, number, number, number] = [0, 0, 1, 1];

  it('accepts a warm skin-like hue (orange-ish), regardless of how light/dark it is', () => {
    expect(hasNaturalSkinTone(solidBoxImage(16, [200, 150, 120]), FULL_BOX)).toBe(true); // hue ~22°
    expect(hasNaturalSkinTone(solidBoxImage(16, [90, 65, 50]), FULL_BOX)).toBe(true); // ten inchis, acelasi hue
  });

  it('flags a green color cast (e.g. fluorescent lighting without white-balance compensation)', () => {
    expect(hasNaturalSkinTone(solidBoxImage(16, [150, 200, 150]), FULL_BOX)).toBe(false); // hue ~120°
  });

  it('flags a blue color cast (e.g. shade/tungsten without compensation)', () => {
    expect(hasNaturalSkinTone(solidBoxImage(16, [120, 150, 200]), FULL_BOX)).toBe(false); // hue ~218°
  });

  it('is undefined for a region too desaturated to give a reliable reading (not a false negative)', () => {
    expect(hasNaturalSkinTone(solidBoxImage(16, [128, 128, 128]), FULL_BOX)).toBeUndefined();
  });
});
