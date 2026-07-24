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

interface Slot {
  worker: Worker;
  api: Comlink.Remote<FaceAnalysisAPI>;
  busy: boolean;
}

// 45s -> 60s: adaugarea modelului de detectie obiecte (centernet, ~4MB) creste cu
// ~1/3 greutatea descarcata + warmup-ul GPU per worker; pe pool-uri de pana la 4
// workeri paraleli (fiecare cu propriul context WebGL), contentia CPU/GPU la
// pornire rece a facut timeout-ul vechi sa loveasca real, nu doar teoretic —
// masurat direct (import esuat repetabil la 45s, reusit constant sub 60s).
const MODEL_INIT_TIMEOUT_MS = 60000;
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

  private async spawnSlot(): Promise<{ slot: Slot; backend: string }> {
    const worker = new Worker(
      new URL('../workers/faceAnalysis.worker.ts', import.meta.url),
      { type: 'module' }
    );
    const api = Comlink.wrap<FaceAnalysisAPI>(worker);
    const backend = await withTimeout(
      api.init(this.modelBase, readEconomicMode()),
      MODEL_INIT_TIMEOUT_MS,
      'Incarcarea modelelor AI a durat prea mult — verifica conexiunea la internet.'
    );
    if (this.knownPersons.length) await api.setKnownPersons(this.knownPersons);
    return { slot: { worker, api, busy: false }, backend };
  }

  async init(): Promise<void> {
    if (this.ready) return;
    this.slots = []; // in caz ca o incercare anterioara a esuat/timeout partial, nu dublam sloturile
    const cores = navigator.hardwareConcurrency || 4;
    // mod economic: un singur worker, in loc de pana la 4 in paralel — mai putina
    // presiune de RAM (fiecare worker isi incarca propria instanta Human.js/TFJS)
    // pe hardware slab, cu costul unui import mai lent
    const size = readEconomicMode() ? 1 : Math.max(1, Math.min(4, cores - 1));
    this.modelBase = new URL(`${import.meta.env.BASE_URL}models/`, location.href).href;

    const backends = await Promise.all(
      Array.from({ length: size }, async () => {
        const { slot, backend } = await this.spawnSlot();
        this.slots.push(slot);
        return backend;
      })
    );
    this.detectedBackend = backends[0] ?? 'unknown';
    this.ready = true;
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
    const targetSize = economic ? 1 : Math.max(1, Math.min(4, cores - 1));
    const oldSlots = this.slots;

    const spawned = await Promise.all(Array.from({ length: targetSize }, () => this.spawnSlot()));
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
      const { slot: fresh } = await this.spawnSlot();
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

  /** Înrolare persoană cunoscută: returnează embedding-ul feței principale. */
  async computeEnrollmentEmbedding(bitmap: ImageBitmap): Promise<number[] | null> {
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
