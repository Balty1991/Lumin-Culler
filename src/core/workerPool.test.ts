import { describe, it, expect, vi, beforeEach } from 'vitest';
import { computeWorkerCount, withTimeout } from './workerPool';
import { THERMAL_THROTTLED_CONCURRENCY } from './thermalStatus';

let nativePlatform = false;
/** Testul fixeaza un dispozitiv cu 6 nuclee: plafonul adaptiv nativ trebuie sa fie 3. */
const NATIVE_NORMAL_CONCURRENCY = 3;
// registerPlugin: workerPool filtreaza acum persoanele active (vezi
// setKnownPersons), iar lantul ala trece prin entitlement.ts, care inregistreaza
// pluginul de facturare la incarcarea modulului.
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => nativePlatform, isPluginAvailable: () => true },
  registerPlugin: () => ({})
}));

const analyzeNativeMock = vi.fn();
vi.mock('./nativeAnalysis', () => ({
  analyzeNative: (...args: unknown[]) => analyzeNativeMock(...args)
}));

vi.mock('./performanceSettings', () => ({
  readEconomicMode: () => false,
  writeEconomicMode: () => {}
}));

/**
 * Ascultatorul termic, sub control: in jsdom pluginul nu exista, deci fara mock
 * `watchThermalStatus` nu cheama niciodata inapoi si treapta termica ar ramane
 * netestabila. `thermalConcurrencyCap` ramane cel adevarat — pragurile lui sunt
 * exact ce vrem sa verificam, nu ce vrem sa inlocuim.
 */
let emiteTermic: ((status: number | null) => void) | null = null;
vi.mock('./thermalStatus', async () => {
  const real = await vi.importActual<typeof import('./thermalStatus')>('./thermalStatus');
  return {
    ...real,
    watchThermalStatus: (cb: (status: number | null) => void) => {
      emiteTermic = cb;
      return Promise.resolve(() => { emiteTermic = null; });
    }
  };
});

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
    // Al 3-lea arg (recognize) se trimite MEREU, si fara nicio persoana
    // inrolata: embedding-urile faciale sunt semnalul de care are nevoie
    // gruparea ca sa spuna "acelasi om", iar aceea e o comparatie intre doua
    // poze, nu cu o referinta inrolata. Vezi analyze()/workerPool.ts.
    // Al 5-lea (mediaUri) e undefined aici: fara URI de galerie, analiza cade pe
    // calea cu blob, ca inainte.
    expect(analyzeNativeMock).toHaveBeenCalledWith('p1', bitmap, expect.any(Function), [], undefined);
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
/**
 * Cand telefonul se incalzeste, pool-ul chiar incetineste — dar pana acum o
 * facea in tacere, iar de pe ecran importul arata doar ca a devenit inexplicabil
 * mai lent. Semnalul de aici e ce transforma incetinirea intr-o explicatie.
 */
/**
 * Asteptarea la rand se masoara, si de-aia exista testul asta.
 *
 * `record('analysis')` din importPipeline porneste INAINTE de acest apel, deci
 * inainte de a exista etapa 'queue' timpul petrecut la coada intra in analiza
 * fara sa fie al nimanui — si iesea la scadere drept "puntea si lipiciul JS".
 * Pe un import real de 201 de poze acel reziduu arata 74%, adica exact numarul
 * care ar fi trimis munca de optimizare in partea gresita.
 */
describe('AnalysisPool — asteptarea la rand se masoara', () => {
  beforeEach(() => {
    nativePlatform = true;
    Object.defineProperty(navigator, 'hardwareConcurrency', { configurable: true, value: 6 });
    analyzeNativeMock.mockReset();
  });

  it('poza care asteapta un permis isi inregistreaza asteptarea in etapa ei', async () => {
    const { AnalysisPool } = await import('./workerPool');
    const { readStageStats, resetStageStats } = await import('./stageTiming');
    resetStageStats();
    const pool = new AnalysisPool();
    await pool.init();

    const eliberatori: (() => void)[] = [];
    analyzeNativeMock.mockImplementation(
      () => new Promise(resolve => eliberatori.push(() => resolve({ photoId: 'x' })))
    );
    const bitmap = {} as unknown as ImageBitmap;
    // Cu una peste plafon, ULTIMA chiar asteapta.
    const apeluri = Array.from({ length: NATIVE_NORMAL_CONCURRENCY + 1 }, (_, i) => pool.analyze(String(i), bitmap));
    await new Promise(r => setTimeout(r, 0));

    for (let i = 0; i < 10 && eliberatori.length > 0; i++) {
      eliberatori.shift()?.();
      await new Promise(r => setTimeout(r, 0));
    }
    await Promise.all(apeluri);

    const coada = readStageStats().find(st => st.stage === 'queue');
    expect(coada, "etapa 'queue' nu s-a inregistrat deloc").toBeTruthy();
    // Toate cele patru trec pe aici; cele dintai cu asteptare ~0, ultima cu ceva.
    expect(coada!.count).toBe(NATIVE_NORMAL_CONCURRENCY + 1);
  });
});

