/**
 * core/nativeSegmentation.ts
 * Punte catre plugin-ul Capacitor local Segmentation (vezi android/app/src/
 * main/java/com/luminculler/app/plugins/SegmentationPlugin.kt): separare
 * persoana/fundal pe pixel, MediaPipe Image Segmenter, model SelfieSegmenter
 * (omul, NU un subiect general ca un produs sau un animal).
 *
 * Nu e un port de proba: segmentPersonMask() e ce face bokeh-ul din editor sa
 * urmareasca CONTURUL omului in loc de o elipsa in jurul fetei.
 *
 * `personCoverage` ramane, in schimb, neconectat de scoreFocusAndBokeh din
 * analiza (workers/faceAnalysis.worker.ts), care aproximeaza subiectul cu o
 * caseta de fata. Ar fi o imbunatatire reala, dar muta scoruri pe toata
 * biblioteca — decizie separata.
 */
import { registerPlugin, Capacitor } from '@capacitor/core';
import { blobToBase64 } from './base64';

export interface NativeSegmentationResult {
  /** Fractiune 0..1 din cadru clasificata drept persoana (par/corp/fata/haine, nu fundal/altele). */
  personCoverage: number;
  maskWidth: number;
  maskHeight: number;
}

/** Masca persoanei: PNG alb-negru, ALB unde e persoana. Vezi segmentMask in plugin. */
export interface NativeSegmentationMask {
  maskBase64: string;
  maskWidth: number;
  maskHeight: number;
  personCoverage: number;
}

interface SegmentationPluginApi {
  segmentSubject(options: { imageBase64: string }): Promise<NativeSegmentationResult>;
  segmentMask(options: { imageBase64: string } | { imageUri: string; maxSide?: number }): Promise<NativeSegmentationMask>;
}

const SegmentationNative = registerPlugin<SegmentationPluginApi>('Segmentation');

/** Sigur de apelat si pe web — registerPlugin() nu esueaza la incarcare, doar la apelul efectiv al unei metode. */
export function isNativeSegmentationAvailable(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('Segmentation');
}

export async function segmentSubjectNative(imageBlob: Blob): Promise<NativeSegmentationResult> {
  if (!isNativeSegmentationAvailable()) {
    throw new Error('Segmentarea nativa e disponibila doar in aplicatia Android (Capacitor), nu in browser.');
  }
  const imageBase64 = await blobToBase64(imageBlob);
  return SegmentationNative.segmentSubject({ imageBase64 });
}

/**
 * Masca persoanei, ca <img> gata de pus pe canvas.
 *
 * Se intoarce un HTMLImageElement, nu octeti: masca ajunge oricum intr-un
 * `drawImage`, iar browserul o scaleaza singur la dimensiunea cadrului —
 * modelul lucreaza la 256x256, poza poate avea 4000px, si nu vrem sa
 * reesantionam noi o masca pe care GPU-ul o intinde mai bine.
 *
 * Arunca daca segmentarea nu e disponibila sau esueaza; apelantul decide ce
 * spune omului si daca revine la varianta cu casetele de fata.
 */
export async function segmentPersonMask(imageBlob: Blob): Promise<{ image: HTMLImageElement; personCoverage: number }> {
  if (!isNativeSegmentationAvailable()) {
    throw new Error('Segmentarea nativa e disponibila doar in aplicatia Android.');
  }
  const imageBase64 = await blobToBase64(imageBlob);
  const { maskBase64, personCoverage } = await SegmentationNative.segmentMask({ imageBase64 });

  const image = new Image();
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error('Masca de segmentare n-a putut fi decodata.'));
    image.src = `data:image/png;base64,${maskBase64}`;
  });
  return { image, personCoverage };
}
