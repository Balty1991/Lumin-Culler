import { getCachedThumbUrl } from '../core/thumbUrlCache';

/**
 * lumin/splash.ts
 * Poza de la pornire (redesign: „cea mai frumoasă poză recentă în loc de ecranul gol”):
 * o variantă mică (~25 KB) a celei mai bune poze păstrate din ultima lună, ținută în
 * localStorage și pusă de public/theme-init.js în spatele siglei, înainte de JS.
 */
const KEY = 'cp.splash';
const ID_KEY = 'cp.splash.id';

export async function saveSplashPhoto(id: string | undefined): Promise<void> {
  if (!id) return;
  try { if (localStorage.getItem(ID_KEY) === id) return; } catch { return; }
  const url = await getCachedThumbUrl(id).catch(() => null);
  if (!url) return;
  const img = new Image();
  img.src = url;
  try { await img.decode(); } catch { return; }
  const k = Math.min(1, 420 / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement('canvas');
  c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
  c.getContext('2d')?.drawImage(img, 0, 0, c.width, c.height);
  const data = c.toDataURL('image/jpeg', 0.72);
  if (data.length > 80_000) return;
  try { localStorage.setItem(KEY, data); localStorage.setItem(ID_KEY, id); } catch { /* fără loc: rămâne sigla */ }
}
