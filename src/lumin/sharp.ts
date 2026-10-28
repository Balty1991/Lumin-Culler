import { Capacitor, registerPlugin } from '@capacitor/core';
import { db } from '../core/db';

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

/** Mărimea de cerut pentru o dală de `cssPx` pe ecranul ăsta: trepte fixe, ca să se refolosească din cache. */
export function sizeFor(cssPx: number): number {
  const need = cssPx * Math.min(3, window.devicePixelRatio || 1);
  return need <= 400 ? 384 : need <= 800 ? 768 : need <= 1200 ? 1152 : 1600;
}

const urls = new Map<string, Promise<string | null>>();

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
async function originalUri(photoId: string): Promise<string | null> {
  const rec = await db.photos.get(photoId);
  if (!rec) return null;
  if (rec.mediaUri) return rec.mediaUri;
  if (rec.copyOf) return (await db.photos.get(rec.copyOf))?.mediaUri ?? null;
  if (!rec.edits || !rec.dHash) return null;
  const twin = await db.photos.where('dHash').equals(rec.dHash).filter(p => !!p.mediaUri && p.capturedAt === rec.capturedAt).first();
  return twin?.mediaUri ?? null;
}

/** URL-ul pozei clare, gata decodat (null când nu se poate — rămâne miniatura). */
export function sharpUrl(photoId: string, size: number): Promise<string | null> {
  if (!canSharpen()) return Promise.resolve(null);
  const k = `${photoId}@${size}`;
  let p = urls.get(k);
  if (!p) {
    p = (async () => {
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
    })().catch(() => null);
    p.then(u => { if (!u) urls.delete(k); });
    urls.set(k, p);
  }
  return p;
}
