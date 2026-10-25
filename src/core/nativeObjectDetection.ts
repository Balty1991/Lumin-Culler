/**
 * core/nativeObjectDetection.ts
 * Cutii de obiecte, ca să decupăm animalul înainte de embedding.
 * ML Kit Image Labeling nu dă cutii. Detectorul de obiecte da.
 */
import { registerPlugin, Capacitor } from '@capacitor/core';
import { nativeImageParams, type NativeImageParams, type NativeImageSource } from './nativeImageSource';

export interface NativeObjectBox {
  x: number;
  y: number;
  w: number;
  h: number;
  label?: string;
  score?: number;
}

export interface NativeObjectDetectionResult {
  objects: NativeObjectBox[];
}

interface ObjectDetectionPluginApi {
  detectObjects(options: NativeImageParams): Promise<NativeObjectDetectionResult>;
}

const ObjectDetectionNative = registerPlugin<ObjectDetectionPluginApi>('ObjectDetection');

export function isNativeObjectDetectionAvailable(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('ObjectDetection');
}

export async function detectObjectsNative(source: NativeImageSource): Promise<NativeObjectDetectionResult> {
  if (!isNativeObjectDetectionAvailable()) {
    throw new Error('Detecția de obiecte e disponibilă doar în aplicația Android.');
  }
  return ObjectDetectionNative.detectObjects(await nativeImageParams(source));
}
