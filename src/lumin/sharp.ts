import { Capacitor, registerPlugin } from '@capacitor/core';
import { db } from '../core/db';
import { RenderQueue } from './renderQueue';
import { analysisPool } from '../core/workerPool';

/**
 * lumin/sharp.ts
 * Poza clară pentru ecran, făcută de Android (plugins/SharpImagePlugin.kt):
 * 640 px pentru grilă, 2048 px pentru ecranul plin. Miniatura de 256 px de la
 * import rămâne pentru analiză și pentru prima clipă, până vine asta.
 */
interface SharpImageApi { render(o: { uri: string; size: number; inline?: boolean }): Promise<{ path: string; data?: string }> }
const SharpImage = registerPlugin<SharpImageApi>('SharpImage');

export const TILE_SIZE = 768;
export const SCREEN_SIZE = 1440;
/** La mărire, o copie mai mare a aceleiași poze. Nu originalul: pe unele telefoane iese negru. */
export const ZOOM_SIZE = 2880;

/** Mărimea de cerut pentru o dală de `cssPx` pe ecranul ăsta: trepte fixe, ca să se refolosească din cache. */
export function sizeFor(cssPx: number): number {
  const need = cssPx * Math.min(3, window.devicePixelRatio || 1);
  return need <= 400 ? 384 : need <= 800 ? 768 : need <= 1200 ? 1152 : 1600;
}

const urls = new Map<string, Promise<string | null>>();
// Limita e largă: o dală abandonată ar rămâne neclară până reapare; cele vechi doar așteaptă la urmă.
const queue = new RenderQueue<string | null>(2, 400);
/** Ce s-a terminat deja, citibil pe loc (fără așteptare): poza clară apare din primul cadru. */
const ready = new Map<string, string>();
export function peekSharpUrl(photoId: string, size: number): string | null {
  return ready.get(`${photoId}@${size}`) ?? null;
}

export function canSharpen(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('SharpImage');
}

