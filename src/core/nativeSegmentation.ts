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
import { luminanceToAlpha } from './imageAdjust';

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
export async function segmentPersonMask(imageBlob: Blob): Promise<{ image: CanvasImageSource; personCoverage: number }> {
  if (!isNativeSegmentationAvailable()) {
    throw new Error('Segmentarea nativa e disponibila doar in aplicatia Android.');
  }
  const imageBase64 = await blobToBase64(imageBlob);
  const { maskBase64, personCoverage } = await SegmentationNative.segmentMask({ imageBase64 });

  const decoded = new Image();
  await new Promise<void>((resolve, reject) => {
    decoded.onload = () => resolve();
    decoded.onerror = () => reject(new Error('Masca de segmentare n-a putut fi decodata.'));
    decoded.src = `data:image/png;base64,${maskBase64}`;
  });

  // Aici se face conversia care lipsea. Masca sosita e DESENATA (alb pe
  // persoana), iar applyBokeh o foloseste cu `destination-out`, care se uita
  // doar la ALPHA — vezi luminanceToAlpha. O singura trecere per poza, pe
  // dimensiunea nativa a mastii (256x256), nu pe cadrul intreg.
  const w = decoded.naturalWidth || 256;
  const h = decoded.naturalHeight || 256;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Masca de segmentare n-a putut fi pregatita.');
  ctx.drawImage(decoded, 0, 0);
  const pixels = ctx.getImageData(0, 0, w, h);
  luminanceToAlpha(pixels.data);
  ctx.putImageData(pixels, 0, 0);

  return { image: canvas, personCoverage };
}
