/**
 * lumin/editRender.ts
 * Puntea spre workers/editRender.worker.ts. `canRenderOff` spune dacă reglajele
 * pot fi desenate acolo: guma și estomparea fundalului folosesc pânze din pagină
 * (și masca omului nu se poate trimite), deci rămân pe firul principal.
 */
import type { EditAdjustments } from '../core/imageAdjust';

export function canRenderOff(e: EditAdjustments): boolean {
  return typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined' && typeof createImageBitmap === 'function'
    && !((e.bokeh ?? 0) > 0) && !e.bokehMask && !e.heal?.length;
}

let worker: Worker | null | undefined;
let seq = 0;
let loaded: { source: CanvasImageSource; key: number } | null = null;
const waiters = new Map<number, { resolve: (b: ImageBitmap) => void; reject: (e: unknown) => void }>();
const blobWaiters = new Map<number, { resolve: (b: Blob) => void; reject: (e: unknown) => void }>();

function get(): Worker | null {
  if (worker !== undefined) return worker;
  try {
    worker = new Worker(new URL('../workers/editRender.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<{ id: number; bitmap?: ImageBitmap; blob?: Blob; error?: string }>) => {
      const bw = blobWaiters.get(e.data.id);
      if (bw) {
        blobWaiters.delete(e.data.id);
        if (e.data.blob) bw.resolve(e.data.blob); else bw.reject(new Error(e.data.error));
        return;
      }
      const w = waiters.get(e.data.id);
      if (!w) { e.data.bitmap?.close(); return; }
      waiters.delete(e.data.id);
      if (e.data.bitmap) w.resolve(e.data.bitmap); else w.reject(new Error(e.data.error));
    };
    worker.onerror = () => {
      for (const w of waiters.values()) w.reject(new Error('worker'));
      for (const w of blobWaiters.values()) w.reject(new Error('worker'));
      waiters.clear(); blobWaiters.clear(); worker = null; loaded = null;
    };
  } catch { worker = null; }
  return worker;
}

/** Desenează `source` cu `edits` în afara firului principal. Respinge dacă nu se poate: apelantul desenează el. */
export async function renderOff(source: HTMLCanvasElement | HTMLImageElement, edits: EditAdjustments): Promise<ImageBitmap> {
  const w = get();
  if (!w) throw new Error('fără worker');
  if (loaded?.source !== source) {
    const bitmap = await createImageBitmap(source);
    const key = ++seq;
    w.postMessage({ type: 'load', key, bitmap }, [bitmap]);
    loaded = { source, key };
  }
  const id = ++seq;
  const key = loaded.key;
  return new Promise<ImageBitmap>((resolve, reject) => {
    waiters.set(id, { resolve, reject });
    w.postMessage({ type: 'draw', key, id, edits });
  });
}

/**
 * Poza finală (desen + JPEG) în întregime pe worker; `bitmap` se predă (nu mai e
 * folosibil după apel). Respinge dacă nu se poate: apelantul desenează el.
 */
export async function renderBlobOff(bitmap: ImageBitmap, edits: EditAdjustments, quality = 0.94): Promise<Blob> {
  const w = get();
  if (!w) throw new Error('fără worker');
  const id = ++seq;
  return new Promise<Blob>((resolve, reject) => {
    blobWaiters.set(id, { resolve, reject });
    w.postMessage({ type: 'blob', id, bitmap, edits, quality }, [bitmap]);
  });
}
