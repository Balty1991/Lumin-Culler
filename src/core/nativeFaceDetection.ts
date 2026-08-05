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
import { blobToBase64 } from './base64';

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

interface FaceDetectionPluginApi {
  detectFaces(options: { imageBase64: string }): Promise<NativeFaceDetectionResult>;
}

const FaceDetectionNative = registerPlugin<FaceDetectionPluginApi>('FaceDetection');

/** Sigur de apelat si pe web — registerPlugin() nu esueaza la incarcare, doar la apelul efectiv al unei metode. */
export function isNativeFaceDetectionAvailable(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('FaceDetection');
}

export async function detectFacesNative(imageBlob: Blob): Promise<NativeFaceDetectionResult> {
  if (!isNativeFaceDetectionAvailable()) {
    throw new Error('Detectia nativa de fete e disponibila doar in aplicatia Android (Capacitor), nu in browser.');
  }
  const imageBase64 = await blobToBase64(imageBlob);
  return FaceDetectionNative.detectFaces({ imageBase64 });
}
