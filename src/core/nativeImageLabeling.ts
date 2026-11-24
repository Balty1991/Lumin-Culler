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
import { nativeImageParams, type NativeImageParams, type NativeImageSource } from './nativeImageSource';

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
  labelImage(options: NativeImageParams): Promise<NativeImageLabelingResult>;
}

const ImageLabelingNative = registerPlugin<ImageLabelingPluginApi>('ImageLabeling');

/** Sigur de apelat si pe web — registerPlugin() nu esueaza la incarcare, doar la apelul efectiv al unei metode. */
export function isNativeImageLabelingAvailable(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('ImageLabeling');
}

export async function labelImageNative(source: NativeImageSource): Promise<NativeImageLabelingResult> {
  if (!isNativeImageLabelingAvailable()) {
    throw new Error('Etichetarea nativa de imagini e disponibila doar in aplicatia Android (Capacitor), nu in browser.');
  }
  const res = await ImageLabelingNative.labelImage(await nativeImageParams(source));
  return { ...res, labels: trustedLabels(res.labels) };
}

/** Speciile pe care ML Kit le ghicește prea ușor. */
const SPECIES = new Set(['dog', 'cat', 'bird', 'horse', 'rabbit', 'hamster', 'cow', 'sheep', 'goat', 'duck', 'chicken', 'fish', 'bear']);
/** Sub atât, o specie nu e crezută (restul etichetelor rămân la pragul general, 0,6). */
export const SPECIES_MIN = 0.9;
/** Cât de aproape pot fi două specii ca ML Kit să fie socotit nesigur. */
const AMBIGUOUS_GAP = 0.2;

/**
 * ML Kit pune „Dog” cu 0,6–0,75 pe aproape orice: baloane, o pisică, un copil pe pernă
 * (raportat cu etichetele brute: „câine” găsea toate pozele din galerie). O specie trece
 * doar sigură, și doar una dintre câine/pisică: cea mai probabilă.
 */
export function trustedLabels(labels: readonly NativeImageLabel[]): NativeImageLabel[] {
  const species = labels.filter(l => SPECIES.has(l.label.toLowerCase()));
  const best = species.reduce<NativeImageLabel | null>((a, l) => (!a || l.score > a.score ? l : a), null);
  // Două specii cu scoruri apropiate: ML Kit nu știe care e. Raportat: fetița cu pisica
  // ieșea „Dog 0,85, Cat 0,75”. Nicio specie e mai bine decât una greșită („Pet” rămâne).
  const unsure = !!best && species.some(l => l !== best && l.score >= best.score - AMBIGUOUS_GAP);
  return labels.filter(l => {
    if (unsure && SPECIES.has(l.label.toLowerCase())) return false;
    if (!SPECIES.has(l.label.toLowerCase())) return true;
    if (l.score < SPECIES_MIN) return false;
    return l === best || l.score >= 0.95;
  });
}
