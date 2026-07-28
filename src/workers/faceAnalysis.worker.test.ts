import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FaceAnalysisService as FaceAnalysisServiceType } from './faceAnalysis.worker';

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
beforeEach(async () => {
  ({ FaceAnalysisService } = await import('./faceAnalysis.worker'));
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
