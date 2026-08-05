/**
 * core/workerPool.ts
 * Pool de Web Workers pentru analiza ML. Firul principal doar decodează
 * imaginile și transferă ImageBitmap-uri (zero-copy); inferența rulează
 * exclusiv aici, pe N-1 nuclee.
 */
import * as Comlink from 'comlink';
import type { FaceAnalysisAPI } from '../workers/faceAnalysis.worker';
import type { AnalysisRecord, KnownPerson } from './db';
import { readEconomicMode } from './performanceSettings';
import { writeLastModelLoadMs } from './modelLoadTiming';

interface Slot {
  worker: Worker;
  api: Comlink.Remote<FaceAnalysisAPI>;
  busy: boolean;
}

// 60s -> 90s: primul worker parcurge acum o cascada WebGPU(6s)->WebGL(20s)->CPU
// (fara timeout propriu — ultimul refugiu, vezi faceAnalysis.worker.ts) inainte
// sa se stabileasca definitiv pe un backend; pe hardware slab, warmup-ul complet
// pe CPU pur (fara acceleratie GPU) pentru intregul set de modele (fata+iris+
// emotie+centernet) poate depasi singur vechiul timeout de 60s, ceea ce ar
// respinge acest timeout EXACT cand cascada de mai jos e pe cale sa reuseasca
// (doar mai incet) — o eroare "Incarcarea a durat prea mult" tocmai atunci cand
// device-ul aproape terminase legitim.
const MODEL_INIT_TIMEOUT_MS = 90000;
/**
 * O poza problematica (rezolutie extrema, pixeli corupti care duc inferenta
 * TF.js intr-un caz patologic etc.) poate bloca WORKER-ul la infinit — nu
 * doar main thread-ul. Fara acest timeout, un singur fisier "prost" inghetat
 * tot importul pentru totdeauna, exact simptomul raportat: bara de progres
 * ramane blocata la "N/total" fara sa mai avanseze vreodata.
 */
const ANALYZE_TIMEOUT_MS = 40000;

/**
 * human.load() foloseste fetch() fara timeout implicit — pe o retea mobila
 * instabila, o conexiune care doar "atarna" (nu esueaza niciodata explicit)
 * bloca tot importul la infinit, cu bara de progres inghetata la "0/N" si
 * nicio eroare vizibila. Cu timeout, o retea proasta devine un esec CONCRET,
 * pe care runImport (state/store.ts) il poate afisa si din care utilizatorul
 * se poate recupera (reincearca), in loc sa ramana blocat.
 */
export function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      v => { clearTimeout(timer); resolve(v); },
      e => { clearTimeout(timer); reject(e); }
    );
  });
}

/**
 * Cate slot-uri (workeri Human.js/TFJS in paralel) sa porneasca — un compromis
 * intre viteza (mai multi workeri = import mai rapid) si presiunea de RAM
 * (fiecare worker isi incarca propria instanta completa de modele). Pe un
 * Honor 8X cu 4GB RAM, 4 workeri simultan a dus la un crash real raportat de
 * utilizator; pe telefoane cu mult RAM (8GB+), plafonul fix de 4 lasa viteza
 * pe masa fara niciun motiv. `navigator.deviceMemory` (doar Chromium; undefined
 * pe Firefox/Safari) da o estimare aproximativa, rotunjita la puteri ale lui 2.
 */
export function computeWorkerCount(cores: number, deviceMemoryGB: number | undefined): number {
  const coreBudget = Math.max(1, cores - 1);
  if (deviceMemoryGB === undefined) return Math.min(4, coreBudget);
  if (deviceMemoryGB <= 4) return 1; // acelasi prag ca prabusirea reala pe 4GB RAM
  if (deviceMemoryGB <= 6) return Math.min(4, coreBudget);
  return Math.min(6, coreBudget); // 8GB+: putem impinge peste plafonul vechi de 4
}

