import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FaceAnalysisService as FaceAnalysisServiceType } from './faceAnalysis.worker';
import type { blendSubjectSharpness as blendSubjectSharpnessType } from './faceAnalysis.worker';
import type { regionLaplacianVariance as regionLaplacianVarianceType } from './faceAnalysis.worker';
import type { varianceToSharpnessScore as varianceToSharpnessScoreType } from './faceAnalysis.worker';

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
beforeEach(async () => {
  ({ FaceAnalysisService, blendSubjectSharpness, regionLaplacianVariance, varianceToSharpnessScore } =
    await import('./faceAnalysis.worker'));
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
