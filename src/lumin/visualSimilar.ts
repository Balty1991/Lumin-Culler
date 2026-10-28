import { db } from '../core/db';

/**
 * lumin/visualSimilar.ts
 * „Asemănătoare” care merge pe ORICE poză: o amprentă mică făcută pe loc din
 * miniatura deja salvată — culorile (histogramă 4×4×4) și forma (8×8 tonuri,
 * fără luminozitatea medie) — comparate între ele. Raportat: două bentițe
 * fotografiate pe aceeași masă „nu semănau”, fiindcă pozele fără fețe și fără
 * etichete n-aveau din ce să fie comparate.
 */
const cache = new Map<string, Float32Array | null>();

async function signature(id: string): Promise<Float32Array | null> {
  if (cache.has(id)) return cache.get(id)!;
  let sig: Float32Array | null = null;
  try {
    const rec = await db.thumbnails.get(id);
    if (rec) {
      const bmp = await createImageBitmap(rec.blob, { resizeWidth: 24, resizeHeight: 24, resizeQuality: 'medium' } as ImageBitmapOptions);
      const c = document.createElement('canvas');
      c.width = 24; c.height = 24;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      if (ctx) {
        ctx.drawImage(bmp, 0, 0, 24, 24);
        const px = ctx.getImageData(0, 0, 24, 24).data;
        const hist = new Float32Array(64);
        const gray = new Float32Array(64);
        for (let y = 0; y < 24; y++) for (let x = 0; x < 24; x++) {
          const i = (y * 24 + x) * 4;
          const r = px[i], g = px[i + 1], b = px[i + 2];
          hist[(r >> 6) * 16 + (g >> 6) * 4 + (b >> 6)] += 1;
          gray[Math.floor(y / 3) * 8 + Math.floor(x / 3)] += (0.299 * r + 0.587 * g + 0.114 * b) / 9;
        }
        const mean = gray.reduce((a, v) => a + v, 0) / 64;
        for (let k = 0; k < 64; k++) gray[k] -= mean;
        const norm = (v: Float32Array) => { let s = 0; for (const x of v) s += x * x; s = Math.sqrt(s) || 1; for (let k = 0; k < v.length; k++) v[k] /= s; };
        norm(hist); norm(gray);
        sig = new Float32Array(128);
        sig.set(hist, 0); sig.set(gray, 64);
      }
      bmp.close();
    }
  } catch { sig = null; }
  cache.set(id, sig);
  return sig;
}

function score(a: Float32Array, b: Float32Array): number {
  let h = 0, g = 0;
  for (let k = 0; k < 64; k++) { h += a[k] * b[k]; g += a[64 + k] * b[64 + k]; }
  // Culorile contează mai mult; forma desparte două poze cu aceleași culori.
  return 0.6 * h + 0.4 * Math.max(0, g);
}

/** Pozele care seamănă vizual cu `id`, cele mai apropiate primele. */
export async function findVisuallySimilar(ids: readonly string[], id: string, limit = 30, threshold = 0.72): Promise<string[]> {
  const src = await signature(id);
  if (!src) return [];
  const scored: { id: string; s: number }[] = [];
  for (const other of ids) {
    if (other === id) continue;
    const sig = await signature(other);
    if (!sig) continue;
    const s = score(src, sig);
    if (s >= threshold) scored.push({ id: other, s });
  }
  return scored.sort((a, b) => b.s - a.s).slice(0, limit).map(x => x.id);
}
