import { describe, it, expect, vi, beforeEach } from 'vitest';
import { computeWorkerCount } from './workerPool';

let nativePlatform = false;
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => nativePlatform, isPluginAvailable: () => true }
}));

const analyzeNativeMock = vi.fn();
vi.mock('./nativeAnalysis', () => ({
  analyzeNative: (...args: unknown[]) => analyzeNativeMock(...args)
}));

vi.mock('./performanceSettings', () => ({
  readEconomicMode: () => false,
  writeEconomicMode: () => {}
}));

describe('computeWorkerCount', () => {
  it('caps at 4 when deviceMemory is unknown (Firefox/Safari)', () => {
    expect(computeWorkerCount(8, undefined)).toBe(4);
    expect(computeWorkerCount(2, undefined)).toBe(1);
  });

  it('forces a single worker on low-RAM devices (<=4GB), matching the proven Honor 8X fix', () => {
    expect(computeWorkerCount(8, 4)).toBe(1);
    expect(computeWorkerCount(8, 2)).toBe(1);
  });

  it('keeps the old 4-worker cap on mid-range RAM (6GB)', () => {
    expect(computeWorkerCount(8, 6)).toBe(4);
    expect(computeWorkerCount(2, 6)).toBe(1);
  });

  it('allows up to 6 workers on high-RAM devices (8GB+)', () => {
    expect(computeWorkerCount(8, 8)).toBe(6);
    expect(computeWorkerCount(16, 16)).toBe(6);
  });

  it('never exceeds the core budget (cores - 1), regardless of RAM', () => {
    expect(computeWorkerCount(3, 8)).toBe(2);
    expect(computeWorkerCount(1, 8)).toBe(1);
  });
});

describe('AnalysisPool native mode (Capacitor Android)', () => {
  beforeEach(() => {
    nativePlatform = true;
    analyzeNativeMock.mockReset();
  });

  it('init() skips spawning Human.js workers entirely and reports the native backend', async () => {
    const { AnalysisPool } = await import('./workerPool');
    const pool = new AnalysisPool();
    // jsdom nu implementeaza Worker — daca init() ar cadea din greseala pe
    // calea web (spawnSlot -> new Worker(...)), acest test ar arunca singur.
    await pool.init();
    expect(pool.isReady).toBe(true);
    expect(pool.detectedBackend).toBe('native');
    expect(pool.isAccelerated).toBe(true);
    expect(pool.size).toBe(2);
  });

  it('analyze() routes to analyzeNative() and returns its result', async () => {
    const { AnalysisPool } = await import('./workerPool');
    const pool = new AnalysisPool();
    await pool.init();
    const fakeRecord = { photoId: 'p1', faces: [], faceCount: 0 };
    analyzeNativeMock.mockResolvedValueOnce(fakeRecord);
    const bitmap = {} as unknown as ImageBitmap;
    const result = await pool.analyze('p1', bitmap);
    expect(result).toBe(fakeRecord);
    // Al 3-lea arg (recognize) ramane undefined cand nu e nicio persoana
    // inrolata (this.knownPersons gol) — vezi gardul din analyze()/workerPool.ts.
    // Al 5-lea (mediaUri) e undefined aici: fara URI de galerie, analiza cade pe
    // calea cu blob, ca inainte.
    expect(analyzeNativeMock).toHaveBeenCalledWith('p1', bitmap, undefined, [], undefined);
  });

  // Bug real gasit de auditul QA: analyze() pe native nu trimitea niciodata un
  // callback de recunoastere catre analyzeNative() — persoanele inrolate erau
  // complet ignorate pe telefon (vezi recognitionSlot/computeFaceRecognitionEmbedding
  // mai jos in acest fisier pentru mecanismul propriu-zis).
  it('analyze() trimite un callback de recunoastere catre analyzeNative() cand exista persoane inrolate', async () => {
    const { AnalysisPool } = await import('./workerPool');
    const pool = new AnalysisPool();
    await pool.init();
    await pool.setKnownPersons([{ id: 'ami-id', name: 'Ami', embeddings: [[1, 0]], updatedAt: 0 }]);

    const fakeRecord = { photoId: 'p1', faces: [], faceCount: 0 };
    analyzeNativeMock.mockResolvedValueOnce(fakeRecord);
    const bitmap = {} as unknown as ImageBitmap;
    await pool.analyze('p1', bitmap);

    const [, , recognize, knownPersons] = analyzeNativeMock.mock.calls[0];
    expect(typeof recognize).toBe('function');
    expect(knownPersons).toEqual([{ id: 'ami-id', name: 'Ami', embeddings: [[1, 0]], updatedAt: 0 }]);
  });

  it('caps concurrent analyze() calls at the native concurrency limit (2)', async () => {
    const { AnalysisPool } = await import('./workerPool');
    const pool = new AnalysisPool();
    await pool.init();

    let inFlight = 0;
    let maxInFlight = 0;
    const resolvers: (() => void)[] = [];
    analyzeNativeMock.mockImplementation(() => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      return new Promise(resolve => {
        resolvers.push(() => { inFlight--; resolve({ photoId: 'x' }); });
      });
    });

    const bitmap = {} as unknown as ImageBitmap;
    const calls = [pool.analyze('a', bitmap), pool.analyze('b', bitmap), pool.analyze('c', bitmap)];
    await new Promise(r => setTimeout(r, 0)); // macrotask — dreneaza toate microtask-urile de acquire()
    expect(maxInFlight).toBe(2); // al treilea trebuie sa astepte, nu porneste imediat

    // Rezolva pe rand: eliberarea unui permis lasa a treia analiza sa porneasca
    // abia atunci (isi adauga propriul resolver dupa aceea) — o singura trecere
    // sincrona peste resolvers[] nu ar ajunge si la ea.
    for (let i = 0; i < 10 && resolvers.length > 0; i++) {
      resolvers.shift()?.();
      await new Promise(r => setTimeout(r, 0));
    }
    await Promise.all(calls);
    expect(maxInFlight).toBe(2);
  });

  it('resizeForEconomicMode() changes the concurrency limit safely even with an analysis in flight', async () => {
    const { AnalysisPool } = await import('./workerPool');
    const pool = new AnalysisPool();
    await pool.init();
    expect(pool.size).toBe(2);

    let release: (() => void) | undefined;
    analyzeNativeMock.mockImplementationOnce(() => new Promise(resolve => {
      release = () => resolve({ photoId: 'a' });
    }));
    const bitmap = {} as unknown as ImageBitmap;
    const first = pool.analyze('a', bitmap);
    await new Promise(r => setTimeout(r, 0));

    await pool.resizeForEconomicMode(true);
    expect(pool.size).toBe(1);

    release?.();
    await first;

    // dupa ce singura analiza in zbor s-a terminat, limita de 1 se respecta pentru urmatoarea
    analyzeNativeMock.mockResolvedValue({ photoId: 'b' });
    await pool.analyze('b', bitmap);
    expect(pool.size).toBe(1);
  });
});
