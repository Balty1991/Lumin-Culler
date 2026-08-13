/**
 * core/nativePoseDetection.ts
 * Analiza AI nativa (Faza 5) — punte catre plugin-ul Capacitor local
 * PoseDetection (vezi android/app/src/main/java/com/luminculler/app/plugins/
 * PoseDetectionPlugin.kt), pozitia corpului (33 de puncte, MediaPipe Pose
 * Landmarker).
 *
 * Spre deosebire de celelalte native*.ts (Faza 1-4), NU exista logica JS
 * echivalenta de portat — aplicatia nu are inca nicio scorare bazata pe
 * pozitie. Acest modul doar dovedeste ca detectia functioneaza pe un device
 * real; orice formula noua de scor bazata pe cadrare/postura ramane o
 * decizie de produs separata, pentru o discutie explicita.
 */
import { registerPlugin, Capacitor } from '@capacitor/core';
import { nativeImageParams, type NativeImageParams, type NativeImageSource } from './nativeImageSource';

export interface NativePoseLandmark {
  x: number;
  y: number;
  z: number;
  /** Absent daca modelul n-a putut estima vizibilitatea acestui punct. */
  visibility?: number;
}

export interface NativePose {
  landmarks: NativePoseLandmark[];
}

export interface NativePoseDetectionResult {
  people: NativePose[];
}

interface PoseDetectionPluginApi {
  detectPose(options: NativeImageParams): Promise<NativePoseDetectionResult>;
}

const PoseDetectionNative = registerPlugin<PoseDetectionPluginApi>('PoseDetection');

/** Sigur de apelat si pe web — registerPlugin() nu esueaza la incarcare, doar la apelul efectiv al unei metode. */
export function isNativePoseDetectionAvailable(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('PoseDetection');
}

export async function detectPoseNative(source: NativeImageSource): Promise<NativePoseDetectionResult> {
  if (!isNativePoseDetectionAvailable()) {
    throw new Error('Detectia nativa de postura e disponibila doar in aplicatia Android (Capacitor), nu in browser.');
  }
  return PoseDetectionNative.detectPose(await nativeImageParams(source));
}
