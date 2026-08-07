/**
 * core/nativeAnalysis.ts
 * Orchestratorul pipeline-ului REAL de analiza pe Android nativ — inlocuieste
 * workers/faceAnalysis.worker.ts (Human.js/TFJS) cu 5 dintre cele 9 plugin-uri
 * native Capacitor dovedite functionale pe device real (vezi butonul de test
 * DEV din MenuDrawer.tsx): FaceDetection, ImageAnalysis, ImageLabeling,
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
 * Recunoasterea faciala nativa NU exista in niciunul din cele 9 module ML
 * Kit/MediaPipe (nu produc embedding de identitate) — dar exista o cale
 * ocolitoare deja folosita in productie pentru inrolare (vezi `recognitionSlot`
 * din core/workerPool.ts): un worker Human.js/TFJS lazy, cu un config redus la
 * strictul necesar (mesh/iris/emotie/CenterNet dezactivate), aplicat DOAR pe
 * decupajul mic al fiecarei fete deja localizate de ML Kit (nu pe poza intreaga
 * si nu pe intreg pipeline-ul greu — exact ce a cauzat crash-urile native
 * anterioare). `recognize`/`knownPersons` mai jos sunt injectate de
 * AnalysisPool.analyze() (nu importate direct — ar crea o dependenta circulara
 * cu workerPool.ts) si sunt opționale: absente pe web (unde acest fisier nu
 * ruleaza deloc) si omise pe native cand nimeni nu e inrolat inca (vezi gardul
 * din workerPool.ts — fara nicio persoana cunoscuta, recunoasterea n-are ce
 * face, deci nu platim deloc costul ei).
 */
import type { AnalysisRecord, FaceInsight, KnownPerson } from './db';
import { classifyScene } from './sceneClassifier';
import { detectFacesNative, type NativeFaceBoundingBox, type NativeFaceDetectionResult, type NativeFaceResult } from './nativeFaceDetection';
import { analyzeImageNative } from './nativeImageAnalysis';
import { labelImageNative } from './nativeImageLabeling';
import { analyzeFaceMeshNative, type NativeFaceMeshInsight } from './nativeFaceMesh';
import { detectTextNative } from './nativeTextRecognition';
import { pickFolderSceneTag } from './sceneTagLabels';

/**
 * Acelasi prag ca groupSmileRatio din faceAnalysis.worker.ts (web) — "zambet
 * clar", nu doar o urma de zambet.
 */
const GROUP_SMILE_THRESHOLD = 0.4;

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

function drawToCanvas(bitmap: ImageBitmap): OffscreenCanvas {
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Nu s-a putut obtine context 2D pentru desenarea imaginii (analiza nativa).');
  ctx.drawImage(bitmap, 0, 0);
  return canvas;
}

function canvasToBlob(canvas: OffscreenCanvas): Promise<Blob> {
  return canvas.convertToBlob({ type: 'image/jpeg', quality: NATIVE_ANALYZE_JPEG_QUALITY });
}

/**
 * Marja adaugata in jurul casetei (stramte) intoarse de ML Kit — worker-ul de
 * recunoastere (faceAnalysis.worker.ts, mod 'recognitionOnly') ruleaza propriul
 * detector BlazeFace pe acest decupaj inainte de a extrage embeddingul, si are
 * nevoie de putin context in jurul fetei (nu doar ochi-nas-gura) ca sa o
 * localizeze fiabil.
 */
const FACE_CROP_MARGIN = 0.4;
/** Sub aceasta latime/inaltime (px, in imaginea originala), un decupaj e prea mic pentru un embedding de incredere — acelasi ordin de marime ca pragul de "fata mica" din classifyScene. */
const MIN_FACE_CROP_PX = 60;
/**
 * Plafon de fete recunoscute per poza — o poza de grup mare ar insuma altfel
 * prea multe apeluri SERIALIZATE (vezi recognitionSlot din workerPool.ts) catre
 * un singur worker, impingand usor analiza spre ANALYZE_TIMEOUT_MS. Fetele
 * peste plafon raman pur si simplu neidentificate (degradare sigura, nu eroare).
 */
