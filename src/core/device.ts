import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';

/**
 * core/device.ts
 * Partea de JS a plugin-ului nativ „Device” (plugins/DevicePlugin.kt): vibrații,
 * culorile telefonului, barele de sistem, dictare, limba aplicației, poze
 * primite prin „Trimite”, actualizare din aplicație și Ultra HDR.
 *
 * Fiecare funcție e sigură pe web și pe un APK mai vechi: întoarce „nu se
 * poate” în loc să arunce.
 */
type Tones = Record<'100' | '200' | '300' | '400' | '500' | '600' | '700', string>;
export interface PhoneColors { accent1: Tones; accent2: Tones; accent3: Tones }

interface DeviceApi {
  haptic(o: { type: HapticType }): Promise<void>;
  dynamicColors(): Promise<{ available: boolean } & Partial<PhoneColors>>;
  systemBars(o: { light: boolean }): Promise<void>;
  voiceSearch(o: { lang?: string; prompt?: string }): Promise<{ available: boolean; text?: string }>;
  appLocale(): Promise<{ supported: boolean; lang?: string }>;
  setAppLocale(o: { lang: string }): Promise<void>;
  pendingShares(): Promise<{ files: { path: string; name: string; mime: string }[] }>;
  clearShares(): Promise<void>;
  checkUpdate(): Promise<{ available: boolean; downloaded?: boolean }>;
  startUpdate(): Promise<{ started: boolean }>;
  completeUpdate(): Promise<void>;
  setHdr(o: { on: boolean }): Promise<void>;
  isUltraHdr(o: { uri: string }): Promise<{ hdr: boolean }>;
  addListener(event: 'shared' | 'updateDownloaded', cb: () => void): Promise<PluginListenerHandle>;
}

const Device = registerPlugin<DeviceApi>('Device');

function native(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('Device');
}

export type HapticType = 'tick' | 'confirm' | 'reject' | 'long' | 'success';

const HAPTICS_KEY = 'lumin-haptics';
export function hapticsOn(): boolean {
  try { return localStorage.getItem(HAPTICS_KEY) !== '0'; } catch { return true; }
}
export function setHapticsOn(on: boolean): void {
  try { localStorage.setItem(HAPTICS_KEY, on ? '1' : '0'); } catch { /* fără stocare */ }
}

/** O vibrație fină. Pe telefon vine de la sistem (respectă setarea de vibrații a omului). */
export function haptic(type: HapticType = 'tick'): void {
  if (!hapticsOn()) return;
  if (native()) { void Device.haptic({ type }).catch(() => {}); return; }
  try { navigator.vibrate?.(type === 'tick' ? 8 : type === 'reject' ? [12, 40, 12] : 16); } catch { /* fără vibrații */ }
}

export async function phoneColors(): Promise<PhoneColors | null> {
  if (!native()) return null;
  try {
    const r = await Device.dynamicColors();
    return r.available && r.accent1 && r.accent2 && r.accent3 ? { accent1: r.accent1, accent2: r.accent2, accent3: r.accent3 } : null;
  } catch { return null; }
}

export function setSystemBars(light: boolean): void {
  if (native()) void Device.systemBars({ light }).catch(() => {});
}

/** Dictare: textul spus, '' dacă omul a renunțat, null dacă telefonul nu are recunoaștere vocală. */
export async function voiceSearch(lang: string, prompt?: string): Promise<string | null> {
  if (!native()) return null;
  try {
    const r = await Device.voiceSearch({ lang, prompt });
    return r.available ? (r.text ?? '') : null;
  } catch { return null; }
}

export function canVoiceSearch(): boolean { return native(); }

export async function systemAppLocale(): Promise<string | null> {
  if (!native()) return null;
  try { const r = await Device.appLocale(); return r.supported && r.lang ? r.lang : null; } catch { return null; }
}
export function setSystemAppLocale(lang: string): void {
  if (native()) void Device.setAppLocale({ lang }).catch(() => {});
}

/** Pozele primite prin „Trimite către Cherrypic”, ca File-uri gata de import. */
export async function takeSharedFiles(): Promise<File[]> {
  if (!native()) return [];
  try {
    const { files } = await Device.pendingShares();
    const out: File[] = [];
    for (const f of files) {
      try {
        const blob = await (await fetch(Capacitor.convertFileSrc(f.path))).blob();
        out.push(new File([blob], f.name, { type: f.mime || blob.type, lastModified: Date.now() }));
      } catch { /* un fișier care nu se poate citi nu oprește restul */ }
    }
    return out;
  } catch { return []; }
}
export function clearSharedFiles(): void { if (native()) void Device.clearShares().catch(() => {}); }

export async function onShared(cb: () => void): Promise<() => void> {
  if (!native()) return () => {};
  try { const h = await Device.addListener('shared', cb); return () => { void h.remove(); }; } catch { return () => {}; }
}

export async function checkForUpdate(): Promise<'none' | 'available' | 'downloaded'> {
  if (!native()) return 'none';
  try {
    const r = await Device.checkUpdate();
    return r.downloaded ? 'downloaded' : r.available ? 'available' : 'none';
  } catch { return 'none'; }
}
export async function startUpdate(onDownloaded: () => void): Promise<boolean> {
  if (!native()) return false;
  try {
    const h = await Device.addListener('updateDownloaded', () => { void h.remove(); onDownloaded(); });
    const r = await Device.startUpdate();
    if (!r.started) void h.remove();
    return r.started;
  } catch { return false; }
}
export function completeUpdate(): void { if (native()) void Device.completeUpdate().catch(() => {}); }

export function setHdrMode(on: boolean): void { if (native()) void Device.setHdr({ on }).catch(() => {}); }
export async function isUltraHdr(uri: string): Promise<boolean> {
  if (!native()) return false;
  try { return (await Device.isUltraHdr({ uri })).hdr; } catch { return false; }
}
