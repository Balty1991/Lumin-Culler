/// <reference lib="webworker" />
/**
 * workers/preview.worker.ts
 * JPEG de previzualizare, miniatură, LQIP și dHash, în afara firului principal.
 */
import { dHashFromRgba, thumbMetrics } from '../core/dhash';

const THUMB_SIZE = 512;
const LQIP_SIZE = 24;

function canvasToJpeg(canvas: OffscreenCanvas, quality: number): Promise<Blob> {
  return canvas.convertToBlob({ type: 'image/jpeg', quality });
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return `data:image/jpeg;base64,${btoa(binary)}`;
}

self.onmessage = async (event: MessageEvent<{ id: number; bitmap: ImageBitmap }>) => {
  const { id, bitmap } = event.data;
  try {
    const full = new OffscreenCanvas(bitmap.width, bitmap.height);
    const fullCtx = full.getContext('2d');
    if (!fullCtx) throw new Error('context 2d');
    fullCtx.drawImage(bitmap, 0, 0);
    const preview = await canvasToJpeg(full, 0.88);

    const scale = Math.min(1, THUMB_SIZE / Math.max(bitmap.width, bitmap.height));
    const thumbCanvas = new OffscreenCanvas(
      Math.max(1, Math.round(bitmap.width * scale)),
      Math.max(1, Math.round(bitmap.height * scale))
    );
    const thumbCtx = thumbCanvas.getContext('2d');
    if (!thumbCtx) throw new Error('context 2d');
    thumbCtx.drawImage(bitmap, 0, 0, thumbCanvas.width, thumbCanvas.height);
    const thumb = await canvasToJpeg(thumbCanvas, 0.82);

    const lqScale = Math.min(1, LQIP_SIZE / Math.max(bitmap.width, bitmap.height));
    const lq = new OffscreenCanvas(
      Math.max(1, Math.round(bitmap.width * lqScale)),
      Math.max(1, Math.round(bitmap.height * lqScale))
    );
    const lqCtx = lq.getContext('2d');
    if (!lqCtx) throw new Error('context 2d');
    lqCtx.drawImage(bitmap, 0, 0, lq.width, lq.height);
    const lqip = await blobToDataUrl(await canvasToJpeg(lq, 0.5));

    const hashCanvas = new OffscreenCanvas(9, 8);
    const hashCtx = hashCanvas.getContext('2d', { willReadFrequently: true });
    if (!hashCtx) throw new Error('context 2d');
    hashCtx.drawImage(bitmap, 0, 0, 9, 8);
    const pixels = hashCtx.getImageData(0, 0, 9, 8).data;
    const dHash = dHashFromRgba(pixels, 9);
    const { sharpness, exposure } = thumbMetrics(pixels, 9);

    self.postMessage(
      { id, ok: true, preview, thumb, lqip, dHash, w: bitmap.width, h: bitmap.height, sharpness, exposure, bitmap },
      [bitmap]
    );
  } catch (err) {
    try { bitmap.close(); } catch { /* deja închis */ }
    const message = err instanceof Error ? err.message : String(err);
    self.postMessage({ id, ok: false, error: message });
  }
};