const MAX_RECOGNIZED_FACES_PER_PHOTO = 6;

function cropFaceBitmap(
  canvas: OffscreenCanvas,
  box: NativeFaceBoundingBox,
  sourceWidth: number,
  sourceHeight: number
): Promise<ImageBitmap> | null {
  const scaleX = canvas.width / sourceWidth;
  const scaleY = canvas.height / sourceHeight;
  const marginX = box.width * FACE_CROP_MARGIN;
  const marginY = box.height * FACE_CROP_MARGIN;
  const left = Math.max(0, (box.left - marginX) * scaleX);
  const top = Math.max(0, (box.top - marginY) * scaleY);
  const right = Math.min(canvas.width, (box.left + box.width + marginX) * scaleX);
  const bottom = Math.min(canvas.height, (box.top + box.height + marginY) * scaleY);
  const width = Math.round(right - left);
  const height = Math.round(bottom - top);
  if (width < MIN_FACE_CROP_PX || height < MIN_FACE_CROP_PX) return null;
  return createImageBitmap(canvas, Math.round(left), Math.round(top), width, height);
}

// Trebuie sa ramana identic cu RECOGNITION_THRESHOLD din faceAnalysis.worker.ts
// (si cu RETROACTIVE_MATCH_THRESHOLD din state/store.ts) — pragul de decizie
// "e aceeasi persoana" trebuie sa fie acelasi peste tot unde se face comparatia,
// indiferent ce worker/platforma a produs embeddingul.
const NATIVE_RECOGNITION_THRESHOLD = 0.55;

function nativeCosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
}

