/**
 * core/nativeHeicDecoder.ts
 * Punte catre HeicDecoderPlugin.kt — HEIC/HEIF decodat de telefon si intors ca JPEG.
 *
 * De ce e nevoie: Chromium din WebView nu decodeaza HEIC in <canvas>, iar HEIC
 * e formatul implicit pe iPhone si pe multe telefoane Android moderne. Pana
 * acum, o astfel de poza intra in import si pica la decodare — poza lipsa,
 * motiv tehnic. Vezi comentariul lung din plugin pentru de ce nativ si nu
 * libheif in WebAssembly.
 */
import { registerPlugin, Capacitor } from '@capacitor/core';
import { base64ToBlob, blobToBase64 } from './base64';

interface HeicDecoderPluginApi {
  isSupported(): Promise<{ supported: boolean }>;
  decodeToJpeg(options: { imageBase64: string } | { imageUri: string; maxSide?: number }):
    Promise<{ jpegBase64: string; width: number; height: number }>;
}

const HeicDecoderNative = registerPlugin<HeicDecoderPluginApi>('HeicDecoder');

/** Doar plugin-ul e prezent — NU si ca platforma stie HEIF (asta cere `isHeicDecodingSupported`). */
export function isNativeHeicDecoderAvailable(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('HeicDecoder');
}

/**
 * Raspunsul e memorat: nu se schimba in timpul unei sesiuni, iar intrebarea
 * apare o data pentru fiecare fisier care pica la decodare — adica potential
 * de sute de ori intr-un import.
 */
let supportedCache: boolean | null = null;

export async function isHeicDecodingSupported(): Promise<boolean> {
  if (!isNativeHeicDecoderAvailable()) return false;
  if (supportedCache !== null) return supportedCache;
  try {
    supportedCache = (await HeicDecoderNative.isSupported()).supported;
  } catch {
    supportedCache = false;
  }
  return supportedCache;
}

/**
 * HEIC -> Blob JPEG. Arunca daca decodarea nativa nu e disponibila sau esueaza;
 * apelantul decide ce spune omului.
 */
export async function decodeHeicToJpegBlob(file: File, mediaUri?: string): Promise<Blob> {
  if (!isNativeHeicDecoderAvailable()) {
    throw new Error('Decodarea HEIC nativa e disponibila doar in aplicatia Android.');
  }
  // Calea cu URI nu trece imaginea peste punte deloc — vezi nativeImageSource.ts.
  // Fara URI (selector de fisiere), nu avem incotro: fisierul se codeaza.
  const options = mediaUri
    ? { imageUri: mediaUri }
    : { imageBase64: await blobToBase64(file) };
  const { jpegBase64 } = await HeicDecoderNative.decodeToJpeg(options);
  return base64ToBlob(jpegBase64, 'image/jpeg');
}
