import { describe, it, expect, vi, beforeEach } from 'vitest';
import { computeWorkerCount, withTimeout } from './workerPool';

let nativePlatform = false;
/** Testul fixeaza un dispozitiv cu 6 nuclee: plafonul adaptiv nativ trebuie sa fie 3. */
const NATIVE_NORMAL_CONCURRENCY = 3;
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
    Object.defineProperty(navigator, 'hardwareConcurrency', { configurable: true, value: 6 });
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
    expect(pool.size).toBe(NATIVE_NORMAL_CONCURRENCY);
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

  it('caps concurrent analyze() calls at the adaptive native concurrency limit', async () => {
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
    const calls = Array.from({ length: NATIVE_NORMAL_CONCURRENCY + 1 }, (_, i) => pool.analyze(String.fromCharCode(97 + i), bitmap));
    await new Promise(r => setTimeout(r, 0)); // macrotask — dreneaza toate microtask-urile de acquire()
    expect(maxInFlight).toBe(NATIVE_NORMAL_CONCURRENCY); // urmatoarea poza trebuie sa astepte

    // Rezolva pe rand: eliberarea unui permis lasa a treia analiza sa porneasca
    // abia atunci (isi adauga propriul resolver dupa aceea) — o singura trecere
    // sincrona peste resolvers[] nu ar ajunge si la ea.
    for (let i = 0; i < 10 && resolvers.length > 0; i++) {
      resolvers.shift()?.();
      await new Promise(r => setTimeout(r, 0));
    }
    await Promise.all(calls);
    expect(maxInFlight).toBe(NATIVE_NORMAL_CONCURRENCY);
  });

  it('resizeForEconomicMode() changes the concurrency limit safely even with an analysis in flight', async () => {
    const { AnalysisPool } = await import('./workerPool');
    const pool = new AnalysisPool();
    await pool.init();
    expect(pool.size).toBe(NATIVE_NORMAL_CONCURRENCY);

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
  /**
   * Bug real gasit de auditul QA — vezi releaseNativePermit in workerPool.ts.
   * Testul de mai sus verifica doar cazul cu O SINGURA analiza in zbor, adica
   * exact cazul in care numarul in zbor scade oricum sub noul plafon; bug-ul
   * traia in celalalt caz — pool-ul SATURAT la vechiul plafon, cu poze deja in
   * coada, exact situatia unui import real de cateva sute de poze.
   */
  it('nu mai readmite din coada peste plafonul COBORAT la mijlocul unui import (mod economic pornit din mers)', async () => {
    const { AnalysisPool } = await import('./workerPool');
    const pool = new AnalysisPool();
    await pool.init();
    expect(pool.size).toBe(NATIVE_NORMAL_CONCURRENCY);

    const resolvers: (() => void)[] = [];
    let started = 0;
    analyzeNativeMock.mockImplementation(() => new Promise(resolve => {
      started++;
      resolvers.push(() => resolve({ photoId: 'x' }));
    }));

    const bitmap = {} as unknown as ImageBitmap;
    // Plafonul normal in zbor + doua poze in asteptare.
    const all = Array.from({ length: NATIVE_NORMAL_CONCURRENCY + 2 }, (_, i) => pool.analyze('p' + i, bitmap));
    await new Promise(r => setTimeout(r, 0));
    expect(started).toBe(NATIVE_NORMAL_CONCURRENCY);

    // utilizatorul comuta "mod economic" din meniu, cu importul in curs
    await pool.resizeForEconomicMode(true);
    expect(pool.size).toBe(1);

    // o analiza se termina: cu plafonul coborat la 1 si inca una in zbor,
    // NIMENI nu mai are voie sa porneasca (inainte pornea, si concurenta
    // ramanea blocata la 2 pana la finalul lotului)
    resolvers[0]();
    await new Promise(r => setTimeout(r, 0));
    expect(started).toBe(NATIVE_NORMAL_CONCURRENCY);

    // Cu inca doua analize in zbor, plafonul coborat la 1 nu permite readmiterea.
    resolvers[1]();
    await new Promise(r => setTimeout(r, 0));
    expect(started).toBe(NATIVE_NORMAL_CONCURRENCY);

    // Abia dupa ce se termina si a treia (0 in zbor < 1) porneste urmatoarea.
    resolvers[2]();
    await new Promise(r => setTimeout(r, 0));
    expect(started).toBe(NATIVE_NORMAL_CONCURRENCY + 1);

    while (resolvers.length) resolvers.shift()!();
    await new Promise(r => setTimeout(r, 0));
    while (resolvers.length) resolvers.shift()!();
    await Promise.all(all);
  });
});

/**
 * Bug real gasit de auditul QA — vezi `onAbandoned` in withTimeout().
 * Un timeout nu anuleaza promisiunea de dedesubt, doar inceteaza s-o astepte:
 * pentru createImageBitmap (importPipeline.decode / rawDecoder.decodeRawFile)
 * asta insemna un ImageBitmap de pana la ~16 MB pe care nimeni nu-l mai inchide.
 */
describe('withTimeout — resursa care soseste dupa timeout', () => {
  it('preda apelantului valoarea cand promisiunea castiga cursa (comportament neschimbat)', async () => {
    await expect(withTimeout(Promise.resolve('gata'), 1000, 'prea lent')).resolves.toBe('gata');
  });

  it('respinge cu mesajul dat cand timeout-ul castiga cursa', async () => {
    const slow = new Promise(resolve => setTimeout(() => resolve('tarziu'), 50));
    await expect(withTimeout(slow, 5, 'prea lent')).rejects.toThrow('prea lent');
  });

  it('inchide resursa sosita TARZIU, in loc s-o abandoneze (scurgerea de memorie reparata)', async () => {
    const closed: string[] = [];
    const lateBitmap = { id: 'b1', close: () => closed.push('b1') };
    const slow = new Promise<typeof lateBitmap>(resolve => setTimeout(() => resolve(lateBitmap), 20));

    await expect(withTimeout(slow, 5, 'prea lent', late => late.close())).rejects.toThrow('prea lent');
    expect(closed).toEqual([]); // inca n-a sosit

    await new Promise(r => setTimeout(r, 40));
    expect(closed).toEqual(['b1']); // sosita si inchisa, nu scursa
  });

  it('NU cheama carligul de curatenie cand valoarea a ajuns la apelant la timp', async () => {
    const closed: string[] = [];
    const bitmap = { close: () => closed.push('x') };
    await expect(withTimeout(Promise.resolve(bitmap), 1000, 'prea lent', late => late.close())).resolves.toBe(bitmap);
    await new Promise(r => setTimeout(r, 10));
    expect(closed).toEqual([]);
  });

  it('o eroare sosita dupa timeout nu mai produce o a doua respingere (fara unhandled rejection)', async () => {
    const slow = new Promise((_, reject) => setTimeout(() => reject(new Error('esec tarziu')), 20));
    await expect(withTimeout(slow, 5, 'prea lent')).rejects.toThrow('prea lent');
    await new Promise(r => setTimeout(r, 40)); // daca s-ar respinge a doua oara, ar iesi ca unhandled
  });

  it('un carlig care arunca nu strica respingerea deja livrata apelantului', async () => {
    const slow = new Promise(resolve => setTimeout(() => resolve('x'), 20));
    await expect(withTimeout(slow, 5, 'prea lent', () => { throw new Error('close a esuat'); })).rejects.toThrow('prea lent');
    await new Promise(r => setTimeout(r, 40));
  });
});
