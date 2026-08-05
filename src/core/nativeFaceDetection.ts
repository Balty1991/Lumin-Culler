/**
 * core/nativeFaceDetection.ts
 * Analiza AI nativa (Faza 1) — punte catre plugin-ul Capacitor local
 * FaceDetection (vezi android/app/src/main/java/com/luminculler/app/plugins/
 * FaceDetectionPlugin.kt), care ruleaza Google ML Kit direct pe device
 * (fara WebView/TFJS) in loc de pipeline-ul JS existent.
 *
 * Scop DOAR pentru Faza 1: dovedeste ca lantul de unelte functioneaza
 * capat-la-capat pe un device real. NU e inca legat de fluxul real de
 * analiza (core/workerPool.ts / AnalysisPool ramane sursa de adevar) —
 * asta vine intr-o faza urmatoare, dupa validarea acestei fundatii.
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
