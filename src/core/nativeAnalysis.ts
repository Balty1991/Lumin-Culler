/**
 * core/nativeAnalysis.ts
 * Orchestratorul pipeline-ului REAL de analiza pe Android nativ — inlocuieste
 * workers/faceAnalysis.worker.ts (Human.js/TFJS) cu 5 dintre cele 9 plugin-uri
 * native Capacitor dovedite functionale pe device real (vezi butonul de test
 * DEV din MenuDrawer.tsx): FaceDetection, ImageAnalysis, ObjectDetection,
 * FaceMesh, TextRecognition. Apelat din core/workerPool.ts (AnalysisPool),
 * NU direct din importPipeline.ts — call site-ul `analysisPool.analyze(id,
 * bitmap)` ramane neschimbat pe ambele platforme.
 *
 * Module native EXCLUSE intentionat din acest pipeline (decizie explicita,
 * vezi planul de la wiring): ImageClassifier (etichete ImageNet netraduse —
 * ar strica UX-ul de cautare/filtrare care presupune sceneTags traduse),
 * PoseDetection (fara consumator de scor definit), Segmentation (necesita
 * schimbare Kotlin ca sa inlocuiasca masca dreptunghiulara, nu doar consum
 * JS), ImageEmbedder (necesita integrare in hashCompare.worker.ts). Raman
 * "revenim dupa" — de conectat separat, cu propriul lor design.
 *
 * Recunoasterea faciala NU exista pe native (niciunul din cele 9 module nu
 * produce un embedding de identitate) — decizie explicit acceptata de
 * utilizator: knownFaceCount ramane mereu 0, strangerCount = faceCount,
 * fiecare FaceInsight.personId/personName/similarity ramane null/0. Web/PWA
 * ramane neschimbat (foloseste in continuare faceAnalysis.worker.ts, cu
 * recunoastere functionala).
 */
import type { AnalysisRecord, FaceInsight } from './db';
import { classifyScene } from './sceneClassifier';
import { detectFacesNative, type NativeFaceResult } from './nativeFaceDetection';
import { analyzeImageNative } from './nativeImageAnalysis';
import { detectObjectsNative } from './nativeObjectDetection';
import { analyzeFaceMeshNative, type NativeFaceMeshInsight } from './nativeFaceMesh';
import { detectTextNative } from './nativeTextRecognition';

/**
 * ML Kit da o PROBABILITATE de clasificare (0..1, "cat de sigur e ca ochiul e
 * deschis"), un tip de semnal diferit de EAR-ul geometric (Human.js) folosit
 * de BLINK_EAR_THRESHOLD_NORMALIZED in faceAnalysis.worker.ts — cele doua
 * praguri NU sunt menite sa se potriveasca numeric, doar sa produca un
 * rezultat rezonabil pe propria lor scala.
 */
const ML_KIT_EYE_OPEN_THRESHOLD = 0.5;

/**
 * Calitate mare — acelasi blob JPEG e trimis catre pana la 5 modele native
 * diferite (fiecare cu propria lor redimensionare interna), nu doar afisat;
 * artefacte de compresie timpurii s-ar propaga in toate.
 */
const NATIVE_ANALYZE_JPEG_QUALITY = 0.92;

async function bitmapToBlob(bitmap: ImageBitmap): Promise<Blob> {
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Nu s-a putut obtine context 2D pentru conversia in Blob (analiza nativa).');
  ctx.drawImage(bitmap, 0, 0);
  return canvas.convertToBlob({ type: 'image/jpeg', quality: NATIVE_ANALYZE_JPEG_QUALITY });
}

function toFaceInsight(f: NativeFaceResult, imageWidth: number, imageHeight: number): FaceInsight {
  const leftEyeOpen = f.leftEyeOpenProbability ?? 1;
  const rightEyeOpen = f.rightEyeOpenProbability ?? 1;
  return {
    box: [
      f.boundingBox.left / imageWidth,
      f.boundingBox.top / imageHeight,
      f.boundingBox.width / imageWidth,
      f.boundingBox.height / imageHeight
    ],
    // ML Kit nu ofera un scor generic de incredere a detectiei in aceasta API
    // (doar probabilitati per-atribut) — 1 e un neutru sigur, nu o masuratoare.
    faceScore: 1,
    smile: f.smilingProbability ?? 0,
    eyesOpen: { left: leftEyeOpen, right: rightEyeOpen },
    isBlinking: leftEyeOpen < ML_KIT_EYE_OPEN_THRESHOLD || rightEyeOpen < ML_KIT_EYE_OPEN_THRESHOLD,
    // Fara recunoastere nativa (vezi header-ul fisierului) — toate fetele sunt "necunoscute".
    personId: null,
    personName: null,
    similarity: 0
    // embedding/emotion/eyeContact/mouthOpen/catchlight: absente intentionat —
    // ML Kit (FaceDetection) si MediaPipe (FaceMesh) sunt doi detectori
    // INDEPENDENTI, fara corespondenta garantata intre fetele gasite de
    // fiecare; vezi faceMeshGroupStats() mai jos pentru cum foloseste
    // aplicatia semnalele FaceMesh (agregate pe grup, nu per-fata).
  };
}

