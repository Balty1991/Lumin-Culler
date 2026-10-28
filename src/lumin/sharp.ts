import { Capacitor, registerPlugin } from '@capacitor/core';
import { db } from '../core/db';

/**
 * lumin/sharp.ts
 * Poza clară pentru ecran, făcută de Android (plugins/SharpImagePlugin.kt):
 * 640 px pentru grilă, 2048 px pentru ecranul plin. Miniatura de 256 px de la
 * import rămâne pentru analiză și pentru prima clipă, până vine asta.
 */
interface SharpImageApi { render(o: { uri: string; size: number }): Promise<{ path: string }> }
const SharpImage = registerPlugin<SharpImageApi>('SharpImage');

export const TILE_SIZE = 640;
export const SCREEN_SIZE = 2048;

const urls = new Map<string, Promise<string | null>>();

export function canSharpen(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('SharpImage');
}

function preload(url: string): Promise<string | null> {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => resolve(url);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

/** URL-ul pozei clare, gata decodat (null când nu se poate — rămâne miniatura). */
export function sharpUrl(photoId: string, size: number): Promise<string | null> {
  if (!canSharpen()) return Promise.resolve(null);
  const k = `${photoId}@${size}`;
  let p = urls.get(k);
  if (!p) {
    p = (async () => {
      const rec = await db.photos.get(photoId);
      if (!rec?.mediaUri) return null;
      const { path } = await SharpImage.render({ uri: rec.mediaUri, size });
      return preload(Capacitor.convertFileSrc(path));
    })().catch(() => null);
    p.then(u => { if (!u) urls.delete(k); });
    urls.set(k, p);
  }
  return p;
}
