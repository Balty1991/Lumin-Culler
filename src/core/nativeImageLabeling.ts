/**
 * core/nativeImageLabeling.ts
 * Analiza AI nativa (Faza 3, rescrisa) — punte catre plugin-ul Capacitor local
 * ImageLabeling (vezi android/app/src/main/java/com/luminculler/app/plugins/
 * ImageLabelingPlugin.kt), Google ML Kit Image Labeling — inlocuieste vechiul
 * model TFLite coco_ssd_mobilenet_v1 (vocabular FIX de 80 clase COCO, cauza
 * confirmata a 3 etichete gresite pe device real) cu un vocabular de peste
 * 400 de etichete generice (taxonomie Open Images), tot offline/bundle-uit
 * in APK. Detaliile complete ale deciziei sunt in comentariul plugin-ului Kotlin.
 */
import { registerPlugin, Capacitor } from '@capacitor/core';
import { blobToBase64 } from './base64';

export interface NativeImageLabel {
  /**
   * Eticheta in engleza (taxonomie Open Images) — NU mai coincide garantat
   * cu cheile din sceneTagLabels.ts (calibrate pe cele 80 clase COCO folosite
   * de web/faceAnalysis.worker.ts); translateSceneTag() are deja un fallback
   * sigur (eticheta engleza neschimbata) pentru orice cheie negasita.
   */
  label: string;
  score: number;
}

export interface NativeImageLabelingResult {
  labels: NativeImageLabel[];
}

interface ImageLabelingPluginApi {
  labelImage(options: { imageBase64: string }): Promise<NativeImageLabelingResult>;
}

const ImageLabelingNative = registerPlugin<ImageLabelingPluginApi>('ImageLabeling');

/** Sigur de apelat si pe web — registerPlugin() nu esueaza la incarcare, doar la apelul efectiv al unei metode. */
export function isNativeImageLabelingAvailable(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('ImageLabeling');
}

export async function labelImageNative(imageBlob: Blob): Promise<NativeImageLabelingResult> {
  if (!isNativeImageLabelingAvailable()) {
    throw new Error('Etichetarea nativa de imagini e disponibila doar in aplicatia Android (Capacitor), nu in browser.');
  }
  const imageBase64 = await blobToBase64(imageBlob);
  return ImageLabelingNative.labelImage({ imageBase64 });
}
