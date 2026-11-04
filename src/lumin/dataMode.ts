/**
 * lumin/dataMode.ts
 * Pe ce rețea se descarcă motoarele AI: aleasă o dată, la prima pornire
 * (cerut: „prima pornire mai clară”: cât descarcă și doar pe Wi-Fi, dacă vrei).
 */
const KEY = 'cherrypic.dataMode';
export type DataMode = 'any' | 'wifi';

export function dataMode(): DataMode | null {
  try { const v = localStorage.getItem(KEY); return v === 'any' || v === 'wifi' ? v : null; } catch { return null; }
}
export function setDataMode(m: DataMode): void {
  try { localStorage.setItem(KEY, m); } catch { /* fără stocare */ }
}

/** Pe Wi-Fi acum? (Network Information API din WebView; necunoscut = da.) */
export function onWifi(): boolean {
  const c = (navigator as unknown as { connection?: { type?: string } }).connection;
  return !c?.type || c.type === 'wifi' || c.type === 'ethernet';
}

/** Se poate descărca acum, după alegerea omului? */
export function mayDownloadNow(): boolean {
  return dataMode() !== 'wifi' || onWifi();
}