function average(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * Agrega lista de fete a FaceMesh INDEPENDENT de lista ML Kit (toFaceInsight)
 * — cele doua modele pot gasi un numar/ordine diferite de fete, deci nu
 * incercam sa le potrivim 1:1 pe fata fizica (ar necesita o euristica de
 * suprapunere casete fragila). In schimb calculam direct statisticile de grup
 * pe care AnalysisRecord chiar le consuma (groupGenuineSmileRatio etc.) —
 * FaceMeshMath.kt clasifica deja genuineSmile/awkwardExpression per fata pe
 * partea nativa, deci aici e doar agregare, nu re-implementare de formula.
 */
function faceMeshGroupStats(
  meshFaces: NativeFaceMeshInsight[]
): Pick<AnalysisRecord, 'groupGenuineSmileRatio' | 'groupAwkwardRatio' | 'avgEngagement' | 'avgEyeContact'> {
  if (meshFaces.length === 0) return {};
  return {
    groupGenuineSmileRatio: meshFaces.filter(f => f.genuineSmile).length / meshFaces.length,
    groupAwkwardRatio: meshFaces.filter(f => f.awkwardExpression).length / meshFaces.length,
    avgEngagement: average(meshFaces.map(f => f.engagement)),
    avgEyeContact: average(meshFaces.map(f => f.eyeContact).filter((v): v is number => v !== undefined))
  };
}

export async function analyzeNative(photoId: string, bitmap: ImageBitmap): Promise<AnalysisRecord> {
  const imageWidth = bitmap.width;
  const imageHeight = bitmap.height;
  const blob = await bitmapToBlob(bitmap);
  bitmap.close();

  const faceResult = await detectFacesNative(blob);
  const faces = faceResult.faces.map(f =>
    toFaceInsight(f, faceResult.imageWidth || imageWidth, faceResult.imageHeight || imageHeight)
  );

  const imageAnalysis = await analyzeImageNative(blob);

  const objectResult = await detectObjectsNative(blob);
  // Acelasi tipar de deduplicare ca faceAnalysis.worker.ts: [...new Set(...)].
  const sceneTags = [...new Set(objectResult.objects.map(o => o.label))];

  // FaceMesh e sarit complet cand nu exista fete — nu are ce agrega, si evita
  // un apel MediaPipe intreg (cel mai greu dintre cele 5) fara niciun beneficiu.
  const meshStats = faces.length > 0
    ? faceMeshGroupStats((await analyzeFaceMeshNative(blob)).faces)
    : {};

  // OCR rulat DOAR in cazul ambiguu (fara fete, fara etichete de scena) — exact
  // cazul in care hasNoRecognizableSubject (importPipeline.ts) ar bloca deja
  // auto-selectarea; textCoverage confirma/intareste acel semnal pentru
  // documente/capturi de ecran care ar putea totusi primi din intamplare o
  // eticheta COCO gresita.
  const textCoverage = faces.length === 0 && sceneTags.length === 0
    ? (await detectTextNative(blob)).textCoverage
    : undefined;

  const sceneType = classifyScene(faces, imageWidth, imageHeight);

  return {
    photoId,
    faces,
    faceCount: faces.length,
    knownFaceCount: 0,
    strangerCount: faces.length,
    bestSmile: faces.length ? Math.max(...faces.map(f => f.smile)) : 0,
    allEyesOpen: faces.every(f => !f.isBlinking),
    sceneType,
    aiScore: 0, // completat ulterior de ContextEngine.predict() in importPipeline.ts, la fel ca pe web
    analyzedAt: Date.now(),
    ...imageAnalysis,
    ...meshStats,
    ...(sceneTags.length ? { sceneTags } : {}),
    ...(textCoverage !== undefined ? { textCoverage } : {})
  };
}
