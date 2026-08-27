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
export async function segmentPersonMask(
  imageBlob: Blob,
  /**
   * Unde stim ca e omul, in fractiuni 0..1 — din fetele detectate la import.
   * Cand e dat, se verifica ORIENTAREA mastii (vezi mai jos). Optional: fara el
   * masca se ia asa cum vine.
   */
  faceHint?: { x: number; y: number; width: number; height: number }
): Promise<{ image: CanvasImageSource; personCoverage: number; inverted: boolean }> {
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

  // VERIFICAREA DE ORIENTARE.
  //
  // De ce exista: masca a iesit o data exact pe dos — se estompa persoana si
  // ramanea clar fundalul. Cauza era semantica indexilor de categorie din
  // MediaPipe, care depinde de cate canale are modelul si nu e scrisa nicaieri
  // raspicat. Am reparat-o la sursa (se foloseste acum masca de incredere), dar
  // o presupunere tacuta care s-a dovedit gresita o data merita o plasa.
  //
  // Verificarea nu costa aproape nimic si nu presupune nimic despre model: daca
  // stim unde e fata, masca TREBUIE sa fie mai "persoana" acolo decat in colturi.
  // Cand nu e, se inverseaza. Fara fata detectata nu se atinge nimic — n-avem
  // pe ce sa ne bazam, iar o inversare gresita ar strica o masca buna.
  const inverted = faceHint ? shouldInvert(pixels, w, h, faceHint) : false;
  if (inverted) {
    for (let i = 3; i < pixels.data.length; i += 4) pixels.data[i] = 255 - pixels.data[i];
  }
  ctx.putImageData(pixels, 0, 0);

  return { image: canvas, personCoverage: inverted ? 1 - personCoverage : personCoverage, inverted };
}

/** Alpha mediu intr-un dreptunghi dat in pixeli, cu marginile taiate la cadru. */
function meanAlpha(pixels: ImageData, x0: number, y0: number, x1: number, y1: number): number {
  const w = pixels.width;
  const sx = Math.max(0, Math.floor(x0)), sy = Math.max(0, Math.floor(y0));
  const ex = Math.min(pixels.width, Math.ceil(x1)), ey = Math.min(pixels.height, Math.ceil(y1));
  let sum = 0, n = 0;
  for (let y = sy; y < ey; y++) {
    for (let x = sx; x < ex; x++) {
      sum += pixels.data[(y * w + x) * 4 + 3];
      n++;
    }
  }
  return n > 0 ? sum / n : 0;
}

/**
 * Masca e pe dos? Se compara cat de "persoana" e in dreptul fetei cu cat e in
 * cele patru colturi, care pe orice cadru normal sunt fundal.
 *
 * Pragul cere o diferenta CLARA, nu orice diferenta: pe un prim-plan foarte
 * strans si colturile pot avea om, iar acolo e mai bine sa nu facem nimic
 * decat sa inversam din eroare.
 */
const INVERSION_MARGIN = 40;

function shouldInvert(
  pixels: ImageData, w: number, h: number,
  face: { x: number; y: number; width: number; height: number }
): boolean {
  const fata = meanAlpha(pixels, face.x * w, face.y * h, (face.x + face.width) * w, (face.y + face.height) * h);
  const c = Math.max(2, Math.round(Math.min(w, h) * 0.12));
  const colturi = (
    meanAlpha(pixels, 0, 0, c, c) +
    meanAlpha(pixels, w - c, 0, w, c) +
    meanAlpha(pixels, 0, h - c, c, h) +
    meanAlpha(pixels, w - c, h - c, w, h)
  ) / 4;
  return colturi - fata > INVERSION_MARGIN;
}
