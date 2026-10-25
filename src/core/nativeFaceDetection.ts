/**
 * core/nativeFaceDetection.ts
 * ML Kit Face nu mai este în aplicație. Fețele vin din MediaPipe Face Landmarker
 * (nativeFaceMesh.ts). Tipurile rămân pentru testele care mock-uiesc calea veche.
 */
import type { NativeImageSource } from './nativeImageSource';

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
/** Mereu fals: plugin-ul ML Kit Face a fost scos din pachet. */
export function isNativeFaceDetectionAvailable(): boolean {
  return false;
}

export async function detectFacesNative(
  _source: NativeImageSource,
  _options?: { fast?: boolean }
): Promise<NativeFaceDetectionResult> {
  throw new Error('ML Kit Face nu mai este în aplicație. Fețele vin din Face Landmarker.');
}