/** Încarcă și DECODEAZĂ poza înainte s-o arătăm — altfel apărea desenată pe bucăți. */
function preload(url: string): Promise<string | null> {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      if (typeof img.decode === 'function') img.decode().then(() => resolve(url), () => resolve(url));
      else resolve(url);
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

/**
 * Fișierul din galerie al unei poze. O copie „mai frumoasă” nu are fișier al ei:
 * se ia al pozei din care provine (`copyOf`; la copiile mai vechi, după amprentă,
 * identică cu a originalului). Fără asta, efectele se aplicau pe preview-ul mic.
 */
export async function originalUri(photoId: string): Promise<string | null> {
  const rec = await db.photos.get(photoId);
  if (!rec) return null;
  if (rec.mediaUri) return rec.mediaUri;
  if (rec.copyOf) return (await db.photos.get(rec.copyOf))?.mediaUri ?? null;
  if (!rec.edits || !rec.dHash) return null;
  const twin = await db.photos.where('dHash').equals(rec.dHash).filter(p => !!p.mediaUri && p.capturedAt === rec.capturedAt).first();
  return twin?.mediaUri ?? null;
}

/**
 * Cât ecranul așteaptă poze clare, citirea galeriei din fundal stă pe loc: altfel
 * analiza ocupa procesorul și unele dale rămâneau neclare câteva secunde (raportat
 * cu captură, în timpul citirii). Importul cerut de om nu e afectat (vezi holdForUi).
 */
let sharpPending = 0;
let releaseReader: (() => void) | null = null;
function trackSharp(p: Promise<unknown>): void {
  if (sharpPending++ === 0) releaseReader = analysisPool.holdForUi();
  void p.finally(() => {
    if (--sharpPending === 0) { releaseReader?.(); releaseReader = null; }
  });
}

/** URL-ul pozei clare, gata decodat (null când nu se poate — rămâne miniatura). */
export function sharpUrl(photoId: string, size: number): Promise<string | null> {
  if (!canSharpen()) return Promise.resolve(null);
  const k = `${photoId}@${size}`;
  let p = urls.get(k);
  if (!p) {
    // Prin rândul din aplicație (renderQueue.ts): poza de ecran și editorul trec înaintea
    // dalelor din galerie, iar dalele vechi nu mai țin telefonul ocupat.
    p = queue.add(async () => {
      const uri = await originalUri(photoId);
      if (!uri) return null;
      const rec = { mediaUri: uri };
      const { path } = await SharpImage.render({ uri: rec.mediaUri, size });
      const direct = await preload(Capacitor.convertFileSrc(path));
      if (direct) return direct;
      // WebView-ul n-a putut citi fișierul din cache: aceeași poză, ca date.
      const { data } = await SharpImage.render({ uri: rec.mediaUri, size, inline: true });
      if (!data) return null;
      const bytes = Uint8Array.from(atob(data), c => c.charCodeAt(0));
      return preload(URL.createObjectURL(new Blob([bytes], { type: 'image/jpeg' })));
    }, size >= SCREEN_SIZE).catch(() => null);
    trackSharp(p);
    p.then(u => { if (!u) urls.delete(k); else ready.set(k, u); });
    urls.set(k, p);
  }
  return p;
}

/** O poză încărcată printr-un <img> (merge și unde `fetch` pe fișierul din galerie e refuzat). */
function imageFrom(url: string): Promise<HTMLImageElement | null> {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => { (img.decode?.() ?? Promise.resolve()).then(() => resolve(img), () => resolve(img)); };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

/**
 * Poza pentru editoare (gumă, text, film), cu rezerve: copia clară făcută de
 * Android, apoi fișierul din galerie, apoi preview-ul și, la urmă, miniatura.
 * Raportat: „Poza nu s-a putut deschide” când prima cale nu mergea. `low` =
 * s-a ajuns la o copie mică (editorul merge, dar la rezoluție redusă).
 */
export async function loadEditable(photoId: string, size: number): Promise<{ img: HTMLImageElement; low: boolean } | null> {
  const { getDisplayUrl, getCachedPreviewUrl } = await import('../core/previewUrlCache');
  const { getCachedThumbUrl } = await import('../core/thumbUrlCache');
  // Copia clară se mai cere o dată și se încearcă și cea de ecran, înainte de rezerve
  // (raportat: filmul și editorul ieșeau neclare când prima încercare nu mergea).
  const tries: Array<[() => Promise<string | null>, boolean]> = [
    [() => sharpUrl(photoId, size), false],
    [() => sharpUrl(photoId, size), false],
    [() => Promise.resolve(peekSharpUrl(photoId, SCREEN_SIZE)), false],
    [() => getDisplayUrl(photoId), false],
    [() => getCachedPreviewUrl(photoId), true],
    [() => getCachedThumbUrl(photoId), true]
  ];
  for (const [get, low] of tries) {
    const url = await get().catch(() => null);
    if (!url) continue;
    const img = await imageFrom(url);
    if (img && img.naturalWidth > 0) return { img, low: low || Math.max(img.naturalWidth, img.naturalHeight) < 900 };
  }
  return null;
}

/** La fel, ca ImageBitmap micșorat la `size` (pentru canvas). */
export async function loadEditableBitmap(photoId: string, size: number): Promise<{ bitmap: ImageBitmap; low: boolean } | null> {
  const r = await loadEditable(photoId, size);
  if (!r) return null;
  const k = Math.min(1, size / Math.max(r.img.naturalWidth, r.img.naturalHeight));
  try {
    const bitmap = await createImageBitmap(r.img, { resizeWidth: Math.round(r.img.naturalWidth * k), resizeHeight: Math.round(r.img.naturalHeight * k), resizeQuality: 'high' });
    return { bitmap, low: r.low };
  } catch {
    const c = document.createElement('canvas');
    c.width = Math.round(r.img.naturalWidth * k); c.height = Math.round(r.img.naturalHeight * k);
    c.getContext('2d')!.drawImage(r.img, 0, 0, c.width, c.height);
    return { bitmap: await createImageBitmap(c), low: r.low };
  }
}
