/**
 * core/webInpaint.ts
 * Guma în browser: MI-GAN (Picsart, MIT) rulat cu onnxruntime-web, fără server.
 * Înainte, fără server, browserul copia pixelii vecini și ieșea o pată dungată
 * (raportat cu captură). Modelul (~28 MB) se descarcă doar la prima ștergere;
 * pe telefon guma folosește modelul nativ (EditModelsPlugin).
 *
 * Modelul „pipeline v2” primește poza uint8 [1,3,H,W] și masca uint8 [1,1,H,W],
 * cu 0 = de umplut și 255 = de păstrat (verificat în CI), și întoarce poza întreagă.
 */
import type { InferenceSession } from 'onnxruntime-web';

const MODEL_URL = `${import.meta.env.BASE_URL}models/migan_pipeline_v2.onnx`;

let session: Promise<InferenceSession | null> | null = null;

function load(): Promise<InferenceSession | null> {
  session ??= (async () => {
    try {
      const ort = await import('onnxruntime-web/wasm');
      // Fără izolare cross-origin (GitHub Pages) nu există fire de execuție WASM.
      ort.env.wasm.numThreads = typeof crossOriginIsolated !== 'undefined' && crossOriginIsolated
        ? Math.min(4, navigator.hardwareConcurrency || 2) : 1;
      return await ort.InferenceSession.create(MODEL_URL, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
    } catch {
      session = null; // altă încercare data viitoare (ex. rețea picată)
      return null;
    }
  })();
  return session;
}

/**
 * Umple zona albă din `mask` (aceeași mărime ca `image`). Întoarce o pânză nouă
 * sau null dacă modelul nu se poate încărca.
 */
export async function eraseInBrowser(image: HTMLCanvasElement, mask: HTMLCanvasElement): Promise<HTMLCanvasElement | null> {
  const s = await load();
  if (!s) return null;
  const ort = await import('onnxruntime-web/wasm');
  const w = image.width, h = image.height, n = w * h;
  const px = image.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, w, h).data;
  const mk = mask.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, w, h).data;
  const img = new Uint8Array(3 * n);
  const keep = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    img[i] = px[i * 4]; img[n + i] = px[i * 4 + 1]; img[2 * n + i] = px[i * 4 + 2];
    keep[i] = mk[i * 4] > 40 || mk[i * 4 + 1] > 40 ? 0 : 255;
  }
  const out = await s.run({
    image: new ort.Tensor('uint8', img, [1, 3, h, w]),
    mask: new ort.Tensor('uint8', keep, [1, 1, h, w])
  });
  const r = out[s.outputNames[0]].data as Uint8Array;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d')!;
  const id = ctx.createImageData(w, h);
  for (let i = 0; i < n; i++) {
    id.data[i * 4] = r[i]; id.data[i * 4 + 1] = r[n + i]; id.data[i * 4 + 2] = r[2 * n + i]; id.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(id, 0, 0);
  return c;
}
