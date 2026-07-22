/**
 * core/workerPool.ts
 * Pool de Web Workers pentru analiza ML. Firul principal doar decodează
 * imaginile și transferă ImageBitmap-uri (zero-copy); inferența rulează
 * exclusiv aici, pe N-1 nuclee.
 */
import * as Comlink from 'comlink';
import type { FaceAnalysisAPI } from '../workers/faceAnalysis.worker';
import type { AnalysisRecord, KnownPerson } from './db';

interface Slot {
  api: Comlink.Remote<FaceAnalysisAPI>;
  busy: boolean;
}

export class AnalysisPool {
  private slots: Slot[] = [];
  private waiters: ((slot: Slot) => void)[] = [];
  private ready = false;
  /** Backend TFJS efectiv folosit de worker-ul de referinta (primul initializat). */
  detectedBackend = 'unknown';

  get size(): number { return this.slots.length; }

  /** false = fara accelerare WebGL/WASM — analiza ruleaza dar fara detectie reala de fete. */
  get isAccelerated(): boolean {
    return ['webgl', 'humangl', 'webgpu', 'wasm'].includes(this.detectedBackend);
  }

  async init(): Promise<void> {
    if (this.ready) return;
    const cores = navigator.hardwareConcurrency || 4;
    const size = Math.max(1, Math.min(4, cores - 1));
    const modelBase = new URL(`${import.meta.env.BASE_URL}models/`, location.href).href;

    const backends = await Promise.all(
      Array.from({ length: size }, async () => {
        const worker = new Worker(
          new URL('../workers/faceAnalysis.worker.ts', import.meta.url),
          { type: 'module' }
        );
        const api = Comlink.wrap<FaceAnalysisAPI>(worker);
        const backend = await api.init(modelBase);
        this.slots.push({ api, busy: false });
        return backend;
      })
    );
    this.detectedBackend = backends[0] ?? 'unknown';
    this.ready = true;
  }

  async setKnownPersons(persons: KnownPerson[]): Promise<void> {
    await Promise.all(this.slots.map(s => s.api.setKnownPersons(persons)));
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

  /** Analizează o fotografie. Bitmap-ul e transferat (nu copiat) și închis în worker. */
  async analyze(photoId: string, bitmap: ImageBitmap): Promise<AnalysisRecord> {
    const slot = await this.acquire();
    try {
      return await slot.api.analyze(photoId, Comlink.transfer(bitmap, [bitmap]));
    } finally {
      this.release(slot);
    }
  }

  /** Înrolare persoană cunoscută: returnează embedding-ul feței principale. */
  async computeEnrollmentEmbedding(bitmap: ImageBitmap): Promise<number[] | null> {
    const slot = await this.acquire();
    try {
      return await slot.api.computeEnrollmentEmbedding(Comlink.transfer(bitmap, [bitmap]));
    } finally {
      this.release(slot);
    }
  }
}

export const analysisPool = new AnalysisPool();
