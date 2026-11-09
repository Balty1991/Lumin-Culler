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

/** „Mai târziu” pe fereastra de după instalare: analiza poate porni fără descărcare. */
let deferred = false;
export function deferEnginesPrompt(): void { deferred = true; }
/** Încă n-a ales (fereastra e pe ecran). Analiza așteaptă alegerea. */
export function enginesPromptPending(): boolean {
  return dataMode() === null && !deferred;
}

/**
 * Poarta nativă (ClipPlugin.wifi): Wi-Fi real, chiar dacă Android îl marchează
 * contorizat. `null` = încă n-am întrebat telefonul.
 */
let nativeWifi: boolean | null = null;
export function setNativeWifi(v: boolean | null): void { nativeWifi = v; }

/** Pe Wi-Fi acum? (Network Information API din WebView; necunoscut = nu blocăm.) */
export function onWifi(): boolean {
  const c = (navigator as unknown as { connection?: { type?: string } }).connection;
  const type = c?.type;
  // WebView raportează adesea „unknown” pe Wi-Fi adevărat. „unknown” nu înseamnă
  // „nu ai Wi-Fi” — poarta care contează e cea nativă.
  if (!type || type === 'unknown' || type === 'other') return true;
  return type === 'wifi' || type === 'ethernet';
}

/** Se poate descărca acum, după alegerea omului? */
export function mayDownloadNow(): boolean {
  if (dataMode() !== 'wifi') return true;
  if (nativeWifi !== null) return nativeWifi;
  return onWifi();
}