function matchKnownPerson(embedding: number[], persons: KnownPerson[]): { id: string | null; name: string | null; similarity: number } {
  let best = { id: null as string | null, name: null as string | null, similarity: 0 };
  for (const person of persons) {
    for (const ref of person.embeddings) {
      const sim = nativeCosineSimilarity(embedding, ref);
      if (sim > best.similarity) best = { id: person.id, name: person.name, similarity: sim };
    }
  }
  return best.similarity >= NATIVE_RECOGNITION_THRESHOLD ? best : { id: null, name: null, similarity: best.similarity };
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
    // Valori implicite "necunoscut" — recognizeFaces() (mai jos) le suprascrie
    // DUPA acest pas, per fata, cand exista cel putin o persoana inrolata.
    personId: null,
    personName: null,
    similarity: 0
    // emotion/eyeContact/mouthOpen/catchlight: absente intentionat —
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

/**
 * Ruleaza recunoasterea per-fata (vezi header-ul fisierului) si muteaza
 * FIECARE FaceInsight din `faces` in-place cu rezultatul — index-uri identice
 * cu `faceResult.faces` (ambele construite din aceeasi lista ML Kit, in
 * aceeasi ordine). Esecul unei fete individuale (timeout/eroare worker) nu
 * intrerupe restul — acea fata ramane pur si simplu neidentificata.
 */
async function recognizeFaces(
  canvas: OffscreenCanvas,
  faceResult: NativeFaceDetectionResult,
  faces: FaceInsight[],
  fallbackWidth: number,
  fallbackHeight: number,
  recognize: (crop: ImageBitmap) => Promise<{ embedding: number[]; faceCount: number } | null>,
  knownPersons: KnownPerson[]
): Promise<void> {
  const sourceWidth = faceResult.imageWidth || fallbackWidth;
  const sourceHeight = faceResult.imageHeight || fallbackHeight;
  const candidates = faceResult.faces.slice(0, MAX_RECOGNIZED_FACES_PER_PHOTO);
  for (let i = 0; i < candidates.length; i++) {
    const cropPromise = cropFaceBitmap(canvas, candidates[i].boundingBox, sourceWidth, sourceHeight);
    if (!cropPromise) continue;
    try {
      const crop = await cropPromise;
      let result: { embedding: number[]; faceCount: number } | null;
      try {
        result = await recognize(crop);
      } finally {
        crop.close();
      }
      if (!result?.embedding.length) continue;
      const match = matchKnownPerson(result.embedding, knownPersons);
      const face = faces[i];
      face.embedding = result.embedding;
      face.personId = match.id;
      face.personName = match.name;
      face.similarity = Math.round(match.similarity * 100) / 100;
    } catch (err) {
      console.error('Recunoastere faciala nativa esuata pentru o fata (continuam cu restul):', err);
    }
  }
}

export async function analyzeNative(
  photoId: string,
  bitmap: ImageBitmap,
  recognize?: (crop: ImageBitmap) => Promise<{ embedding: number[]; faceCount: number } | null>,
  knownPersons?: KnownPerson[]
): Promise<AnalysisRecord> {
  const imageWidth = bitmap.width;
  const imageHeight = bitmap.height;
  const canvas = drawToCanvas(bitmap);
  bitmap.close();
  const blob = await canvasToBlob(canvas);

  const faceResult = await detectFacesNative(blob);
  const faces = faceResult.faces.map(f =>
    toFaceInsight(f, faceResult.imageWidth || imageWidth, faceResult.imageHeight || imageHeight)
  );

  if (recognize && knownPersons?.length && faces.length > 0) {
    await recognizeFaces(canvas, faceResult, faces, imageWidth, imageHeight, recognize, knownPersons);
  }

  const imageAnalysis = await analyzeImageNative(blob);

  const labelResult = await labelImageNative(blob);
  // Acelasi tipar de deduplicare ca faceAnalysis.worker.ts: [...new Set(...)].
  const sceneTags = [...new Set(labelResult.labels.map(l => l.label))];

  // FaceMesh e sarit complet cand nu exista fete — nu are ce agrega, si evita
  // un apel MediaPipe intreg (cel mai greu dintre cele 5) fara niciun beneficiu.
  const meshStats = faces.length > 0
    ? faceMeshGroupStats((await analyzeFaceMeshNative(blob)).faces)
    : {};

  // OCR rulat cand nu exista fete SI nu exista nicio eticheta de scena
  // CONCRETA (pickFolderSceneTag ignora etichetele abstracte/non-subiect, ex.
  // "Text", "Photography", "Paper" — vezi NON_FOLDER_SCENE_TAGS in
  // sceneTagLabels.ts) — exact cazul in care hasNoRecognizableSubject
  // (importPipeline.ts) ar bloca deja auto-selectarea; textCoverage
  // confirma/intareste acel semnal pentru documente/capturi de ecran.
  // BUG REAL depistat de audit: conditia veche cerea sceneTags.length===0
  // (nicio eticheta deloc), dar un document fotografiat primeste des exact o
  // eticheta abstracta ca "Text"/"Paper"/"Photography" de la ML Kit — OCR nu
  // mai rula niciodata in cazul concret pentru care a fost construit.
  const textCoverage = faces.length === 0 && !pickFolderSceneTag(sceneTags)
    ? (await detectTextNative(blob)).textCoverage
    : undefined;

  const sceneType = classifyScene(faces, imageWidth, imageHeight);

  return {
    photoId,
    faces,
    faceCount: faces.length,
    // Ramane 0/faceCount daca recognize/knownPersons n-au fost date (web nu
    // ajunge niciodata aici; native fara nicio persoana inrolata) — altfel
    // reflecta rezultatul real al recognizeFaces() de mai sus.
    knownFaceCount: faces.filter(f => f.personId).length,
    strangerCount: faces.filter(f => !f.personId).length,
    bestSmile: faces.length ? Math.max(...faces.map(f => f.smile)) : 0,
    // Acelasi calcul ca faceAnalysis.worker.ts:1121 (web) — omis din portarea
    // initiala pe native (bug real depistat de audit), lasand ContextEngine
    // (PRIOR_WEIGHTS.groupSmileRatio) si groupSelection.ts sa foloseasca mereu
    // valoarea neutra 0.5 in loc de fractia reala de fete care zambesc.
    groupSmileRatio: faces.length ? faces.filter(f => f.smile >= GROUP_SMILE_THRESHOLD).length / faces.length : undefined,
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
