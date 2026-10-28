import { frameOpacity, frameScale, planRecapVideo, type RecapPlan } from '../core/recapVideo';
import { extensionFor, pickMimeType } from '../core/recapVideoRender';
import { getCachedPreviewUrl } from '../core/previewUrlCache';
import { canSharpen, sharpUrl } from './sharp';

/** Poza din film: clară (Android, 1600 px), altfel preview-ul salvat. */
const FILM_SIZE = 1600;
async function frameUrl(id: string): Promise<string | null> {
  if (canSharpen()) {
    const sharp = await sharpUrl(id, FILM_SIZE);
    if (sharp) return sharp;
  }
  return getCachedPreviewUrl(id);
}

/**
 * lumin/storyVideo.ts
 * Povestea zilei (sau a săptămânii) ca film scurt, vertical, gata de pus pe
 * story: titlul la început, fiecare poză cu mișcare lentă și trecere moale în
 * următoarea, fundalul umplut cu aceeași poză, estompată. Totul pe telefon.
 *
 * Ritmul și trecerile sunt cele din core/recapVideo.ts (aceleași reguli ca la
 * clipul vechi); aici se schimbă doar cadrul (9:16) și se adaugă titlul.
 */
export const STORY_W = 1080;
export const STORY_H = 1920;
const TITLE_MS = 1600;
const OUTRO_MS = 1100;
/** Cât ține un film: pe story, peste ~25 s nu se mai uită nimeni. */
const MAX_MS = 24_000;

/** Sub atâtea poze nu e o poveste. */
export const MIN_STORY_PHOTOS = 3;

export interface StoryInput { ids: string[]; title: string; subtitle: string }

export function planStory(ids: string[]): RecapPlan | null {
  return planRecapVideo(ids, MAX_MS - TITLE_MS - OUTRO_MS);
}

type Img = HTMLImageElement;

function load(url: string): Promise<Img> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('poza nu s-a putut încărca'));
    img.src = url;
  });
}

const backdrops = new WeakMap<Img, HTMLCanvasElement>();
function backdropOf(img: Img): HTMLCanvasElement {
  let c = backdrops.get(img);
  if (c) return c;
  c = document.createElement('canvas');
  const scale = 40 / Math.max(img.naturalWidth, img.naturalHeight);
  c.width = Math.max(1, Math.round(img.naturalWidth * scale));
  c.height = Math.max(1, Math.round(img.naturalHeight * scale));
  const x = c.getContext('2d');
  if (x) {
    x.filter = 'brightness(0.55)';
    x.drawImage(img, 0, 0, c.width, c.height);
  }
  backdrops.set(img, c);
  return c;
}

function drawPhoto(ctx: CanvasRenderingContext2D, img: Img, scale: number, alpha: number) {
  const w = img.naturalWidth, h = img.naturalHeight;
  // Fundal: aceeași poză, mărită până acoperă, estompată și întunecată.
  ctx.globalAlpha = alpha;
  const cover = Math.max(STORY_W / w, STORY_H / h) * 1.1;
  // Estomparea: din aceeași poză micșorată foarte mult (o dată, apoi din memorie)
  // și mărită înapoi — arată ca un blur, fără un filtru greu la fiecare cadru.
  ctx.drawImage(backdropOf(img), (STORY_W - w * cover) / 2, (STORY_H - h * cover) / 2, w * cover, h * cover);
  // Poza întreagă, cât încape, cu mișcarea lentă (Ken Burns).
  const fit = Math.min(STORY_W / w, (STORY_H * 0.78) / h) * scale;
  ctx.drawImage(img, (STORY_W - w * fit) / 2, (STORY_H - h * fit) / 2, w * fit, h * fit);
  ctx.globalAlpha = 1;
}

function drawText(ctx: CanvasRenderingContext2D, title: string, subtitle: string, alpha: number, y: number) {
  ctx.globalAlpha = alpha;
  ctx.textAlign = 'center';
  ctx.fillStyle = '#fff';
  ctx.shadowColor = 'rgba(0,0,0,.45)';
  ctx.shadowBlur = 24;
  ctx.font = '600 80px "Sora Variable", system-ui, sans-serif';
  ctx.fillText(title, STORY_W / 2, y, STORY_W - 120);
  ctx.font = '500 40px system-ui, sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,.82)';
  ctx.fillText(subtitle, STORY_W / 2, y + 70, STORY_W - 120);
  ctx.shadowBlur = 0;
  ctx.globalAlpha = 1;
}

