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

/** Cadre de trecere simplă între două poze (când RIFE nu e disponibil). */
async function crossfade(a: HTMLImageElement, b: HTMLImageElement, steps: number): Promise<HTMLImageElement[]> {
  const out: HTMLImageElement[] = [];
  const c = document.createElement('canvas');
  c.width = a.naturalWidth; c.height = a.naturalHeight;
  const ctx = c.getContext('2d')!;
  for (let i = 1; i <= steps; i++) {
    ctx.globalAlpha = 1; ctx.drawImage(a, 0, 0, c.width, c.height);
    ctx.globalAlpha = i / (steps + 1); ctx.drawImage(b, 0, 0, c.width, c.height);
    out.push(await decode(c.toDataURL('image/jpeg', 0.9).split(',')[1]));
  }
  return out;
}

export async function makeBurstFilm(ids: string[], onProgress?: (f: number) => void): Promise<{ blob: Blob; ext: string } | null> {
  const mime = pickMimeType();
  if (!mime || ids.length < 2) return null;
  // Motorul prin descărcarea comună (cu reluare), înainte de primul cadru.
  await fetchEngine('film').catch(() => false);
  const imgs = (await Promise.all(ids.slice(0, 6).map(id => loadEditable(id, 1024).then(r => r?.img ?? null)))).filter((x): x is HTMLImageElement => !!x);
  if (imgs.length < 2) return null;
  const keys = imgs.map(i => jpeg64(i));
  onProgress?.(0.05);
  const frames: HTMLImageElement[] = [await decode(keys[0])];
  // RIFE face cadrele intermediare; dacă motorul nu merge pe telefonul ăsta,
  // filmul se face oricum, cu trecere lină între poze (raportat: „încă nu face”).
  let rife = true;
  for (let i = 0; i < keys.length - 1; i++) {
    const next = await decode(keys[i + 1]);
    let mids: HTMLImageElement[] | null = null;
    if (rife) {
      try {
        const r = await Rife.between({ a: keys[i], b: keys[i + 1], steps: 3 });
        mids = await Promise.all(r.frames.map(decode));
      } catch (e) {
        console.warn('RIFE', e);
        rife = false;
      }
    }
    if (!mids) mids = await crossfade(frames[frames.length - 1], next, 3);
    frames.push(...mids, next);
    onProgress?.((i + 1) / (keys.length - 1) * 0.7);
  }
  // Înainte și înapoi, de două ori: mișcarea curge, fără săritură la capăt (și se face mai repede).
  const loop = [...frames, ...frames.slice(1, -1).reverse()];
  const seq = [...loop, ...loop];
  const w = frames[0].naturalWidth, h = frames[0].naturalHeight;
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(seq[0], 0, 0, w, h);
  const fps = 12;
  const rec = new MediaRecorder(canvas.captureStream(fps), { mimeType: mime, videoBitsPerSecond: 6_000_000 });
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
  return { blob: new Blob(chunks, { type: mime.split(';')[0] }), ext: extensionFor(mime) };
}
