/**
 * core/stageOneNative.ts
 * Etapa 1 pe telefon: miniatura și dHash-ul se calculează în Kotlin, din
 * content://. Fișierul original nu trece puntea Capacitor.
 */
import { Capacitor, registerPlugin } from '@capacitor/core';

export interface StageOneNativeResult {
  dHash: string;
  width: number;
  height: number;
  sharpness: number;
  exposure: number;
  previewBase64: string;
  thumbBase64: string;
}

interface StageOnePluginApi {
  fingerprint(options: { imageUri: string }): Promise<StageOneNativeResult>;
}

const StageOneNative = registerPlugin<StageOnePluginApi>('StageOne');

export function isStageOneAvailable(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('StageOne');
}

export async function fingerprintUri(imageUri: string): Promise<StageOneNativeResult> {
  if (!isStageOneAvailable()) {
    throw new Error('Etapa 1 nativă există doar în aplicația Android.');
  }
  return StageOneNative.fingerprint({ imageUri });
}

export function base64ToBlob(b64: string, type = 'image/jpeg'): Blob {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}
