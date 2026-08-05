/**
 * core/nativeObjectDetection.ts
 * Analiza AI nativa (Faza 3) — punte catre plugin-ul Capacitor local
 * ObjectDetection (vezi android/app/src/main/java/com/luminculler/app/plugins/
 * ObjectDetectionPlugin.kt), un model TFLite COCO SSD MobileNet — NU ML Kit
 * Object Detection (are doar 5 categorii foarte largi, nu cele 80 COCO deja
 * folosite de sceneTags in tot restul aplicatiei).
 *
 * La fel ca nativeFaceDetection.ts/nativeImageAnalysis.ts (Faza 1/2): doar
 * dovedeste ca portul functioneaza pe un device real. NU e inca legat de
 * fluxul real de analiza — asta vine intr-o faza urmatoare, dupa ce si
 * recunoasterea are echivalent nativ (decizia explicita a utilizatorului:
 * nici o trecere partiala pe Android inainte de paritate completa).
 */
import { registerPlugin, Capacitor } from '@capacitor/core';
import { blobToBase64 } from './base64';

export interface NativeDetectedObject {
  /** Eticheta in engleza, aceleasi chei ca sceneTagLabels.ts (verificat: labelmap.txt-ul modelului se potriveste identic). */
  label: string;
  score: number;
  /** Normalizat 0..1 fata de imaginea intreaga — acelasi format ca FaceInsight.box din JS. */
  box: { x: number; y: number; width: number; height: number };
}

export interface NativeObjectDetectionResult {
  objects: NativeDetectedObject[];
}

interface ObjectDetectionPluginApi {
  detectObjects(options: { imageBase64: string }): Promise<NativeObjectDetectionResult>;
}

const ObjectDetectionNative = registerPlugin<ObjectDetectionPluginApi>('ObjectDetection');

/** Sigur de apelat si pe web — registerPlugin() nu esueaza la incarcare, doar la apelul efectiv al unei metode. */
export function isNativeObjectDetectionAvailable(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('ObjectDetection');
}

export async function detectObjectsNative(imageBlob: Blob): Promise<NativeObjectDetectionResult> {
  if (!isNativeObjectDetectionAvailable()) {
    throw new Error('Detectia nativa de obiecte e disponibila doar in aplicatia Android (Capacitor), nu in browser.');
  }
  const imageBase64 = await blobToBase64(imageBlob);
  return ObjectDetectionNative.detectObjects({ imageBase64 });
}
