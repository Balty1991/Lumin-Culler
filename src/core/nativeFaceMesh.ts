/**
 * core/nativeFaceMesh.ts
 * Analiza AI nativa (Faza 4) — punte catre plugin-ul Capacitor local FaceMesh
 * (vezi android/app/src/main/java/com/luminculler/app/plugins/FaceMeshPlugin.kt
 * + FaceMeshMath.kt), port catre MediaPipe Face Landmarker al semnalelor fine
 * de fata din faceAnalysis.worker.ts (zambet autentic, emotie aproximata,
 * contact vizual) — dincolo de simpla detectie+procent zambet din Faza 1
 * (ML Kit).
 *
 * emotionSurprise/emotionNegative/engagement/eyeContact sunt APROXIMARI din
 * blendshape-uri MediaPipe (coeficienti de pozitie musculara), NU un port fidel
 * al modelului de emotie dedicat (FER) folosit de Human.js in JS — Google nu
 * publica un clasificator de emotie oficial (vezi comentariul din
 * FaceMeshMath.kt pentru motiv).
 *
 * LEGAT de fluxul real de analiza — apelat din core/nativeAnalysis.ts
 * (orchestratorul pipeline-ului nativ), el insusi apelat din
 * core/workerPool.ts (AnalysisPool) pe Android/Capacitor, DOAR cand exista
 * cel putin o fata detectata (vezi faceMeshGroupStats in nativeAnalysis.ts).
 */
import { registerPlugin, Capacitor } from '@capacitor/core';
import { nativeImageParams, type NativeImageParams, type NativeImageSource } from './nativeImageSource';

export interface NativeFaceMeshInsight {
  /** = emotion.happy aproximat (acelasi lucru ca FaceInsight.smile din JS). */
  smile: number;
  emotionSurprise: number;
  emotionNegative: number;
  eyesOpen: { left: number; right: number };
  mouthOpen: boolean;
  genuineSmile: boolean;
  awkwardExpression: boolean;
  engagement: number;
  /** Absent daca matricea de transformare faciala n-a putut fi obtinuta pentru aceasta fata. */
  eyeContact?: number;
}

export interface NativeFaceMeshResult {
  faces: NativeFaceMeshInsight[];
}

interface FaceMeshPluginApi {
  analyzeFaceMesh(options: NativeImageParams): Promise<NativeFaceMeshResult>;
}

const FaceMeshNative = registerPlugin<FaceMeshPluginApi>('FaceMesh');

/** Sigur de apelat si pe web — registerPlugin() nu esueaza la incarcare, doar la apelul efectiv al unei metode. */
export function isNativeFaceMeshAvailable(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('FaceMesh');
}

export async function analyzeFaceMeshNative(source: NativeImageSource): Promise<NativeFaceMeshResult> {
  if (!isNativeFaceMeshAvailable()) {
    throw new Error('Analiza nativa de fata (mesh) e disponibila doar in aplicatia Android (Capacitor), nu in browser.');
  }
  return FaceMeshNative.analyzeFaceMesh(await nativeImageParams(source));
}
