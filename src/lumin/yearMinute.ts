import { weakDevice } from '../core/deviceClass';
import { extensionFor, pickFilmMimeType } from '../core/recapVideoRender';
import { getCachedThumbUrl } from '../core/thumbUrlCache';
import { loadEditable } from './sharp';
import { startStoryMusic, type MusicMood } from './storyMusic';
import { audioMimeFor } from './storyVideo';
import type { BurstFilm } from './burstFilm';

/**
 * lumin/yearMinute.ts
 * „Un an într-un minut”: câte o poză pe zi, una după alta, pe muzică, cu data
 * în colț și o apropiere lentă pe fiecare. Pozele se încarcă din mers (câteva
 * înainte), așa că și un an întreg încape în memoria telefonului.
 */
const FPS = 30;
// Raportat de două ori: „tranziția e prea rapidă”. Fiecare poză stă o secundă și
// jumătate, iar trecerea spre următoarea durează peste o jumătate de secundă; ~30 de
// zile încap într-un minut.
const HOLD = 45;   // cadre pe poză (1,5 s)
const FADE = 18;   // cadre de trecere (0,6 s)

function coverDraw(ctx: CanvasRenderingContext2D, img: CanvasImageSource, iw: number, ih: number, W: number, H: number, zoom: number) {
  const k = Math.max(W / iw, H / ih) * zoom;
  ctx.drawImage(img, (W - iw * k) / 2, (H - ih * k) / 2, iw * k, ih * k);
}

