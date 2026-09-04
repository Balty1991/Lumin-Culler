/**
 * core/nativeAnalysis.ts
 * Orchestratorul pipeline-ului REAL de analiza pe Android nativ — inlocuieste
 * workers/faceAnalysis.worker.ts (Human.js/TFJS) cu cele 7 plugin-uri native
 * Capacitor dovedite functionale pe device real (vezi butonul de test DEV din
 * MenuDrawer.tsx): FaceDetection, ImageAnalysis, ImageLabeling, FaceMesh,
 * TextRecognition, PoseDetection, ImageEmbedder. Apelat din core/workerPool.ts (AnalysisPool),
 * NU direct din importPipeline.ts — call site-ul `analysisPool.analyze(id,
 * bitmap)` ramane neschimbat pe ambele platforme.
 *
 * ImageClassifier (EfficientNet-Lite0, etichete ImageNet netraduse) si
 * Segmentation (selfie_multiclass) au fost STERSE, nu doar excluse: erau
 * porturi de proba pe care nimic nu le-a consumat vreodata, iar cele doua
 * modele ale lor — 17,7 MB si 15,6 MB — intrau in fiecare instalare pentru
 * doua randuri dintr-un buton de test care nici nu se randeaza in productie.
 * Se pot reface oricand (un plugin Kotlin + o descarcare in workflow), dar
 * atunci vin cu un consumator real, nu inaintea lui.
 *
 * PoseDetection si ImageEmbedder, in schimb, AU fost conectate intre timp —
 * vezi bodyCroppedAtEdge si imageEmbedding mai jos.
 *
 * Recunoasterea faciala nativa NU exista in niciunul din modulele ML
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
import { embedImageNative } from './nativeImageEmbedder';
import { detectPoseNative, type NativePose } from './nativePoseDetection';
import { pickFolderSceneTag } from './sceneTagLabels';
import { photoTextFromBlocks } from './photoText';
import { hasManufacturedTag } from './smartInbox';
import type { NativeImageSource } from './nativeImageSource';

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

/**
 * Latura maxima a imaginii trimise MODELELOR native, si calitatea ei JPEG.
 *
 * De ce exista: fiecare apel nativ trece imaginea peste puntea Capacitor ca
 * string base64 (vezi core/base64.ts si nativeFaceDetection/ImageLabeling/...),
 * iar o poza trece prin 4-7 astfel de apeluri. La 2048px/q0.92 asta inseamna
 * ~1 MB de JPEG -> ~1,4 MB de base64, serializat si deserializat de fiecare
 * data: cateva MB de marshalling per poza, care nu au nimic de-a face cu
 * inferenta propriu-zisa. La 1280px/q0.85 raman ~2,5-3x mai putini octeti,
 * de fiecare data.
 *
 * De ce e sigur pentru precizie: modelele isi fac oricum propria redimensionare
 * interna, mult sub 1280 (etichetare si embedding ~224px, postura ~256px,
 * detectia de fete ML Kit e documentata sa aiba nevoie de ~100px pe fata —
 * la 1280 o fata cat 10% din cadru inca are ~128px). Cutiile intoarse sunt
 * normalizate la faceResult.imageWidth/Height, deci raman corecte indiferent
 * de scara — vezi cropFaceBitmap, care decupeaza tot din canvas-ul MARE.
 *
 * Ce NU se micsoreaza: decupajele de fata pentru recunoastere (se iau din
 * canvas-ul la rezolutie plina) si OCR-ul, care chiar are nevoie de pixeli ca
 * sa citeasca text mic — acela primeste blob-ul mare, generat doar atunci.
 */
const NATIVE_ANALYZE_MAX_SIDE = 1280;
/** Doar pentru OCR, si doar pe calea cu URI (unde marirea nu costa nimic in plus peste punte). */
const NATIVE_OCR_MAX_SIDE = 2560;
const NATIVE_ANALYZE_SMALL_JPEG_QUALITY = 0.85;

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

