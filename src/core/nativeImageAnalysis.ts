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

/**
 * Cutie de fata normalizata (0..1 fata de latura imaginii), in forma pe care o
 * asteapta ImageMath.FaceBox in Kotlin. Identica cu `FaceInsight.box`, doar cu
 * campuri numite in loc de tuplu — puntea Capacitor duce JSON, iar un obiect cu
 * nume se citeste in Kotlin fara sa depinda de ordinea elementelor.
 */
export interface NativeFaceBox { x: number; y: number; w: number; h: number }

interface ImageAnalysisPluginApi {
  analyze(options: NativeImageParams & { faces?: NativeFaceBox[] }): Promise<NativeImageAnalysisResult>;
}

const ImageAnalysisNative = registerPlugin<ImageAnalysisPluginApi>('ImageAnalysis');

/** Sigur de apelat si pe web — registerPlugin() nu esueaza la incarcare, doar la apelul efectiv al unei metode. */
export function isNativeImageAnalysisAvailable(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('ImageAnalysis');
}

/**
 * `faces` — cutiile deja gasite de FaceDetection pentru ACEEASI poza.
 *
 * Fara ele, plugin-ul isi porneste propriul detector ML Kit: a doua detectie de
 * fete pe acelasi cadru, in mod FAST, ale carei cutii intrau apoi in compozitie,
 * focus si orizont. Doua detectoare pe aceeasi poza puteau sa nu fie de acord —
 * comentariul din ImageAnalysisPlugin.kt spunea de mult ca FAST "poate rata o
 * fata pe care celalalt o gaseste".
 *
 * O lista GOALA e un raspuns, nu o absenta: inseamna "s-a cautat, nu e nimeni".
 * Doar `undefined` lasa plugin-ul sa caute singur — cazul cailor care nu au
 * trecut printr-o detectie inainte.
 */
export async function analyzeImageNative(
  source: NativeImageSource,
  faces?: NativeFaceBox[]
): Promise<NativeImageAnalysisResult> {
  if (!isNativeImageAnalysisAvailable()) {
    throw new Error('Analiza nativa de imagine e disponibila doar in aplicatia Android (Capacitor), nu in browser.');
  }
  const params = await nativeImageParams(source);
  return ImageAnalysisNative.analyze(faces === undefined ? params : { ...params, faces });
}
