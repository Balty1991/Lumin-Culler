/**
 * lumin/burstFilm.ts
 * „Mini-film”: din 2–6 poze ale aceleiași rafale, cadre intermediare cu RIFE
 * (RifePlugin.kt), apoi un film scurt care merge înainte și înapoi (ca un
 * „live photo”). Din creatorul manual: până la 12 poze alese de om, cu viteză,
 * trecere, format și culori. Pe telefon, fără server.
 */
import { registerPlugin, Capacitor } from '@capacitor/core';
import { extensionFor, pickMimeType } from '../core/recapVideoRender';
import { loadEditable } from './sharp';
import { fetchEngine } from './engines';
import { logError } from '../core/errorLog';
import { weakDevice } from '../core/deviceClass';
import { startStoryMusic, type MusicMood } from './storyMusic';
import { audioMimeFor } from './storyVideo';

interface RifeApi { between(o: { a: string; b: string; steps: number }): Promise<{ frames: string[]; width: number; height: number }> }
const Rife = registerPlugin<RifeApi>('Rife');

export function burstFilmAvailable(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('Rife') && !!pickMimeType();
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

/** Cum se face filmul (creatorul manual). Fără opțiuni: ca înainte, pentru o serie. */
export interface FilmOptions {
  speed?: 'slow' | 'normal' | 'fast';
  /** „ai” = cadre făcute de RIFE (pentru serii); „fade” = trecere lină (pentru poze diferite). */
  transition?: 'ai' | 'fade';
  loop?: 'bounce' | 'forward';
  format?: 'orig' | 'square' | 'story';
  look?: 'natural' | 'warm' | 'vivid' | 'bw';
  /** Muzică compusă pe telefon (fără drepturi de autor), înregistrată în film. */
  music?: 'none' | MusicMood;
}

export const FILM_MAX_PHOTOS = 12;
const AI_MAX_PHOTOS = 8;

const LOOKS: Record<NonNullable<FilmOptions['look']>, string> = {
  natural: 'none',
  warm: 'sepia(0.18) saturate(1.15) brightness(1.03)',
  vivid: 'saturate(1.3) contrast(1.08)',
  bw: 'grayscale(1) contrast(1.1)'
};

/** Poza decupată (centrat) la mărimea filmului, cu aspectul ales. */
function cover(img: HTMLImageElement, w: number, h: number, look: string): HTMLCanvasElement {
  const [c, ctx] = canvas2d(w, h);
  ctx.imageSmoothingQuality = 'high';
  if (look !== 'none') ctx.filter = look;
  const k = Math.max(w / img.naturalWidth, h / img.naturalHeight);
  const dw = img.naturalWidth * k, dh = img.naturalHeight * k;
  ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
  return c;
}

/**
 * Un cadru: o poză, un cadru RIFE gata clarificat, sau o trecere calculată abia
 * la desen (așa un film lung, lent, nu ține sute de cadre mari în memorie).
 */
type Frame = HTMLCanvasElement | { a: HTMLCanvasElement; b: HTMLCanvasElement; t: number };
function drawFrame(ctx: CanvasRenderingContext2D, f: Frame, w: number, h: number) {
  if (f instanceof HTMLCanvasElement) { ctx.globalAlpha = 1; ctx.drawImage(f, 0, 0, w, h); return; }
  // Ușor încetinit la capete: trecerea pare mai naturală decât una liniară.
  const t = f.t * f.t * (3 - 2 * f.t);
  ctx.globalAlpha = 1; ctx.drawImage(f.a, 0, 0, w, h);
  ctx.globalAlpha = t; ctx.drawImage(f.b, 0, 0, w, h);
  ctx.globalAlpha = 1;
}

export interface BurstFilm { blob: Blob; ext: string; music: 'none' | MusicMood; fps: number; width: number; height: number; count: number; draw: (ctx: CanvasRenderingContext2D, i: number) => void }

export async function makeBurstFilm(ids: string[], onProgress?: (f: number) => void, opts: FilmOptions = {}): Promise<BurstFilm | null> {
  if (!pickMimeType() || ids.length < 2) return null;
  const wantAi = (opts.transition ?? 'ai') === 'ai';
  const weak = await weakDevice();
  const imgs: HTMLImageElement[] = [];
  for (const id of ids.slice(0, FILM_MAX_PHOTOS)) {
    const r = await loadEditable(id, 1600).catch(() => null);
    if (r?.img) imgs.push(r.img);
    onProgress?.(0.04 * imgs.length / ids.length);
  }
  if (imgs.length < 2) return null;
  // RIFE doar unde merită și unde încape în timp/memorie; altfel trecere lină.
  const rife = wantAi && imgs.length <= (weak ? 6 : AI_MAX_PHOTOS);
  const out = weak ? 720 : OUT;
  const format = opts.format ?? 'orig';
  let w: number, h: number;
  if (format === 'square') { w = h = out; }
  else if (format === 'story') { h = out; w = Math.round(out * 9 / 16 / 2) * 2; }
  else {
    const k0 = Math.min(1, out / Math.max(imgs[0].naturalWidth, imgs[0].naturalHeight));
    w = Math.round(imgs[0].naturalWidth * k0 / 2) * 2; h = Math.round(imgs[0].naturalHeight * k0 / 2) * 2;
  }
  // Cadrele-cheie la calitatea pozelor (toate la aceeași mărime).
  const look = LOOKS[opts.look ?? 'natural'];
  const hi = imgs.map(i => cover(i, w, h, look));
  return filmFromKeyframes(hi, { ...opts, transition: rife ? 'ai' : 'fade' }, onProgress);
}

/**
 * Filmul din cadre-cheie gata făcute (aceeași mărime): trecerile dintre ele
 * (RIFE sau lină), bucla și înregistrarea. Folosit și de „Cum a crescut”.
 */
export async function filmFromKeyframes(hi: HTMLCanvasElement[], opts: FilmOptions = {}, onProgress?: (f: number) => void): Promise<BurstFilm | null> {
  const mime = pickMimeType();
  if (!mime || hi.length < 2) return null;
  const w = hi[0].width, h = hi[0].height;
  const speed = opts.speed ?? 'normal';
  let rife = (opts.transition ?? 'ai') === 'ai';
  if (rife) rife = await fetchEngine('film').then(() => true, () => false);
  const kr = Math.min(1, RIFE_SIDE / Math.max(w, h));
  const keys = hi.map(c => {
    const [s, sctx] = canvas2d(Math.round(w * kr), Math.round(h * kr));
    sctx.drawImage(c, 0, 0, s.width, s.height);
    return s.toDataURL('image/jpeg', 0.9).split(',')[1];
  });
  onProgress?.(0.05);
  // Oprirea pe fiecare poză și numărul de cadre dintre ele, după viteză.
  // O serie (RIFE) curge repede; poze diferite au nevoie de timp să fie văzute.
  const HOLD = rife ? { slow: 5, normal: 2, fast: 0 }[speed] : { slow: 14, normal: 8, fast: 4 }[speed];
  const steps = rife ? { slow: 6, normal: 4, fast: 3 }[speed] : { slow: 10, normal: 6, fast: 4 }[speed];
  const frames: Frame[] = Array(HOLD + 1).fill(hi[0]);
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
      const t = j / (steps + 1);
      frames.push(mids?.[j - 1] ? sharpen(mids[j - 1], blend(hi[i], hi[i + 1], t, w, h), w, h) : { a: hi[i], b: hi[i + 1], t });
      if (mids) await new Promise(r => setTimeout(r, 0));
    }
    for (let k = 0; k <= HOLD; k++) frames.push(hi[i + 1]);
    onProgress?.(0.05 + (i + 1) / (keys.length - 1) * 0.6);
  }
  // Dus-întors: mișcarea curge, fără săritură la capăt. „Doar înainte”: la final
  // trece lin înapoi la prima poză, ca bucla să nu sară.
  let loop: Frame[];
  if ((opts.loop ?? 'bounce') === 'bounce') loop = [...frames, ...frames.slice(1, -1).reverse()];
  else {
    loop = [...frames];
    const last = hi[hi.length - 1];
    for (let j = 1; j <= steps; j++) loop.push({ a: last, b: hi[0], t: j / (steps + 1) });
  }
  // Filmele scurte (serii) se repetă o dată în fișier; cele lungi nu.
  const seq = loop.length < 60 ? [...loop, ...loop] : loop;
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  drawFrame(ctx, seq[0], w, h);
  const fps = 10;
  // Cu muzică doar dacă telefonul poate pune și sunet în același fișier.
  const mood = opts.music ?? 'none';
  const withAudio = mood !== 'none' ? audioMimeFor(mime) : null;
  const music = withAudio && mood !== 'none' ? startStoryMusic(seq.length * 1000 / fps + 400, { mood }) : null;
  const stream = music ? new MediaStream([...canvas.captureStream(fps).getVideoTracks(), music.track]) : canvas.captureStream(fps);
  const usedMime = music ? withAudio! : mime;
  const rec = new MediaRecorder(stream, { mimeType: usedMime, videoBitsPerSecond: 10_000_000 });
  const chunks: Blob[] = [];
  rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
  const done = new Promise<void>(res => { rec.onstop = () => res(); });
  rec.start();
  for (let i = 0; i < seq.length; i++) {
    drawFrame(ctx, seq[i], w, h);
    onProgress?.(0.65 + 0.35 * (i / seq.length));
    await new Promise(r => setTimeout(r, 1000 / fps));
  }
  rec.stop();
  await done;
  music?.stop();
  return {
    blob: new Blob(chunks, { type: usedMime.split(';')[0] }), ext: extensionFor(usedMime), music: music ? mood : 'none', fps, width: w, height: h,
    count: loop.length, draw: (c, i) => drawFrame(c, loop[i % loop.length], c.canvas.width, c.canvas.height)
  };
}
