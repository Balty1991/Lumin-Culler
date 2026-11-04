/**
 * core/samSelect.ts
 * „Atinge obiectul” în gumă: SlimSAM pe telefon (SamPlugin.kt, Apache-2.0).
 * Pe web nu există — guma rămâne cu pensula.
 */
import { registerPlugin, Capacitor } from '@capacitor/core';

interface SamApi {
  encode(o: { imageBase64: string }): Promise<{ ok: boolean }>;
  select(o: { x: number; y: number }): Promise<{ maskBase64: string; width: number; height: number; coverage: number; score: number }>;
}
const Sam = registerPlugin<SamApi>('Sam');

export function samAvailable(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('Sam');
}

/** Pregătește poza (o dată per poză). `false` dacă modelul nu e disponibil. */
export async function samPrepare(image: CanvasImageSource & { width: number; height: number }): Promise<boolean> {
  if (!samAvailable()) return false;
  try {
    const side = Math.max(image.width, image.height);
    const s = Math.min(1, 1024 / side);
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(image.width * s)); c.height = Math.max(1, Math.round(image.height * s));
    c.getContext('2d')!.drawImage(image, 0, 0, c.width, c.height);
    const b64 = c.toDataURL('image/jpeg', 0.92).split(',')[1];
    return (await Sam.encode({ imageBase64: b64 })).ok;
  } catch { return false; }
}

/** Masca obiectului atins (x, y în 0..1), ca imagine albă pe transparent, sau null. */
export async function samSelect(x: number, y: number): Promise<HTMLImageElement | null> {
  try {
    const r = await Sam.select({ x, y });
    // Nimic sau aproape tot cadrul: atingerea n-a nimerit un obiect.
    if (r.coverage < 0.0005 || r.coverage > 0.6) return null;
    const img = new Image();
    img.src = `data:image/png;base64,${r.maskBase64}`;
    await img.decode();
    return img;
  } catch { return null; }
}
