/**
 * core/nativeSegmentation.ts
 * Analiza AI nativa (Faza 5) — punte catre plugin-ul Capacitor local
 * Segmentation (vezi android/app/src/main/java/com/luminculler/app/plugins/
 * SegmentationPlugin.kt), separare persoana/fundal pe pixel, MediaPipe Image
 * Segmenter (model selfie_multiclass — scopul e persoana, NU un subiect
 * general ca un produs sau un animal).
 *
 * De ce util: ImageMath.kt (Faza 2, partea JS: workers/faceAnalysis.worker.ts)
 * aproximeaza azi "subiectul" ca o cutie dreptunghiulara de fata — o masca
 * reala pe pixel ar imbunatati precizia comparatiei claritate subiect-vs-fundal
 * (scoreFocusAndBokeh). `personCoverage` ramane NECONECTAT de acea logica —
 * inlocuirea efectiva a mastii dreptunghiulare e un pas de integrare ulterior.
 *
 * La fel ca celelalte native*.ts (Faza 1-4): doar dovedeste ca portul
 * functioneaza pe un device real.
 */
import { registerPlugin, Capacitor } from '@capacitor/core';
import { blobToBase64 } from './base64';

export interface NativeSegmentationResult {
  /** Fractiune 0..1 din cadru clasificata drept persoana (par/corp/fata/haine, nu fundal/altele). */
  personCoverage: number;
  maskWidth: number;
  maskHeight: number;
}

interface SegmentationPluginApi {
  segmentSubject(options: { imageBase64: string }): Promise<NativeSegmentationResult>;
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
