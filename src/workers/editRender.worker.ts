/**
 * workers/editRender.worker.ts
 * Desenul „clar” al editorului, în afara firului principal: poza la mărimea
 * ecranului se ține aici, iar la fiecare oprire a degetului primim doar
 * reglajele și întoarcem cadrul gata. Ecranul nu mai îngheață cât se calculează.
 */
import { drawAdjusted, outputSize, type EditAdjustments } from '../core/imageAdjust';

type In =
  | { type: 'load'; key: number; bitmap: ImageBitmap }
  | { type: 'draw'; key: number; id: number; edits: EditAdjustments }
  | { type: 'blob'; id: number; bitmap: ImageBitmap; edits: EditAdjustments; quality: number };

let held: { key: number; bitmap: ImageBitmap } | null = null;
let canvas: OffscreenCanvas | null = null;

self.onmessage = (e: MessageEvent<In>) => {
  const m = e.data;
  if (m.type === 'load') {
    held?.bitmap.close();
    held = { key: m.key, bitmap: m.bitmap };
    return;
  }
  const post = (self as unknown as { postMessage: (msg: unknown, transfer?: Transferable[]) => void }).postMessage.bind(self);
  if (m.type === 'blob') {
    // Salvarea întreagă aici: desen la rezoluție mare + codare JPEG, nimic pe firul principal.
    void (async () => {
      try {
        const { bitmap } = m;
        const o = outputSize(bitmap.width, bitmap.height, m.edits);
        const c = new OffscreenCanvas(o.width, o.height);
        const ctx = c.getContext('2d', { willReadFrequently: true });
        if (!ctx) throw new Error('fără context');
        drawAdjusted(ctx as unknown as CanvasRenderingContext2D, bitmap, bitmap.width, bitmap.height, o.width, o.height, m.edits);
        bitmap.close();
        const blob = await c.convertToBlob({ type: 'image/jpeg', quality: m.quality });
        post({ id: m.id, blob });
      } catch (err) {
        try { m.bitmap.close(); } catch { /* deja închis */ }
        post({ id: m.id, error: String(err) });
      }
    })();
    return;
  }
  try {
    if (!held || held.key !== m.key) throw new Error('fără sursă');
    const { bitmap } = held;
    const o = outputSize(bitmap.width, bitmap.height, m.edits);
    if (!canvas) canvas = new OffscreenCanvas(o.width, o.height);
    if (canvas.width !== o.width || canvas.height !== o.height) { canvas.width = o.width; canvas.height = o.height; }
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('fără context');
    drawAdjusted(ctx as unknown as CanvasRenderingContext2D, bitmap, bitmap.width, bitmap.height, o.width, o.height, m.edits);
    const out = canvas.transferToImageBitmap();
    post({ id: m.id, bitmap: out }, [out]);
  } catch (err) {
    post({ id: m.id, error: String(err) });
  }
};
