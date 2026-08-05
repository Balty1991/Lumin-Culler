/**
 * core/nativeImageAnalysis.ts
 * Analiza AI nativa (Faza 2) — punte catre plugin-ul Capacitor local
 * ImageAnalysis (vezi android/app/src/main/java/com/luminculler/app/plugins/
 * ImageAnalysisPlugin.kt + ImageMath.kt), port Kotlin 1:1 al matematicii de
 * compozitie/claritate/expunere/culoare din workers/faceAnalysis.worker.ts.
 *
 * La fel ca nativeFaceDetection.ts (Faza 1): doar dovedeste ca portul
 * functioneaza pe un device real. NU e inca legat de fluxul real de analiza
 * (core/workerPool.ts / AnalysisPool ramane sursa de adevar) — asta vine
 * intr-o faza urmatoare, dupa ce si recunoasterea + etichetele de scena au
 * echivalent nativ (decizia explicita a utilizatorului: nici o trecere
 * partiala pe Android inainte de paritate completa).
 */
import { registerPlugin, Capacitor } from '@capacitor/core';
import { blobToBase64 } from './base64';

export interface NativeImageAnalysisResult {
  sharpness: number;
  exposure: number;
  highlightClipping: number;
  shadowClipping: number;
  horizonTiltDeg?: number;
  ruleOfThirds: number;
  headroom: number;
  compositionScore: number;
  leadingLinesDetected: boolean;
  symmetryDetected: boolean;
  negativeSpaceScore: number;
  lightQuality: 'soft' | 'hard' | 'mixed' | 'unknown';
  goldenHourDetected: boolean;
  subjectInFocus?: boolean;
  bokehQuality: 'good' | 'average' | 'poor' | 'n/a';
  colorHarmonyScore: number;
  dominantColors: string[];
}

interface ImageAnalysisPluginApi {
  analyze(options: { imageBase64: string }): Promise<NativeImageAnalysisResult>;
}

const ImageAnalysisNative = registerPlugin<ImageAnalysisPluginApi>('ImageAnalysis');

/** Sigur de apelat si pe web — registerPlugin() nu esueaza la incarcare, doar la apelul efectiv al unei metode. */
export function isNativeImageAnalysisAvailable(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('ImageAnalysis');
}

export async function analyzeImageNative(imageBlob: Blob): Promise<NativeImageAnalysisResult> {
  if (!isNativeImageAnalysisAvailable()) {
    throw new Error('Analiza nativa de imagine e disponibila doar in aplicatia Android (Capacitor), nu in browser.');
  }
  const imageBase64 = await blobToBase64(imageBlob);
  return ImageAnalysisNative.analyze({ imageBase64 });
}
