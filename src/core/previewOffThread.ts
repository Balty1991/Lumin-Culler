/**
 * core/previewOffThread.ts
 * Previzualizarea, miniatura și dHash-ul, în afara firului principal.
 *
 * Desenul pe canvas (drawImage + getImageData + toBlob) bloca interfața la
 * fiecare poză. Worker-ul primește bitmap-ul, întoarce JPEG-urile și dă
 * bitmap-ul înapoi, ca analiza grea (doar pentru candidați, pe web) să-l
 * poată folosi mai departe.
 */
import { dHashFromRgba, thumbMetrics } from './dhash';

export interface DerivativeSet {
  preview: Blob;
  thumb: Blob;
  lqip: string;
  dHash: string;
  w: number;
  h: number;
  sharpness: number;
  exposure: number;
  /** Bitmap-ul primit, transferat înapoi. Poate lipsi dacă worker-ul l-a închis. */
  bitmap?: ImageBitmap;
}

interface WorkerOk extends DerivativeSet {
  id: number;
  ok: true;
}

interface WorkerErr {
  id: number;
  ok: false;
  error?: string;
}

type Waiter = {
  resolve: (value: DerivativeSet) => void;
  reject: (reason: unknown) => void;
};

let worker: Worker | null | undefined;
let seq = 0;
const waiters = new Map<number, Waiter>();

function attach(instance: Worker): void {
  instance.onmessage = (event: MessageEvent<WorkerOk | WorkerErr>) => {
    const message = event.data;
    const waiter = waiters.get(message.id);
    if (!waiter) return;
    waiters.delete(message.id);
    if (!message.ok) waiter.reject(new Error(message.error || 'Previzualizarea a eșuat.'));
    else {
      const { id: _id, ok: _ok, ...rest } = message;
      waiter.resolve(rest);
    }
  };
  instance.onerror = () => {
    for (const waiter of waiters.values()) waiter.reject(new Error('Worker-ul de previzualizare s-a oprit.'));
    waiters.clear();
    worker = null;
  };
}

/** Respins când Worker nu există (teste, medii vechi). Apelantul cade pe canvas-ul din firul principal. */
export function derivativesOffMain(bitmap: ImageBitmap): Promise<DerivativeSet> {
  if (typeof Worker === 'undefined') return Promise.reject(new Error('Worker indisponibil.'));
  if (worker === undefined) {
    try {
      worker = new Worker(new URL('../workers/preview.worker.ts', import.meta.url), { type: 'module' });
      attach(worker);
    } catch (err) {
      worker = null;
      return Promise.reject(err);
    }
  }
  if (!worker) return Promise.reject(new Error('Worker indisponibil.'));
  const id = ++seq;
  return new Promise((resolve, reject) => {
    waiters.set(id, { resolve, reject });
    worker!.postMessage({ id, bitmap }, [bitmap]);
  });
}

/** Aceeași matematică ca în worker, exportată ca să nu existe două formule. */
export function metricsFromImageData(data: Uint8ClampedArray, width = 9): { dHash: string; sharpness: number; exposure: number } {
  return { dHash: dHashFromRgba(data, width), ...thumbMetrics(data, width) };
}
