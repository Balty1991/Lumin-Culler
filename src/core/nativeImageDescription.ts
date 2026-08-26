/**
 * core/nativeImageDescription.ts
 * Punte catre ImageDescriptionPlugin.kt — descriere scrisa a unei poze,
 * generata pe telefon de Gemini Nano prin ML Kit GenAI (AICore).
 *
 * Nimic nu pleaca de pe dispozitiv, deci se potriveste cu promisiunea
 * aplicatiei. Trei rezerve, toate reale, toate vizibile in tipurile de aici:
 *
 *  - poate lipsi cu totul (AICore si modelul nu sunt pe orice telefon);
 *  - modelul se descarca, si descarcarea o hotaraste omul, nu noi;
 *  - scrie in ENGLEZA. API-ul suporta deocamdata doar engleza, iar aplicatia e
 *    in romana. Nu se poate ascunde si nu se poate traduce local, deci se
 *    spune pe fata inainte sa se descarce ceva.
 */
import { registerPlugin, Capacitor } from '@capacitor/core';
import { nativeImageParams, type NativeImageParams, type NativeImageSource } from './nativeImageSource';

/**
 * "unsupported" = nici macar clasa nativa nu exista (dependinta beta lipseste).
 * "unavailable"  = telefonul asta n-o poate rula.
 * "downloadable" = poate, dar modelul nu e descarcat inca.
 */
export type ImageDescriptionStatus = 'available' | 'downloadable' | 'downloading' | 'unavailable' | 'unsupported';

interface ImageDescriptionPluginApi {
  status(): Promise<{ status: ImageDescriptionStatus }>;
  download(): Promise<{ downloaded: boolean }>;
  describe(options: NativeImageParams): Promise<{ description: string }>;
}

const ImageDescriptionNative = registerPlugin<ImageDescriptionPluginApi>('ImageDescription');

export function isNativeImageDescriptionAvailable(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('ImageDescription');
}

/**
 * Raspunsul nu se memoreaza, spre deosebire de HEIC: starea chiar se schimba in
 * timpul unei sesiuni (modelul se descarca si trece din "downloadable" in
 * "available"), iar o valoare tinuta minte ar ascunde exact tranzitia pentru
 * care exista ecranul.
 */
export async function imageDescriptionStatus(): Promise<ImageDescriptionStatus> {
  if (!isNativeImageDescriptionAvailable()) return 'unsupported';
  try {
    return (await ImageDescriptionNative.status()).status;
  } catch {
    return 'unsupported';
  }
}

/** Descarca modelul. De chemat DOAR dupa o apasare explicita — e trafic si spatiu. */
export async function downloadImageDescriptionModel(): Promise<void> {
  await ImageDescriptionNative.download();
}

export async function describeImageNative(source: NativeImageSource): Promise<string> {
  if (!isNativeImageDescriptionAvailable()) {
    throw new Error('Descrierea de imagine e disponibila doar in aplicatia Android.');
  }
  const { description } = await ImageDescriptionNative.describe(await nativeImageParams(source));
  return description;
}
