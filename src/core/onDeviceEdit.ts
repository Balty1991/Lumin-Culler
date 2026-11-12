/**
 * core/onDeviceEdit.ts
 * Punte către EditModelsPlugin.kt: guma (MI-GAN) și lumina (Zero-DCE), pe
 * telefon, gratuit, fără server. Pe web nu există: apelanții cad pe varianta lor.
 */
import { registerPlugin, Capacitor } from '@capacitor/core';
import { blobToBase64 } from './base64';

export interface Avail { erase: boolean; lowLight: boolean; clarity: boolean; cutout: boolean }
const NONE: Avail = { erase: false, lowLight: false, clarity: false, cutout: false };

interface EditModelsApi {
  available(): Promise<Avail>;
  erase(o: { imageBase64: string; maskBase64: string }): Promise<{ imageBase64: string; width: number; height: number }>;
  lowLight(o: { imageBase64: string; strength?: number }): Promise<{ imageBase64: string; meanGain: number }>;
  clarity(o: { imageBase64?: string; imageUri?: string; inSide?: number; outSide?: number; strength?: number }): Promise<{ imageBase64: string }>;
  cutout(o: { imageBase64: string; background?: 'white' | 'none' }): Promise<{ imageBase64: string }>;
  prepareLama(): Promise<{ ready: boolean }>;
}
const Native = registerPlugin<EditModelsApi>('EditModels');

let avail: Promise<Avail> | null = null;
export function onDeviceEditAvailable(): Promise<Avail> {
  if (!Capacitor.isNativePlatform() || !Capacitor.isPluginAvailable('EditModels')) return Promise.resolve(NONE);
  avail ??= Native.available().then(a => ({ ...NONE, ...a })).catch(() => NONE);
  return avail;
}

function toBlob(b64: string, type: string): Blob {
  return new Blob([Uint8Array.from(atob(b64), c => c.charCodeAt(0))], { type });
}

/** Guma HD (LaMa) pentru obiecte mari: pornește descărcarea în fundal, doar pe Wi-Fi. */
export function prepareLargeEraser(): void {
  if (!Capacitor.isNativePlatform() || !Capacitor.isPluginAvailable('EditModels')) return;
  void Native.prepareLama().catch(() => undefined);
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

/**
 * Claritate: la pozele de telefon scoate la iveală detaliul existent (rapid, fidel);
 * la cele mici, Real-ESRGAN amestecat cu mărirea clasică. Cu `uri`, telefonul citește
 * originalul direct din galerie, fără copia trimisă ca text.
 */
export async function clarityOnDevice(image: Blob | null, outSide = 2048, uri?: string | null, strength = 0.7): Promise<Blob | null> {
  if (!(await onDeviceEditAvailable()).clarity) return null;
  if (!uri && !image) return null;
  try {
    const r = await Native.clarity(uri ? { imageUri: uri, inSide: 640, outSide, strength } : { imageBase64: await blobToBase64(image!), inSide: 640, outSide, strength });
    return toBlob(r.imageBase64, 'image/jpeg');
  } catch { return null; }
}

/** Subiectul decupat (U²-Net), pe fundal alb sau transparent. */
export async function cutoutOnDevice(image: Blob, background: 'white' | 'none' = 'white'): Promise<Blob | null> {
  if (!(await onDeviceEditAvailable()).cutout) return null;
  try {
    const r = await Native.cutout({ imageBase64: await blobToBase64(image), background });
    return toBlob(r.imageBase64, background === 'none' ? 'image/png' : 'image/jpeg');
  } catch { return null; }
}

