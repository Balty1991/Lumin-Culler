/**
 * core/portraitEdit.ts
 * „Portret”: fundal estompat pe telefon (PortraitPlugin.kt: MODNet pentru oameni,
 * Depth Anything V2 Small pentru restul). Pe web nu există.
 */
import { registerPlugin, Capacitor } from '@capacitor/core';
import { blobToBase64 } from './base64';

interface PortraitApi {
  portrait(o: { imageBase64?: string; imageUri?: string; strength?: number; focusX?: number; focusY?: number }): Promise<{ imageBase64: string; subject: 'person' | 'depth' }>;
}
const Portrait = registerPlugin<PortraitApi>('Portrait');

export function portraitAvailable(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('Portrait');
}

/** `focus`: unde a atins omul (0..1) — acolo rămâne clar. */
export async function portraitOnDevice(image: Blob, strength = 0.7, focus?: { x: number; y: number }, uri?: string | null): Promise<Blob | null> {
  if (!portraitAvailable()) return null;
  const extra = { strength, ...(focus ? { focusX: focus.x, focusY: focus.y } : {}) };
  const toBlob = (b64: string) => new Blob([Uint8Array.from(atob(b64), c => c.charCodeAt(0))], { type: 'image/jpeg' });
  // Întâi originalul din galerie (rezoluție plină); dacă nu se poate citi, copia primită.
  if (uri) {
    try { return toBlob((await Portrait.portrait({ imageUri: uri, ...extra })).imageBase64); } catch { /* copia de mai jos */ }
  }
  try { return toBlob((await Portrait.portrait({ imageBase64: await blobToBase64(image), ...extra })).imageBase64); } catch { return null; }
}
