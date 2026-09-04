/**
 * core/nativeFaceDetection.ts
 * Punte catre plugin-ul Capacitor local FaceDetection (vezi
 * android/app/src/main/java/com/luminculler/app/plugins/FaceDetectionPlugin.kt),
 * care ruleaza Google ML Kit direct pe device (fara WebView/TFJS).
 *
 * LEGAT de fluxul real de analiza — apelat din core/nativeAnalysis.ts
 * (orchestratorul pipeline-ului nativ), el insusi apelat din
 * core/workerPool.ts (AnalysisPool) pe Android/Capacitor.
 */
import { registerPlugin, Capacitor } from '@capacitor/core';
import { nativeImageParams, type NativeImageParams, type NativeImageSource } from './nativeImageSource';

export interface NativeFaceBoundingBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface NativeFaceResult {
  boundingBox: NativeFaceBoundingBox;
  /** Absent daca ML Kit n-a putut clasifica fata respectiva (nu 0 — vezi FaceDetectionPlugin.kt, putOpt). */
  smilingProbability?: number;
  leftEyeOpenProbability?: number;
  rightEyeOpenProbability?: number;
}

export interface NativeFaceDetectionResult {
  faces: NativeFaceResult[];
  imageWidth: number;
  imageHeight: number;
}

/**
 * `fast` — vezi fastDetectorHolder in FaceDetectionPlugin.kt: acelasi model,
 * dar in modul rapid, fara clasificare si fara contururi. Raspunde la "e
 * cineva in cadru?" si la nimic altceva, deci e bun EXCLUSIV pentru
 * pre-scanarea de ordonare (prioritizeFacesFirst), care asta si intreaba.
 * Rezultatele lui NU au voie sa ajunga in AnalysisRecord: `smilingProbability`
 * si cele doua probabilitati de ochi vin mereu absente.
 */
interface FaceDetectionPluginApi {
  detectFaces(options: NativeImageParams & { fast?: boolean }): Promise<NativeFaceDetectionResult>;
}

const FaceDetectionNative = registerPlugin<FaceDetectionPluginApi>('FaceDetection');

/** Sigur de apelat si pe web — registerPlugin() nu esueaza la incarcare, doar la apelul efectiv al unei metode. */
export function isNativeFaceDetectionAvailable(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('FaceDetection');
}

export async function detectFacesNative(
  source: NativeImageSource,
  options?: { fast?: boolean }
): Promise<NativeFaceDetectionResult> {
  if (!isNativeFaceDetectionAvailable()) {
    throw new Error('Detectia nativa de fete e disponibila doar in aplicatia Android (Capacitor), nu in browser.');
  }
  const params = await nativeImageParams(source);
  return FaceDetectionNative.detectFaces(options?.fast ? { ...params, fast: true } : params);
}