function deviceMemoryGB(): number | undefined {
  return (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
}

export class AnalysisPool {
  private slots: Slot[] = [];
  private waiters: ((slot: Slot) => void)[] = [];
  private ready = false;
  private modelBase = '';
  private knownPersons: KnownPerson[] = [];
  /** Backend TFJS efectiv folosit de worker-ul de referinta (primul initializat). */
  detectedBackend = 'unknown';

  get size(): number { return this.slots.length; }

  /** false = fara accelerare WebGL/WASM — analiza ruleaza dar fara detectie reala de fete. */
  get isAccelerated(): boolean {
    return ['webgl', 'humangl', 'webgpu', 'wasm'].includes(this.detectedBackend);
  }

  /** true dupa primul init() reusit — util ca sa stim daca resizeForEconomicMode() are ce redimensiona acum sau doar la urmatorul import. */
  get isReady(): boolean { return this.ready; }

  private async spawnSlot(forcedBackend?: string): Promise<{ slot: Slot; backend: string }> {
    const worker = new Worker(
      new URL('../workers/faceAnalysis.worker.ts', import.meta.url),
      { type: 'module' }
    );
    const api = Comlink.wrap<FaceAnalysisAPI>(worker);
    const backend = await withTimeout(
      api.init(this.modelBase, readEconomicMode(), forcedBackend),
      MODEL_INIT_TIMEOUT_MS,
      'Incarcarea modelelor AI a durat prea mult — verifica conexiunea la internet.'
    );
    if (this.knownPersons.length) await api.setKnownPersons(this.knownPersons);
    return { slot: { worker, api, busy: false }, backend };
  }

  async init(): Promise<void> {
    if (this.ready) return;
    // masurat aici (nu doar primul slot) — AiBootScreen ramane vizibil pana la
    // finalul intregii metode (toti workerii), vezi modelLoadTiming.ts
    const startedAt = performance.now();
    this.slots = []; // in caz ca o incercare anterioara a esuat/timeout partial, nu dublam sloturile
    const cores = navigator.hardwareConcurrency || 4;
    // mod economic: un singur worker, in loc de pana la N in paralel — mai putina
    // presiune de RAM (fiecare worker isi incarca propria instanta Human.js/TFJS)
    // pe hardware slab, cu costul unui import mai lent. Altfel, numarul se
    // adapteaza dupa RAM-ul device-ului (vezi computeWorkerCount).
    const size = readEconomicMode() ? 1 : computeWorkerCount(cores, deviceMemoryGB());
    this.modelBase = new URL(`${import.meta.env.BASE_URL}models/`, location.href).href;

    // Doar PRIMUL worker face detectia completa de backend (WebGPU -> WebGL ->
    // CPU, cu toate timeout-urile din faceAnalysis.worker.ts) — restul, daca
    // sunt mai multi, primesc direct backend-ul deja gasit si il incearca pe
    // acela singur. Fara asta, pana la 4 workeri incercau simultan aceeasi
    // cascada completa, independent unul de altul: pe telefoane cu hardware
    // mai slab, presiunea de CPU/memorie a 4 incercari paralele de WebGL/WebGPU
    // + warmup complet de modele a fost suficienta cat sa intarzie semnificativ
    // inclusiv propriile timere de siguranta ale fiecarui worker — blocaje
    // reale raportate de utilizatori (minute intregi pe "Se incarca modelele
    // AI"), desi fiecare timeout individual e finit.
    const { slot: firstSlot, backend: firstBackend } = await this.spawnSlot();
    this.slots.push(firstSlot);
    this.detectedBackend = firstBackend;
    this.ready = true;

    if (size > 1) {
      const rest = await Promise.all(
        Array.from({ length: size - 1 }, () => this.spawnSlot(firstBackend))
      );
      this.slots.push(...rest.map(r => r.slot));
    }
    writeLastModelLoadMs(performance.now() - startedAt);
  }

  async setKnownPersons(persons: KnownPerson[]): Promise<void> {
    this.knownPersons = persons;
    await Promise.all(this.slots.map(s => s.api.setKnownPersons(persons)));
  }

  /**
   * Aplica noul mod economic la pool-ul DEJA pornit, fara reincarcarea paginii —
   * inainte, comutatorul din meniu doar scria setarea si cerea reload, fiindca
   * numarul de workeri SI configuratia Human.js (iris/emotie) sunt fixate la
   * spawn (spawnSlot() citeste readEconomicMode() direct). Nu putem doar sa
   * adaugam/scoatem workeri (numarul s-ar schimba, dar cei existenti ar ramane
   * cu iris/emotie din modul VECHI) — inlocuim intreaga flota cu una noua,
   * corect configurata, si abia apoi terminam workerii vechi (chiar daca sunt
   * "busy": analiza lor in curs va esua pe timeout, ca orice worker blocat —
   * importFiles trateaza deja acest caz ca un esec normal per-poza, nu ca o
   * eroare fatala de import).
   */
  async resizeForEconomicMode(economic: boolean): Promise<void> {
    if (!this.ready) return; // inca nepornit — init() va citi setarea curenta la primul import
    const cores = navigator.hardwareConcurrency || 4;
    const targetSize = economic ? 1 : computeWorkerCount(cores, deviceMemoryGB());
    const oldSlots = this.slots;

    // La fel ca in init(): backend-ul e deja cunoscut din flota curenta, asa ca
    // niciunul dintre workerii noi nu mai are nevoie sa repete cascada completa
    // de detectie — evita exact aceeasi presiune de CPU/memorie descrisa acolo.
    const spawned = await Promise.all(
      Array.from({ length: targetSize }, () => this.spawnSlot(this.detectedBackend))
    );
    this.slots = spawned.map(s => s.slot);
    this.detectedBackend = spawned[0]?.backend ?? this.detectedBackend;
    if (this.knownPersons.length) await Promise.all(this.slots.map(s => s.api.setKnownPersons(this.knownPersons)));

    for (const s of oldSlots) { try { s.worker.terminate(); } catch { /* deja mort, nu conteaza */ } }
  }

  private acquire(): Promise<Slot> {
    const free = this.slots.find(s => !s.busy);
    if (free) { free.busy = true; return Promise.resolve(free); }
    return new Promise(resolve => this.waiters.push(slot => { slot.busy = true; resolve(slot); }));
  }

  private release(slot: Slot): void {
    slot.busy = false;
    const next = this.waiters.shift();
    if (next) next(slot);
  }

  /**
   * Inlocuieste worker-ul unui slot blocat cu unul nou, curat — altfel un
   * singur fisier problematic ar pierde definitiv acel slot din pool (worker-ul
   * vechi ramane "busy" pentru totdeauna in mintea noastra, fara sa mai
   * raspunda niciodata), reducand treptat concurenta pana la zero pe o
   * biblioteca mare cu mai multe poze problematice.
   */
  private async respawnSlot(slot: Slot): Promise<void> {
    try { slot.worker.terminate(); } catch { /* deja mort, nu conteaza */ }
    try {
      const { slot: fresh } = await this.spawnSlot(this.detectedBackend);
      slot.worker = fresh.worker;
      slot.api = fresh.api;
    } catch (err) {
      console.error('Nu am putut reporni worker-ul dupa timeout:', err);
    }
  }

  /** Analizează o fotografie. Bitmap-ul e transferat (nu copiat) și închis în worker. */
  async analyze(photoId: string, bitmap: ImageBitmap): Promise<AnalysisRecord> {
    const slot = await this.acquire();
    try {
      return await withTimeout(
        slot.api.analyze(photoId, Comlink.transfer(bitmap, [bitmap])),
        ANALYZE_TIMEOUT_MS,
        'Analiza acestei fotografii a durat prea mult (posibil fisier problematic) — sarita.'
      );
    } catch (err) {
      if (err instanceof Error && err.message.includes('a durat prea mult')) await this.respawnSlot(slot);
      throw err;
    } finally {
      this.release(slot);
    }
  }

  /** Înrolare persoană cunoscută: returnează embedding-ul feței principale + numărul de fețe detectate (vezi worker pentru bug-ul de avertizare). */
  async computeEnrollmentEmbedding(bitmap: ImageBitmap): Promise<{ embedding: number[]; faceCount: number } | null> {
    const slot = await this.acquire();
    try {
      return await withTimeout(
        slot.api.computeEnrollmentEmbedding(Comlink.transfer(bitmap, [bitmap])),
        ANALYZE_TIMEOUT_MS,
        'Procesarea acestei poze de referinta a durat prea mult.'
      );
    } catch (err) {
      if (err instanceof Error && err.message.includes('a durat prea mult')) await this.respawnSlot(slot);
      throw err;
    } finally {
      this.release(slot);
    }
  }
}

export const analysisPool = new AnalysisPool();
