/**
 * core/onDeviceEdit.ts
 * Punte către EditModelsPlugin.kt: guma (MI-GAN) și lumina (Zero-DCE), pe
 * telefon, gratuit, fără server. Pe web nu există: apelanții cad pe varianta lor.
 */
import { registerPlugin, Capacitor } from '@capacitor/core';
import { blobToBase64 } from './base64';

interface EditModelsApi {
  available(): Promise<{ erase: boolean; lowLight: boolean }>;
  erase(o: { imageBase64: string; maskBase64: string }): Promise<{ imageBase64: string; width: number; height: number }>;
  lowLight(o: { imageBase64: string; strength?: number }): Promise<{ imageBase64: string; meanGain: number }>;
}
const Native = registerPlugin<EditModelsApi>('EditModels');

let avail: Promise<{ erase: boolean; lowLight: boolean }> | null = null;
export function onDeviceEditAvailable(): Promise<{ erase: boolean; lowLight: boolean }> {
  if (!Capacitor.isNativePlatform() || !Capacitor.isPluginAvailable('EditModels')) return Promise.resolve({ erase: false, lowLight: false });
  avail ??= Native.available().catch(() => ({ erase: false, lowLight: false }));
  return avail;
}

function toBlob(b64: string, type: string): Blob {
  return new Blob([Uint8Array.from(atob(b64), c => c.charCodeAt(0))], { type });
}

/** Guma pe o bucată din poză: masca albă = de șters. Aceeași mărime înapoi (PNG). */
export async function eraseOnDevice(image: Blob, mask: Blob): Promise<Blob | null> {
  if (!(await onDeviceEditAvailable()).erase) return null;
  try {
    const r = await Native.erase({ imageBase64: await blobToBase64(image), maskBase64: await blobToBase64(mask) });
    return toBlob(r.imageBase64, 'image/png');
  } catch { return null; }
}

/** Poza întunecată, luminată de Zero-DCE (curba învățată, aplicată ca un câștig blând). */
export async function lowLightOnDevice(image: Blob, strength = 1): Promise<Blob | null> {
  if (!(await onDeviceEditAvailable()).lowLight) return null;
  try {
    const r = await Native.lowLight({ imageBase64: await blobToBase64(image), strength });
    return toBlob(r.imageBase64, 'image/jpeg');
  } catch { return null; }
}
