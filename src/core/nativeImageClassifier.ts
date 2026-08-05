/**
 * core/nativeImageClassifier.ts
 * Analiza AI nativa (Faza 4) — punte catre plugin-ul Capacitor local
 * ImageClassifier (vezi android/app/src/main/java/com/luminculler/app/plugins/
 * ImageClassifierPlugin.kt), model EfficientNet-Lite0 (Google AI Edge,
 * ImageNet-1000) — etichete de scena/animal/peisaj MAI BOGATE decat cele 80
 * COCO din nativeObjectDetection.ts (Faza 3), complementare, nu inlocuitoare
 * (acela da cutii precise, acesta da etichete pentru tot cadrul, fara
 * localizare).
 *
 * Etichetele raman in engleza — vezi sceneTagLabels.ts, traducerea se face
 * STRICT la afisare, iar acest plugin ramane dormant/dev-only pentru moment.
 *
 * La fel ca celelalte native*.ts (Faza 1-3): doar dovedeste ca portul
 * functioneaza pe un device real, nu e inca legat de fluxul real de analiza.
 */
import { registerPlugin, Capacitor } from '@capacitor/core';
import { blobToBase64 } from './base64';

export interface NativeImageLabel {
  /** Eticheta in engleza (ImageNet-1000), NEtradusa inca. */
  label: string;
  score: number;
}

export interface NativeImageClassifierResult {
  labels: NativeImageLabel[];
}

interface ImageClassifierPluginApi {
  classifyImage(options: { imageBase64: string }): Promise<NativeImageClassifierResult>;
}

const ImageClassifierNative = registerPlugin<ImageClassifierPluginApi>('ImageClassifier');

/** Sigur de apelat si pe web — registerPlugin() nu esueaza la incarcare, doar la apelul efectiv al unei metode. */
export function isNativeImageClassifierAvailable(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('ImageClassifier');
}

export async function classifyImageNative(imageBlob: Blob): Promise<NativeImageClassifierResult> {
  if (!isNativeImageClassifierAvailable()) {
    throw new Error('Clasificarea nativa de imagine e disponibila doar in aplicatia Android (Capacitor), nu in browser.');
  }
  const imageBase64 = await blobToBase64(imageBlob);
  return ImageClassifierNative.classifyImage({ imageBase64 });
}
