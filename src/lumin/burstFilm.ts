/**
 * lumin/burstFilm.ts
 * „Mini-film din serie”: din 2–6 poze ale aceleiași rafale, cadre intermediare
 * cu RIFE (RifePlugin.kt), apoi un film scurt care merge înainte și înapoi
 * (ca un „live photo”). Pe telefon, fără server.
 */
import { registerPlugin, Capacitor } from '@capacitor/core';
import { extensionFor, pickMimeType } from '../core/recapVideoRender';
import { loadEditable } from './sharp';
import { fetchEngine } from './engines';
import { logError } from '../core/errorLog';
import { weakDevice } from '../core/deviceClass';

interface RifeApi { between(o: { a: string; b: string; steps: number }): Promise<{ frames: string[]; width: number; height: number }> }
const Rife = registerPlugin<RifeApi>('Rife');

export function burstFilmAvailable(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('Rife') && !!pickMimeType();
}

function jpeg64(img: HTMLImageElement, max = 576): string {
  const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement('canvas');
  c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
  c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.9).split(',')[1];
}

async function decode(b64: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.src = `data:image/jpeg;base64,${b64}`;
  await img.decode();
  return img;
}

/** Filmul iese la ~1080 px; RIFE lucrează mai mic (viteză), detaliul se ia din poze. */
const OUT = 1080;
const RIFE_SIDE = 640;

function canvas2d(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d', { willReadFrequently: true })!];
}

/** Amestecul a două cadre clare la momentul t (exact ce e fără mișcare). */
function blend(a: CanvasImageSource, b: CanvasImageSource, t: number, w: number, h: number): HTMLCanvasElement {
  const [c, ctx] = canvas2d(w, h);
  ctx.drawImage(a, 0, 0, w, h);
  ctx.globalAlpha = t; ctx.drawImage(b, 0, 0, w, h);
  return c;
}

/**
 * Cadrul RIFE (mic) mărit la mărimea filmului, plus detaliul fin al pozelor
 * originale (ce lipsește din amestecul lor micșorat). Raportat: „nu folosește
 * pozele la calitatea originală” — acum cadrele-cheie sunt originale, iar cele
 * dintre ele primesc înapoi claritatea.
 */
function sharpen(mid: HTMLImageElement, k: HTMLCanvasElement, w: number, h: number): HTMLCanvasElement {
  const [up, uctx] = canvas2d(w, h);
  uctx.imageSmoothingQuality = 'high';
  uctx.drawImage(mid, 0, 0, w, h);
  const [small, sctx] = canvas2d(mid.naturalWidth, mid.naturalHeight);
  sctx.drawImage(k, 0, 0, small.width, small.height);
  const [kl, klctx] = canvas2d(w, h);
  klctx.imageSmoothingQuality = 'high';
  klctx.drawImage(small, 0, 0, w, h);
  const U = uctx.getImageData(0, 0, w, h), K = k.getContext('2d')!.getImageData(0, 0, w, h).data, L = klctx.getImageData(0, 0, w, h).data;
  const d = U.data;
  for (let i = 0; i < d.length; i += 4) {
    d[i] = d[i] + K[i] - L[i];
    d[i + 1] = d[i + 1] + K[i + 1] - L[i + 1];
    d[i + 2] = d[i + 2] + K[i + 2] - L[i + 2];
  }
  uctx.putImageData(U, 0, 0);
  return up;
}

export interface BurstFilm { blob: Blob; ext: string; frames: CanvasImageSource[]; fps: number; width: number; height: number }

export async function makeBurstFilm(ids: string[], onProgress?: (f: number) => void): Promise<BurstFilm | null> {
  const mime = pickMimeType();
  if (!mime || ids.length < 2) return null;
  // Motorul prin descărcarea comună (cu reluare), înainte de primul cadru.
  await fetchEngine('film').catch(() => false);
  const imgs = (await Promise.all(ids.slice(0, 6).map(id => loadEditable(id, 1600).then(r => r?.img ?? null)))).filter((x): x is HTMLImageElement => !!x);
  if (imgs.length < 2) return null;
  const out = (await weakDevice()) ? 720 : OUT;
  const k0 = Math.min(1, out / Math.max(imgs[0].naturalWidth, imgs[0].naturalHeight));
  const w = Math.round(imgs[0].naturalWidth * k0 / 2) * 2, h = Math.round(imgs[0].naturalHeight * k0 / 2) * 2;
  // Cadrele-cheie la calitatea pozelor; pentru RIFE, copii mici.
  const hi = imgs.map(i => blend(i, i, 0, w, h));
  const keys = imgs.map(i => jpeg64(i, RIFE_SIDE));
  onProgress?.(0.05);
  // Patru cadre între poze și o mică oprire pe fiecare poză: raportat „puțin cam rapidă”.
  const HOLD = 2;
  const frames: CanvasImageSource[] = Array(HOLD + 1).fill(hi[0]);
  // RIFE face cadrele intermediare; dacă motorul nu merge pe telefonul ăsta,
  // filmul se face oricum, cu trecere lină între poze.
  let rife = true;
  const steps = 4;
  for (let i = 0; i < keys.length - 1; i++) {
    let mids: HTMLImageElement[] | null = null;
    if (rife) {
      try {
        const r = await Rife.between({ a: keys[i], b: keys[i + 1], steps });
        mids = await Promise.all(r.frames.map(decode));
      } catch (e) {
        logError('rife', e instanceof Error ? e.message : String(e), 'burstFilm');
        rife = false;
      }
    }
    for (let j = 1; j <= steps; j++) {
      const k = blend(hi[i], hi[i + 1], j / (steps + 1), w, h);
      frames.push(mids?.[j - 1] ? sharpen(mids[j - 1], k, w, h) : k);
      await new Promise(r => setTimeout(r, 0));
    }
    for (let k = 0; k <= HOLD; k++) frames.push(hi[i + 1]);
    onProgress?.(0.05 + (i + 1) / (keys.length - 1) * 0.65);
  }
  // Înainte și înapoi, de două ori: mișcarea curge, fără săritură la capăt (și se face mai repede).
  const loop = [...frames, ...frames.slice(1, -1).reverse()];
  const seq = [...loop, ...loop];
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(seq[0], 0, 0, w, h);
  const fps = 10;
  const rec = new MediaRecorder(canvas.captureStream(fps), { mimeType: mime, videoBitsPerSecond: 10_000_000 });
  const chunks: Blob[] = [];
  rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
  const done = new Promise<void>(res => { rec.onstop = () => res(); });
  rec.start();
  for (let i = 0; i < seq.length; i++) {
    ctx.drawImage(seq[i], 0, 0, w, h);
    onProgress?.(0.7 + 0.3 * (i / seq.length));
    await new Promise(r => setTimeout(r, 1000 / fps));
  }
  rec.stop();
  await done;
  return { blob: new Blob(chunks, { type: mime.split(';')[0] }), ext: extensionFor(mime), frames: loop, fps, width: w, height: h };
}
