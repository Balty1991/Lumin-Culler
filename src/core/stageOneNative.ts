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
  paperScore?: number;
  previewBase64: string;
  thumbBase64: string;
  lqipBase64?: string;
}

interface StageOnePluginApi {
  fingerprint(options: { imageUri: string }): Promise<StageOneNativeResult>;
  fingerprintBatch(options: { imageUris: string[] }): Promise<{ items: StageOneNativeResult[] }>;
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

/** Mai multe poze, decodate în paralel pe telefon. Nu trece prin 1280 px. */
export async function fingerprintBatch(imageUris: string[]): Promise<StageOneNativeResult[]> {
  if (!isStageOneAvailable()) {
    throw new Error('Etapa 1 nativă există doar în aplicația Android.');
  }
  const result = await StageOneNative.fingerprintBatch({ imageUris });
  return result.items ?? [];
}

export function base64ToBlob(b64: string, type = 'image/jpeg'): Blob {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}