/** Face filmul. Rulează în timp real (MediaRecorder înregistrează un flux), deci are progres și anulare. */
export async function renderStory(
  input: StoryInput,
  onProgress?: (fraction: number) => void,
  isCancelled?: () => boolean
): Promise<{ blob: Blob; ext: string } | null> {
  const plan = planStory(input.ids);
  const mimeType = pickMimeType();
  if (!plan || !mimeType) return null;
  // Pozele clare se pregătesc toate (fișiere în cache), dar se ȚIN decodate doar
  // cele din scena curentă și următoarea: 16 poze mari deodată ar umple memoria.
  const urls = await Promise.all(plan.frames.map(f => frameUrl(f.id)));
  const images: (Img | null)[] = plan.frames.map(() => null);
  const loading = new Set<number>();
  const ensure = (i: number) => {
    if (i < 0 || i >= urls.length || images[i] || loading.has(i) || !urls[i]) return Promise.resolve();
    loading.add(i);
    return load(urls[i]!).then(img => { images[i] = img; }, () => {}).finally(() => loading.delete(i));
  };
  await Promise.all([ensure(0), ensure(1)]);

  const canvas = document.createElement('canvas');
  canvas.width = STORY_W;
  canvas.height = STORY_H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  const stream = canvas.captureStream(plan.fps);
  const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 8_000_000 });
  const chunks: Blob[] = [];
  recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };
  const done = new Promise<Blob>((resolve, reject) => {
    recorder.onstop = () => resolve(new Blob(chunks, { type: mimeType }));
    recorder.onerror = () => reject(new Error('înregistrarea a eșuat'));
  });

  const total = TITLE_MS + plan.totalMs + OUTRO_MS;
  recorder.start();
  const started = performance.now();
  await new Promise<void>(resolve => {
    const tick = () => {
      const t = performance.now() - started;
      if (t >= total || isCancelled?.()) { resolve(); return; }
      ctx.fillStyle = '#0b0b10';
      ctx.fillRect(0, 0, STORY_W, STORY_H);
      const pt = Math.min(plan.totalMs - 1, Math.max(0, t - TITLE_MS));
      let cur = 0;
      for (let i = 0; i < plan.frames.length; i++) if (plan.frames[i].startMs <= pt) cur = i;
      void ensure(cur + 1);
      void ensure(cur + 2);
      for (let i = 0; i < cur - 1; i++) images[i] = null; // trecute: memoria se eliberează
      for (let i = plan.frames.length - 1; i >= 0; i--) {
        const img = images[i];
        if (!img) continue;
        // Prima poză stă deja sub titlu; ultima rămâne sub final.
        const a = frameOpacity(plan, i, pt);
        if (a > 0) drawPhoto(ctx, img, frameScale(plan, i, pt), a);
      }
      if (t < TITLE_MS + 400) {
        const a = t < TITLE_MS ? 1 : 1 - (t - TITLE_MS) / 400;
        ctx.fillStyle = `rgba(0,0,0,${0.35 * a})`;
        ctx.fillRect(0, 0, STORY_W, STORY_H);
        drawText(ctx, input.title, input.subtitle, a, STORY_H * 0.46);
      }
      if (t > total - OUTRO_MS) {
        const a = Math.min(1, (t - (total - OUTRO_MS)) / 500);
        ctx.fillStyle = `rgba(0,0,0,${0.55 * a})`;
        ctx.fillRect(0, 0, STORY_W, STORY_H);
        drawText(ctx, 'Lumin AI', input.subtitle, a, STORY_H * 0.5);
      }
      onProgress?.(Math.min(1, t / total));
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  recorder.stop();
  stream.getTracks().forEach(tr => tr.stop());
  if (isCancelled?.()) return null;
  return { blob: await done, ext: extensionFor(mimeType) };
}