/** Copia mica trimisa modelelor. Daca poza e deja sub prag, reincadram acelasi canvas (fara redimensionare inutila), doar la calitatea mai mica. */
function canvasToModelBlob(canvas: OffscreenCanvas): Promise<Blob> {
  const longest = Math.max(canvas.width, canvas.height);
  if (longest <= NATIVE_ANALYZE_MAX_SIDE) {
    return canvas.convertToBlob({ type: 'image/jpeg', quality: NATIVE_ANALYZE_SMALL_JPEG_QUALITY });
  }
  const scale = NATIVE_ANALYZE_MAX_SIDE / longest;
  const small = new OffscreenCanvas(Math.round(canvas.width * scale), Math.round(canvas.height * scale));
  const ctx = small.getContext('2d');
  if (!ctx) throw new Error('Nu s-a putut obtine context 2D pentru copia de analiza (analiza nativa).');
  ctx.drawImage(canvas, 0, 0, small.width, small.height);
  return small.convertToBlob({ type: 'image/jpeg', quality: NATIVE_ANALYZE_SMALL_JPEG_QUALITY });
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
 * Indicii MediaPipe Pose Landmarker (33 de puncte) pentru extremitati — maini/
 * incheieturi si picioare/glezne, exact partile care se "pierd" primele cand
 * cadrul taie un subiect prea aproape. Umeri/solduri/genunchi raman in afara —
 * un genunchi taiat de cadru e o alegere de compozitie obisnuita, nu un defect.
 */
const EXTREMITY_LANDMARK_INDICES = [15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32];
/** Cat de aproape de marginea cadrului (fractiune normalizata) conteaza "posibil taiat". */
const EDGE_MARGIN = 0.03;
/** Sub aceasta incredere de vizibilitate, MediaPipe considera ca probabil a EXTRAPOLAT punctul (nu l-a vazut cu-adevarat). */
const LOW_VISIBILITY_THRESHOLD = 0.5;

/**
 * true daca vreo persoana detectata pare sa aiba o mana/picior taiat de
 * marginea cadrului — combina "aproape de margine" CU "incredere scazuta",
 * fiindca multe poze au deliberat o mana/picior aproape de margine dar clar
 * vizibil (incredere mare); doar combinatia sugereaza ca MediaPipe a
 * EXTRAPOLAT punctul dincolo de cadru, semn ca partea reala a fost taiata.
 * NEVERIFICAT pe un set mare de poze reale (la fel ca alte praguri din acest
 * fisier bazate pe comportamentul documentat, nu calibrat empiric, al
 * modelului) — primul loc de recalibrat daca la testare pe device se
 * dovedeste prea sensibil/insensibil.
 */
function hasAwkwardBodyCrop(people: NativePose[]): boolean {
  for (const pose of people) {
    for (const idx of EXTREMITY_LANDMARK_INDICES) {
      const lm = pose.landmarks[idx];
      if (!lm) continue;
      const nearEdge = lm.x < EDGE_MARGIN || lm.x > 1 - EDGE_MARGIN || lm.y < EDGE_MARGIN || lm.y > 1 - EDGE_MARGIN;
      const lowConfidence = (lm.visibility ?? 1) < LOW_VISIBILITY_THRESHOLD;
      if (nearEdge && lowConfidence) return true;
    }
  }
  return false;
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
  knownPersons?: KnownPerson[],
  /**
   * content:// al pozei din galerie, cand exista. Cu el, partea nativa citeste
   * imaginea singura si NIMIC nu mai trece peste punte: fara codare JPEG in JS,
   * fara base64, fara MB de JSON — de 4-7 ori per poza. Absent (selector de
   * fisiere, RAW decodat in JS) = calea veche, cu blob, neschimbata.
   */
  mediaUri?: string
): Promise<AnalysisRecord> {
  const imageWidth = bitmap.width;
  const imageHeight = bitmap.height;
  const canvas = drawToCanvas(bitmap);
  bitmap.close();
  // Cu URI, nu codam nimic: partea nativa decodeaza o singura data si
  // refoloseste acelasi bitmap pentru toate modelele. Fara URI, blob-ul MIC
  // merge la toate modelele, iar cel mare se genereaza doar daca ajungem la OCR.
  const source: NativeImageSource = mediaUri ? { uri: mediaUri } : { blob: await canvasToModelBlob(canvas) };

  // ── Etapa 1: tot ce nu depinde de nimic, deodata ────────────────────────
  // Aceste trei modele nu au nevoie unul de rezultatul altuia: ImageAnalysis
  // isi face propria detectie de fete (vezi ImageAnalysisPlugin.kt), iar
  // etichetele de scena nu depind de fete deloc. Erau totusi asteptate strict
  // unul dupa altul, deci timpul per poza era SUMA celor 7 modele, nu maximul
  // lor — cu tot ce inseamna asta pe un lot de 400 de poze.
  //
  // Nu multiplica presiunea pe device necontrolat: numarul de poze in zbor
  // ramane plafonat de nativeAnalysisConcurrency() (workerPool.ts), iar toate
  // apelurile pentru aceeasi poza refolosesc UN singur bitmap decodat — vezi
  // decodeUriCached in BitmapUtils.kt, care de-dublica acum si decodarile
  // pornite simultan, exact cazul creat de paralelizarea de aici.
  const [faceResult, imageAnalysis, labelResult] = await Promise.all([
    detectFacesNative(source),
    analyzeImageNative(source),
    labelImageNative(source)
  ]);

  const faces = faceResult.faces.map(f =>
    toFaceInsight(f, faceResult.imageWidth || imageWidth, faceResult.imageHeight || imageHeight)
  );
  // Acelasi tipar de deduplicare ca faceAnalysis.worker.ts: [...new Set(...)].
  const sceneTags = [...new Set(labelResult.labels.map(l => l.label))];

  // ── Etapa 2: tot ce depinde doar de cate fete s-au gasit, iarasi deodata ──
  // Recunoasterea persoanelor merge in acelasi val: ruleaza pe worker-ul
  // Human.js (serializat separat), deci nu concureaza cu modelele native, dar
  // asteptata la rand ii adauga latenta la fiecare poza fara niciun motiv.
  // E singura care MUTA ceva in `faces` (personId/personName), asa ca o
  // asteptam inainte sa numaram cunoscutii/strainii mai jos.
  const recognition = recognize && knownPersons?.length && faces.length > 0
    ? recognizeFaces(canvas, faceResult, faces, imageWidth, imageHeight, recognize, knownPersons)
    : Promise.resolve();

  const [meshStats, imageEmbedding, bodyCroppedAtEdge] = await Promise.all([
    // FaceMesh e sarit complet cand nu exista fete — nu are ce agrega, si evita
    // un apel MediaPipe intreg (cel mai greu dintre cele 5) fara niciun beneficiu.
    faces.length > 0
      ? analyzeFaceMeshNative(source).then(r => faceMeshGroupStats(r.faces))
      : Promise.resolve({}),
    // Embedding general de similaritate — vezi AnalysisRecord.imageEmbedding:
    // doar pentru poze FARA fete (cu fete, embedding-urile faciale sunt deja
    // semnalul puternic pentru rafinarea seriilor in hashCompare.worker.ts).
    faces.length === 0
      ? embedImageNative(source).then(r => r.embedding)
      : Promise.resolve(undefined),
    // Postura — vezi AnalysisRecord.bodyCroppedAtEdge: doar cand exista fete
    // (postura n-are subiect de verificat pe un peisaj/obiect).
    faces.length > 0
      ? detectPoseNative(source).then(r => hasAwkwardBodyCrop(r.people))
      : Promise.resolve(undefined)
  ]);

  // CAND rulam OCR. Doua conditii, si a doua a fost gresita de doua ori.
  //
  // Prima varianta cerea `sceneTags.length === 0` — nicio eticheta deloc. Un
  // document fotografiat primeste insa aproape mereu o eticheta, deci OCR nu
  // rula niciodata pe cazul pentru care fusese construit.
  //
  // A doua varianta (reparatia de la audit) a inlocuit-o cu
  // `!pickFolderSceneTag(sceneTags)`, si comentariul de aici sustinea ca lista
  // NON_FOLDER_SCENE_TAGS contine "Text", "Photography", "Paper". Contine
  // primele doua. NU contine "paper" — verificat. Deci pentru un panou de
  // pluta plin de bonuri, ML Kit intoarce "Paper" ca eticheta de top,
  // pickFolderSceneTag o accepta drept subiect concret, OCR-ul e SARIT, iar
  // hasNoRecognizableSubject nu mai are ce semnal sa citeasca. Bug raportat cu
  // captura: panoul cu bonuri, scor 98, aprobat automat cu bifa verde.
  //
  // Cauza de fond e ca ambele variante intreaba "nu s-a recunoscut nimic?".
  // Un document CHIAR se recunoaste — ca hartie. A doua conditie, de acum,
  // intreaba si invers: daca s-a recunoscut ceva si acel ceva e un lucru
  // fabricat (hartie, bon, ambalaj, aparat), atunci merita citit textul.
  //
  // OCR cere rezolutie PLINA: e singurul model din lant care chiar depinde de
  // pixeli (text mic pe un buletin/o captura de ecran), si ruleaza rar. Cu URI
  // cerem doar o latura mai mare — tot fara nimic peste punte. Declansatorul
  // nou nu-l face sa ruleze pe peisaje, animale sau mancare: niciunul n-are
  // etichete de lucru fabricat.
  // Se pastreaza si CUVINTELE, nu doar cat la suta din cadru acopera. Erau
  // aruncate: OCR-ul rula, iar din tot ce citea se folosea o singura cifra.
  // Vezi core/photoText.ts — cuvintele alea sunt exact ce face pozele astea
  // gasibile mai tarziu ("bonul de la service", "parola de wifi").
  const ocr = faces.length === 0
    && (!pickFolderSceneTag(sceneTags) || hasManufacturedTag(sceneTags))
    ? await detectTextNative(
        mediaUri
          ? { uri: mediaUri, maxSide: NATIVE_OCR_MAX_SIDE }
          : { blob: await canvasToBlob(canvas) }
      )
    : undefined;
  const textCoverage = ocr?.textCoverage;
  const ocrText = ocr ? photoTextFromBlocks(ocr.blocks) : undefined;

  // Recunoasterea a rulat in paralel cu etapa 2; abia acum avem voie sa numaram
  // cunoscutii/strainii, fiindca ea e cea care completeaza personId pe fete.
  await recognition;

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
    ...(textCoverage !== undefined ? { textCoverage } : {}),
    ...(ocrText !== undefined ? { ocrText } : {}),
    ...(imageEmbedding ? { imageEmbedding } : {}),
    ...(bodyCroppedAtEdge !== undefined ? { bodyCroppedAtEdge } : {})
  };
}
