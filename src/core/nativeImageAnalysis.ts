/**
 * core/nativeImageAnalysis.ts
 * Punte catre plugin-ul Capacitor local ImageAnalysis (vezi
 * android/app/src/main/java/com/luminculler/app/plugins/ImageAnalysisPlugin.kt
 * + ImageMath.kt), port Kotlin 1:1 al matematicii de
 * compozitie/claritate/expunere/culoare din workers/faceAnalysis.worker.ts.
 *
 * LEGAT de fluxul real de analiza — apelat din core/nativeAnalysis.ts
 * (orchestratorul pipeline-ului nativ), el insusi apelat din
 * core/workerPool.ts (AnalysisPool) pe Android/Capacitor.
 */
import { registerPlugin, Capacitor } from '@capacitor/core';
import { nativeImageParams, type NativeImageParams, type NativeImageSource } from './nativeImageSource';

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
  analyze(options: NativeImageParams): Promise<NativeImageAnalysisResult>;
}

const ImageAnalysisNative = registerPlugin<ImageAnalysisPluginApi>('ImageAnalysis');

/** Sigur de apelat si pe web — registerPlugin() nu esueaza la incarcare, doar la apelul efectiv al unei metode. */
export function isNativeImageAnalysisAvailable(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('ImageAnalysis');
}

export async function analyzeImageNative(source: NativeImageSource): Promise<NativeImageAnalysisResult> {
  if (!isNativeImageAnalysisAvailable()) {
    throw new Error('Analiza nativa de imagine e disponibila doar in aplicatia Android (Capacitor), nu in browser.');
  }
  return ImageAnalysisNative.analyze(await nativeImageParams(source));
}