describe('AnalysisPool — anuntul de incalzire', () => {
  beforeEach(() => {
    nativePlatform = true;
    Object.defineProperty(navigator, 'hardwareConcurrency', { configurable: true, value: 6 });
    emiteTermic = null;
  });

  it('anunta cand plafonul termic chiar strange, cu ambele numere', async () => {
    const { AnalysisPool } = await import('./workerPool');
    const pool = new AnalysisPool();
    const anunturi: ({ cap: number; normal: number } | null)[] = [];
    pool.onThermalChange = info => anunturi.push(info);
    await pool.init();
    expect(emiteTermic).not.toBeNull();

    emiteTermic!(3); // treapta severa
    expect(anunturi).toHaveLength(1);
    expect(anunturi[0]).toEqual({ cap: THERMAL_THROTTLED_CONCURRENCY, normal: NATIVE_NORMAL_CONCURRENCY });
    // ...si plafonul chiar s-a aplicat, nu doar s-a anuntat.
    expect(pool.size).toBe(THERMAL_THROTTLED_CONCURRENCY);
  });

  it('la racire anunta ca s-a terminat, si redeschide plafonul', async () => {
    const { AnalysisPool } = await import('./workerPool');
    const pool = new AnalysisPool();
    const anunturi: ({ cap: number; normal: number } | null)[] = [];
    pool.onThermalChange = info => anunturi.push(info);
    await pool.init();

    emiteTermic!(3);
    emiteTermic!(0);
    expect(anunturi).toEqual([{ cap: THERMAL_THROTTLED_CONCURRENCY, normal: NATIVE_NORMAL_CONCURRENCY }, null]);
    expect(pool.size).toBe(NATIVE_NORMAL_CONCURRENCY);
  });

  /**
   * PONTAJUL termic, nu doar anuntul.
   *
   * Exista pentru o intrebare pusa de patru ori la rand pe acelasi lot de 200
   * de poze: importul a durat 6m22s, apoi 7m5s, cu modelele masurate la fel sau
   * mai rapide, si cu bateria la 27% in loc de 43%. Fara cifra, singurul
   * raspuns posibil era "probabil s-a incalzit" — adica exact genul de banuiala
   * care a iesit prost de trei ori pe viteza.
   */
  it('ponteaza cat timp a strans plafonul, si se opreste la racire', async () => {
    vi.useFakeTimers();
    try {
      const { AnalysisPool } = await import('./workerPool');
      const pool = new AnalysisPool();
      await pool.init();
      pool.resetThermalTally();
      expect(pool.readThermalTally().throttledMs).toBe(0);

      emiteTermic!(3);                      // se incinge
      vi.advanceTimersByTime(4000);
      // Intervalul DESCHIS se vede deja: un import inca in curs nu raporteaza zero.
      expect(pool.readThermalTally().throttledMs).toBe(4000);
      expect(pool.readThermalTally().cap).toBe(THERMAL_THROTTLED_CONCURRENCY);

      emiteTermic!(0);                      // se raceste
      vi.advanceTimersByTime(9000);         // timpul de dupa NU se mai ponteaza
      const final = pool.readThermalTally();
      expect(final.throttledMs).toBe(4000);
      expect(final.cap).toBeNull();
      expect(final.normal).toBe(NATIVE_NORMAL_CONCURRENCY);
    } finally {
      vi.useRealTimers();
    }
  });

  it('un import care incepe cu telefonul deja cald ponteaza de la zero, nu de la tranzitia veche', async () => {
    vi.useFakeTimers();
    try {
      const { AnalysisPool } = await import('./workerPool');
      const pool = new AnalysisPool();
      await pool.init();

      emiteTermic!(3);
      vi.advanceTimersByTime(30_000);       // caldura de la importul DINAINTE
      pool.resetThermalTally();             // incepe importul nou
      expect(pool.readThermalTally().throttledMs).toBe(0);
      vi.advanceTimersByTime(5000);
      expect(pool.readThermalTally().throttledMs).toBe(5000);
    } finally {
      vi.useRealTimers();
    }
  });

  it('o treapta care nu schimba plafonul nu spune nimic', async () => {
    const { AnalysisPool } = await import('./workerPool');
    const pool = new AnalysisPool();
    const anunturi: unknown[] = [];
    pool.onThermalChange = info => anunturi.push(info);
    await pool.init();

    emiteTermic!(0); // rece: acelasi plafon ca la pornire
    expect(anunturi).toHaveLength(0);
  });
});

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