export async function makeYearMinute(
  items: { id: string; at: number }[],
  label: (at: number) => string,
  title: string,
  music: 'none' | MusicMood,
  onProgress?: (f: number) => void
): Promise<BurstFilm | null> {
  const mime = pickFilmMimeType();
  if (!mime || items.length < 2) return null;
  const weak = await weakDevice();
  const W = weak ? 720 : 1080, H = Math.round(W * 16 / 9 / 2) * 2;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  const cache = new Map<number, Promise<HTMLImageElement | null>>();
  const get = (i: number) => {
    if (i < 0 || i >= items.length) return Promise.resolve(null);
    let p = cache.get(i);
    if (!p) { p = loadEditable(items[i].id, weak ? 1152 : 1600).then(r => r?.img ?? null, () => null); cache.set(i, p); }
    return p;
  };
  const drawFrame = (img: HTMLImageElement | null, next: HTMLImageElement | null, i: number, f: number) => {
    ctx.fillStyle = '#050305'; ctx.fillRect(0, 0, W, H);
    const z = 1 + (f / (HOLD + FADE)) * 0.04;
    if (img) coverDraw(ctx, img, img.naturalWidth, img.naturalHeight, W, H, z);
    if (next && f >= HOLD) { const x = (f - HOLD + 1) / (FADE + 1); ctx.globalAlpha = x * x * (3 - 2 * x); coverDraw(ctx, next, next.naturalWidth, next.naturalHeight, W, H, 1); ctx.globalAlpha = 1; }
    const g = ctx.createLinearGradient(0, H * 0.78, 0, H);
    g.addColorStop(0, 'rgba(5,3,5,0)'); g.addColorStop(1, 'rgba(5,3,5,0.7)');
    ctx.fillStyle = g; ctx.fillRect(0, H * 0.78, W, H * 0.22);
    ctx.fillStyle = '#fff6f9'; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.font = `800 ${Math.round(W * 0.06)}px system-ui, sans-serif`;
    ctx.fillText(label(items[i].at), W * 0.06, H * 0.93);
    ctx.fillStyle = '#ff8fae'; ctx.font = `700 ${Math.round(W * 0.032)}px system-ui, sans-serif`;
    ctx.fillText(title, W * 0.06, H * 0.955 + W * 0.01);
    // Bara anului: cât a trecut.
    ctx.fillStyle = 'rgba(255,255,255,0.18)'; ctx.fillRect(W * 0.06, H * 0.965 + W * 0.02, W * 0.88, 6);
    ctx.fillStyle = '#ff4f7f'; ctx.fillRect(W * 0.06, H * 0.965 + W * 0.02, W * 0.88 * ((i + f / (HOLD + FADE)) / items.length), 6);
  };
  const total = items.length * (HOLD + FADE);
  const withAudio = music !== 'none' ? audioMimeFor(mime) : null;
  const m = withAudio && music !== 'none' ? startStoryMusic(total * 1000 / FPS + 600, { mood: music }) : null;
  const video = canvas.captureStream(FPS);
  const stream = m ? new MediaStream([...video.getVideoTracks(), m.track]) : video;
  const used = m ? withAudio! : mime;
  // Primele poze gata înainte de pornire.
  await Promise.all([get(0), get(1), get(2)]);
  drawFrame(await get(0), null, 0, 0);
  const rec = new MediaRecorder(stream, { mimeType: used, videoBitsPerSecond: 16_000_000 });
  const chunks: Blob[] = [];
  rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
  const done = new Promise<void>(res => { rec.onstop = () => res(); });
  rec.start();
  const t0 = performance.now();
  for (let i = 0; i < items.length; i++) {
    const img = await get(i);
    const next = await get(i + 1);
    for (let k = 2; k <= 4; k++) void get(i + k);
    cache.delete(i - 2);
    for (let f = 0; f < HOLD + FADE; f++) {
      const due = t0 + ((i * (HOLD + FADE) + f) * 1000) / FPS;
      const wait = due - performance.now();
      if (wait > 0) await new Promise(r => setTimeout(r, wait));
      drawFrame(img, i + 1 < items.length ? next : null, i, f);
    }
    onProgress?.((i + 1) / items.length);
  }
  rec.stop();
  await done;
  m?.stop();
  // Previzualizarea din aplicație: la claritate plină, ca fișierul (raportat: „pozele nu
  // au claritate în video” — înainte se vedeau miniaturile). Pozele se încarcă din mers,
  // câteva înainte, iar cele trecute se eliberează; miniatura doar cât nu e gata cea clară.
  const thumbs: (HTMLImageElement | null)[] = await Promise.all(items.map(it => getCachedThumbUrl(it.id).then(u => {
    if (!u) return null;
    const im = new Image(); im.src = u;
    return im.decode().then(() => im, () => null);
  }, () => null)));
  const sharp = new Map<number, HTMLImageElement | null | 'loading'>();
  const want = (i: number) => {
    if (i < 0 || i >= items.length || sharp.has(i)) return;
    sharp.set(i, 'loading');
    void loadEditable(items[i].id, weak ? 1152 : 1600).then(r => sharp.set(i, r?.img ?? null), () => sharp.set(i, null));
  };
  const pick = (i: number): HTMLImageElement | null => {
    const s2 = sharp.get(i);
    return s2 && s2 !== 'loading' ? s2 : thumbs[i] ?? null;
  };
  const per = HOLD + FADE;
  return {
    blob: new Blob(chunks, { type: used.split(';')[0] }), ext: extensionFor(used), music: m ? music : 'none',
    fps: FPS, width: W, height: H, count: total,
    draw: (c, n) => {
      const i = Math.floor((n % total) / per), f = (n % total) % per;
      for (let k = 0; k <= 3; k++) want((i + k) % items.length);
      for (const k of [...sharp.keys()]) if (k < i - 1 && !(i > items.length - 4 && k < 3)) sharp.delete(k);
      const img = pick(i), nx = i + 1 < items.length ? pick(i + 1) : null;
      const cw = c.canvas.width, ch = c.canvas.height;
      c.fillStyle = '#050305'; c.fillRect(0, 0, cw, ch);
      c.imageSmoothingQuality = 'high';
      if (img) coverDraw(c, img, img.naturalWidth, img.naturalHeight, cw, ch, 1 + (f / per) * 0.04);
      if (nx && f >= HOLD) { const x = (f - HOLD + 1) / (FADE + 1); c.globalAlpha = x * x * (3 - 2 * x); coverDraw(c, nx, nx.naturalWidth, nx.naturalHeight, cw, ch, 1); c.globalAlpha = 1; }
      c.fillStyle = '#fff6f9'; c.font = `800 ${Math.round(cw * 0.06)}px system-ui, sans-serif`; c.textAlign = 'left';
      c.fillText(label(items[i].at), cw * 0.06, ch * 0.93);
    }
  };
}
