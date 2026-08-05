/// <reference lib="webworker" />
/**
 * workers/faceAnalysis.worker.ts
 *
 * Real ML face analysis on a dedicated thread. The main UI thread NEVER runs
 * inference — it only posts ImageBitmaps here (zero-copy transferables) and
 * receives structured JSON back via Comlink.
 *
 * Engine: @vladmandic/human (TensorFlow.js runtime) which bundles:
 *   - BlazeFace detector
 *   - MediaPipe Face Mesh (468 landmarks) → eye-open computation via EAR
 *   - Emotion head → smile score
 *   - FaceRes descriptor (1024-dim embedding) → known-person recognition
 *
 * Usage from main thread (via a WorkerPool):
 *   const api = Comlink.wrap<FaceAnalysisAPI>(new Worker(new URL('./faceAnalysis.worker.ts', import.meta.url), { type: 'module' }));
 *   await api.init();
 *   await api.setKnownPersons(await db.persons.toArray());
 *   const result = await api.analyze(photoId, Comlink.transfer(bitmap, [bitmap]));
 */

import * as Comlink from 'comlink';
import { Human, type Config, type FaceResult, type ObjectResult, type BackendEnum } from '@vladmandic/human';
import type { AnalysisRecord, FaceInsight, KnownPerson } from '../core/db';

// ── Config ───────────────────────────────────────────────────────────────────

/**
 * EXPERIMENTAL — DEZACTIVAT dupa testare pe device real: pe cel putin un
 * telefon a blocat complet incarcarea modelelor AI ("Se incarca modelele AI"
 * la infinit). Cauza cea mai probabila: `tf.env()` e un singleton GLOBAL in
 * acest worker thread (nu per-instanta Human), asa ca daca prima incercare
 * (cu F16) ramane "agatata" in driverul GPU in loc sa arunce eroare curat —
 * exact modul de esec descris mai jos la cascada WebGPU/WebGL — flagul
 * ramane setat pe true si pentru incercarea de refugiu FARA F16, care atunci
 * loveste acelasi blocaj a doua oara. Nu se reactiveaza fara fix real (measu
 * explicit `.set(..., false)` in ramura non-F16, nu doar omiterea set-ului)
 * si fara re-validare pe device.
 */
const EXPERIMENTAL_WEBGL_F16_TEXTURES = false;

const HUMAN_CONFIG: Partial<Config> = {
  // Models served locally from /public/models (copied from @vladmandic/human/models)
  // so the app works offline and on GitHub Pages without third-party CDNs.
  modelBasePath: '/models/',
  // backend e suprascris dinamic in init() (WebGPU cand e disponibil, altfel webgl) —
  // valoarea de aici e doar fallback-ul implicit daca ceva impiedica acea logica.
  backend: 'webgl',           // human falls back to wasm automatically if unavailable
  cacheSensitivity: 0,        // photos are independent frames — never skip inference
  filter: { enabled: false },
  face: {
    enabled: true,
    detector: { maxDetected: 15, rotation: true, minConfidence: 0.35 },
    mesh: { enabled: true },
    iris: { enabled: true },
    emotion: { enabled: true, minConfidence: 0.2 },
    description: { enabled: true }   // produces the 1024-dim recognition embedding
  },
  body: { enabled: false },
  hand: { enabled: false },
  // CenterNet (COCO-80 clase) — deja parte din pachetul Human, zero model nou de descarcat.
  // Ruleaza in ACELASI human.detect() ca fetele (nicio trecere de inferenta in plus per poza) —
  // etichete generale de obiect (caine, masina, tort, barca...) pentru export XMP/filtrare.
  object: { enabled: true, minConfidence: 0.25, maxDetected: 8 },
  gesture: { enabled: false },
  segmentation: { enabled: false }
};

// MediaPipe Face Mesh landmark indices for Eye Aspect Ratio (EAR)
const LEFT_EYE = { top: 159, bottom: 145, inner: 133, outer: 33 };
const RIGHT_EYE = { top: 386, bottom: 374, inner: 362, outer: 263 };
// Acelasi principiu (raport geometric intre puncte de mesh), pentru gura —
// buza superioara/inferioara interioara (13/14) si colturile gurii (61/291),
// indici standard MediaPipe Face Mesh (aceiasi folositi peste tot in literatura
// pentru Mouth Aspect Ratio — MAR).
const MOUTH = { top: 13, bottom: 14, left: 61, right: 291 };

const RECOGNITION_THRESHOLD = 0.55; // cosine similarity above this = known person
const BLINK_EAR_THRESHOLD = 0.18;
// eyeOpenness() normalizeaza EAR brut cu (ear - 0.08) / 0.25 — pragul de blink trebuie
// trecut prin ACEEASI transformare, altfel comparatia se face pe scari diferite (bug real
// gasit de auditul QA: fara scaderea celor 0.08, pragul efectiv pe EAR brut ajungea ~0.26 in
// loc de 0.18, marcand ochi normal deschisi ca "clipiti").
const BLINK_EAR_THRESHOLD_NORMALIZED = (BLINK_EAR_THRESHOLD - 0.08) / 0.25;
const GROUP_SMILE_THRESHOLD = 0.4; // prag peste care o fata e considerata "zambitoare" pentru rate de grup
/**
 * Prag de "ochi ingustati" sub care un zambet e considerat autentic (marker
 * Duchenne), NU o presupunere — calibrat pe date reale: 90 de fete (40 zambet
 * autentic / 50 fortat, imagini generate AI dar rulate prin ACEEASI pipeline
 * Human.js/eyeOpenness folosita in productie) au dat eyeOpen mediu 0.657
 * (autentic) vs 0.873 (fortat), o diferenta mare fata de deviatia standard a
 * fiecarui grup (~0.14) — pragul de mai jos e media celor doua. Limitare
 * onesta: fete generate AI, nu momente reale capturate — un semnal la nivel
 * de populatie (ca toate celelalte praguri din acest fisier), nu o calibrare
 * per-persoana (n-avem o poza neutra de referinta pentru fiecare subiect).
 */
const GENUINE_SMILE_EYE_THRESHOLD = 0.77;
/**
 * Prag empiric pe Mouth Aspect Ratio brut (vertical/orizontal, nemodificat) —
 * gura inchisa sau un zambet normal (chiar cu dinti vizibili) raman de obicei
 * sub acest raport; un cascat sau o gura larg deschisa "la mijlocul cuvantului"
 * il depaseste clar. Aceeasi natura ca BLINK_EAR_THRESHOLD: o aproximare
 * geometrica rezonabila, nu o valoare calibrata pe un set mare de poze reale.
 */
const MOUTH_OPEN_THRESHOLD = 0.32;
/** Sub aceste incredere/suprafata, un obiect CenterNet e prea nesigur/mic ca sa fie tratat drept "subiectul" pozei. */
const MAIN_OBJECT_MIN_SCORE = 0.3;
const MAIN_OBJECT_MIN_AREA = 0.03; // fractiune din cadru — acelasi ordin de marime ca pragul de "fata mica" din classifyScene

/**
 * Cat asteptam incarcarea/warmup-ul pe WebGPU inainte sa renuntam si sa trecem
 * fortat la WebGL. `navigator.gpu` poate exista ca obiect fara sa existe un
 * adaptor GPU real compatibil (Chromium headless, drivere vechi/blocklist-uite,
 * politici ale browserului) — in acel caz Human/TFJS ramane blocat la infinit
 * in interiorul load()/warmup(), fara sa arunce nicio eroare, ceea ce ar bloca
 * definitiv init() (deci intreg pipeline-ul de import) fara acest timeout.
 */
const WEBGPU_INIT_TIMEOUT_MS = 6000;
/**
 * Acelasi tip de plasa de siguranta ca WEBGPU_INIT_TIMEOUT_MS, dar pentru WebGL —
 * confirmat pe teren (nu doar in sandbox): pe unele telefoane (drivere GPU
 * restrictive/blocklist-uite de Chromium, ex. raportat pe MIUI/Xiaomi, reprodus
 * atat in Chrome cat si in Xiaomi Browser pe acelasi device) chiar si WebGL
 * ramane blocat la infinit in load()/warmup(), nu doar WebGPU. Timeout mai mare
 * decat cel de WebGPU: warmup-ul GPU real (nu doar detectia unui adaptor lipsa)
 * poate dura legitim mai mult pe hardware mobil mai slab.
 */
const WEBGL_INIT_TIMEOUT_MS = 20000;

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(message)), ms))
  ]);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
}

function dist(p1: number[], p2: number[]): number {
  return Math.hypot(p1[0] - p2[0], p1[1] - p2[1]);
}

/** Eye Aspect Ratio → normalized "openness" 0..1 from mesh landmarks. */
function eyeOpenness(mesh: number[][], eye: typeof LEFT_EYE): number {
  const vertical = dist(mesh[eye.top], mesh[eye.bottom]);
  const horizontal = dist(mesh[eye.inner], mesh[eye.outer]);
  if (horizontal === 0) return 0;
  const ear = vertical / horizontal;                  // typical open ≈ 0.28–0.35
  return Math.min(1, Math.max(0, (ear - 0.08) / 0.25));
}

/** Mouth Aspect Ratio brut (vertical/orizontal) din mesh — vezi MOUTH_OPEN_THRESHOLD. */
function mouthAspectRatio(mesh: number[][]): number {
  const horizontal = dist(mesh[MOUTH.left], mesh[MOUTH.right]);
  if (horizontal === 0) return 0;
  return dist(mesh[MOUTH.top], mesh[MOUTH.bottom]) / horizontal;
}

/**
 * Regiunea (in coordonate PIXEL, aceleasi cu mesh-ul, NU normalizate) din care
 * decupam un ochi pentru catchlight — patrata, centrata pe ochi, cu o marja de
 * 60% peste latimea ochiului ca sa prindem si irisul/pupila, nu doar fanta
 * ingusta dintre pleoape.
 */
function eyeCropBox(mesh: number[][], eye: typeof LEFT_EYE): { x: number; y: number; size: number } {
  const cx = (mesh[eye.inner][0] + mesh[eye.outer][0]) / 2;
  const cy = (mesh[eye.top][1] + mesh[eye.bottom][1]) / 2;
  const size = Math.max(4, dist(mesh[eye.inner], mesh[eye.outer]) * 1.6);
  return { x: cx - size / 2, y: cy - size / 2, size };
}

/**
 * Catchlight ("lumina in ochi") — un reper clasic de portret: un punct mic si
 * luminos reflectat pe cornee (de la o fereastra, blitz, orice sursa de lumina)
 * face privirea sa para "vie"; absenta lui, ochi "stinsi". Cautam exact asta —
 * un varf de luminanta LOCALIZAT (nu tot ochiul luminos, care ar insemna doar
 * o poza supraexpusa) — nu o simulare, doar cea mai luminoasa pata din decupaj
 * comparata cu media restului (fara o mica vecinatate in jurul ei). Pragurile
 * (200 luminanta absoluta, +60 fata de rest) sunt o aproximare rezonabila
 * ("prag empiric", ca restul detectorilor din acest fisier), nu calibrate pe
 * un set mare de poze reale.
 */
export function detectCatchlight(crop: ImageData): boolean {
  const gray = toGray(crop);
  const w = crop.width, h = crop.height;
  let maxLum = 0, maxIdx = -1;
  for (let i = 0; i < gray.length; i++) {
    if (gray[i] > maxLum) { maxLum = gray[i]; maxIdx = i; }
  }
  if (maxLum < 200 || maxIdx < 0) return false;
  const mx = maxIdx % w, my = Math.floor(maxIdx / w);
  const excludeRadius = Math.max(1, Math.round(Math.min(w, h) * 0.15));
  let sum = 0, n = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (Math.hypot(x - mx, y - my) <= excludeRadius) continue;
      sum += gray[y * w + x]; n++;
    }
  }
  if (!n) return false;
  return maxLum - sum / n >= 60;
}

/**
 * Cel mai mare obiect CenterNet suficient de sigur/mare ca sa fie tratat drept
 * "subiectul" pozei — folosit DOAR cand nu exista nicio fata (poza fara oameni:
 * macro, produs, animale), pentru scoreFocusAndBokeh mai jos. Preferam
 * suprafata (nu scorul de incredere brut) pentru ca cel mai relevant obiect
 * pentru un fotograf care triaza e de obicei cel care domina cadrul, nu cel
 * mai "sigur" detectat intr-un colt.
 */
export function mainObjectBox(objects: ObjectResult[]): [number, number, number, number] | undefined {
  const candidates = objects.filter(o => o.score >= MAIN_OBJECT_MIN_SCORE && o.boxRaw[2] * o.boxRaw[3] >= MAIN_OBJECT_MIN_AREA);
  if (!candidates.length) return undefined;
  const best = candidates.reduce((a, b) => (a.boxRaw[2] * a.boxRaw[3] > b.boxRaw[2] * b.boxRaw[3] ? a : b));
  return best.boxRaw;
}

// ── Emotie completa + contact vizual ────────────────────────────────────────
// Sursa pentru gaze: Human.js calculeaza rotation.gaze.{bearing,strength} din
// offset-ul irisului fata de centrul ochiului (necesita mesh 478pct, iris
// activat — vezi HUMAN_CONFIG). Am citit sursa librariei (src/face/angles.ts)
// ca sa confirm semantica: "strength" = cat de departe e irisul de centru
// (0 = centrat/priveste direct, mai mare = deviaza), "bearing" = directia
// devierii. Folosim DOAR magnitudinea (strength + |yaw|/|pitch|), nu directia
// — elimina riscul unei conventii de semn gresite (stanga/dreapta), singurul
// motiv pentru care am amanat initial aceasta functie.

/** Extrage toate cele 7 emotii (model FER standard) intr-un rezumat pe 4 axe utile pentru scorare. */
function extractEmotion(face: FaceResult): { happy: number; surprise: number; neutral: number; negative: number } {
  const scores = face.emotion ?? [];
  const get = (name: string) => scores.find(e => e.emotion === name)?.score ?? 0;
  const negative = get('angry') + get('disgust') + get('sad') + get('fear');
  return {
    happy: get('happy'),
    surprise: get('surprise'),
    neutral: get('neutral'),
    negative: Math.min(1, negative)
  };
}

/** Scor 0..1 de "expresie pozitiva" (engagement) — neutru (fara nicio emotie dominanta) = 0.5. */
function engagementScore(emotion: { happy: number; surprise: number; negative: number }): number {
  return Math.max(0, Math.min(1, 0.5 + 0.5 * emotion.happy + 0.25 * emotion.surprise - 0.5 * emotion.negative));
}

/**
 * "Stanjenitor" = gura vizibil deschisa (mouthOpen, geometric) FARA nicio
 * emotie care sa explice/justifice acea deschidere — un zambet larg sau o
 * surpriza reala au tot gura deschisa, dar sunt expresii DORITE; un moment
 * prins "la mijlocul cuvantului" sau un cascat nu au nici zambet, nici
 * surpriza. Pragurile pe happy/surprise sunt deliberat joase (0.3): vrem sa
 * excludem orice urma reala a acestor emotii, nu doar cazul lor dominant.
 */
export function isAwkwardExpression(face: FaceInsight): boolean {
  if (!face.mouthOpen) return false;
  const happy = face.emotion?.happy ?? 0;
  const surprise = face.emotion?.surprise ?? 0;
  return happy < 0.3 && surprise < 0.3;
}

/**
 * Zambet autentic (marker Duchenne) — vezi GENUINE_SMILE_EYE_THRESHOLD pentru
 * datele de calibrare. Necesita ambele: zambet real (nu doar gura deschisa,
 * ci scorul de "happy" peste acelasi prag folosit la groupSmileRatio) SI ochii
 * usor ingustati fata de un zambet fortat/pozat.
 */
export function isGenuineSmile(face: FaceInsight): boolean {
  if (face.smile < GROUP_SMILE_THRESHOLD) return false;
  const eyeOpen = (face.eyesOpen.left + face.eyesOpen.right) / 2;
  return eyeOpen < GENUINE_SMILE_EYE_THRESHOLD;
}

/**
 * Fractiunea de fete cu zambet autentic — undefined (nicio afirmatie) cand nu
 * exista fete SAU cand lumina e 'hard' (puternica/directa): ochii ingustati
 * intr-o astfel de lumina pot insemna clipit de la soare, nu zambet, si
 * isGenuineSmile nu poate distinge intre cele doua cauze din geometria mesh-ului
 * — mai sigur sa nu masuram deloc decat sa riscam un fals pozitiv/negativ.
 */
export function computeGroupGenuineSmileRatio(
  faces: FaceInsight[], lightQuality: NonNullable<AnalysisRecord['lightQuality']>
): number | undefined {
  if (!faces.length || lightQuality === 'hard') return undefined;
  return faces.filter(isGenuineSmile).length / faces.length;
}

const EYE_CONTACT_ANGLE_LIMIT = 0.6;  // radiani (~34°) — combinat yaw+pitch peste asta = clar intors
const EYE_CONTACT_GAZE_LIMIT = 0.3;   // strength peste asta = iris clar deviat de la centrul ochiului

/** Contact vizual estimat 0..1 din pozitia capului + directia irisului. 0.5 (neutru) daca datele lipsesc. */
function eyeContactScore(face: FaceResult): number {
  const rotation = face.rotation;
  if (!rotation) return 0.5;
  const yaw = Math.abs(rotation.angle?.yaw ?? 0);
  const pitch = Math.abs(rotation.angle?.pitch ?? 0);
  const gazeStrength = Math.abs(rotation.gaze?.strength ?? 0);
  const headScore = Math.max(0, 1 - (yaw + pitch * 0.7) / EYE_CONTACT_ANGLE_LIMIT);
  const gazeScore = Math.max(0, 1 - gazeStrength / EYE_CONTACT_GAZE_LIMIT);
  return Math.max(0, Math.min(1, 0.6 * headScore + 0.4 * gazeScore));
}

/** Aceeasi scalare pentru orice varianta Laplaciana (globala sau regionala) -> scor comparabil 0..100. */
export function varianceToSharpnessScore(variance: number): number {
  return Math.min(100, Math.round(Math.sqrt(Math.max(0, variance)) * 2.2));
}

/** Laplacian variance sharpness on a downsampled grayscale — 0..100. */
function laplacianSharpness(img: ImageData): number {
  const { data, width: w, height: h } = img;
  const gray = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    gray[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
  }
  let sum = 0, sumSq = 0, n = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const lap = gray[i - w] + gray[i + w] + gray[i - 1] + gray[i + 1] - 4 * gray[i];
      sum += lap; sumSq += lap * lap; n++;
    }
  }
  const variance = sumSq / n - (sum / n) ** 2;
  return varianceToSharpnessScore(variance);
}

/**
 * Claritatea principala ("sharpness", cel mai puternic ponderat criteriu din
 * ContextEngine — PRIOR_WEIGHTS.sharpness = 0.9) masurata pe TOT cadrul poate
 * insela sistematic la poze cu subiect uman: un fundal aglomerat/texturat (nu
 * neclar deloc) poate impinge varianta globala in sus chiar daca fata e usor
 * neclara, iar un bokeh intentionat (subiect clar, fundal difuz de-adevaratelea)
 * poate impinge varianta globala in jos, penalizand nedrept exact tehnica pe
 * care fotograful o cauta. Cand exista fete detectate SI regiunea lor e destul
 * de mare pentru o masuratoare stabila (subjectVariance >= 0, vezi
 * regionLaplacianVariance), amestecam 70% claritatea subiectului + 30% cea
 * globala — subiectul conteaza cel mai mult pentru un fotograf care triaza
 * portrete, dar pastram si o parte din masura globala (blur de miscare/
 * tremur de camera afecteaza de obicei tot cadrul, deci tot conteaza).
 * Fara fete (peisaje/detalii), ramane exact claritatea globala, ca inainte.
 */
export function blendSubjectSharpness(subjectScore: number | undefined, globalScore: number): number {
  if (subjectScore === undefined) return globalScore;
  return Math.round(0.7 * subjectScore + 0.3 * globalScore);
}

/** Mean luminance mapped so ~118 → 50; 0..100. */
function exposureScore(img: ImageData): number {
  const { data } = img;
  let lum = 0;
  const step = 16; // sample every 4th pixel
  let count = 0;
  for (let i = 0; i < data.length; i += step) {
    lum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    count++;
  }
  return Math.round(((lum / count) / 255) * 100);
}

const CLIP_HIGH_LUM = 250; // pe scala 0..255 — aproape complet alb, detaliu pierdut
const CLIP_LOW_LUM = 5;    // aproape complet negru

/** Fractiune de pixeli cu highlights/shadows "arse" (fara detaliu), 0..1 fiecare. */
function clippingScores(img: ImageData): { highlight: number; shadow: number } {
  const { data } = img;
  let high = 0, low = 0, count = 0;
  const step = 16; // acelasi esantionaj ca exposureScore, pentru viteza
  for (let i = 0; i < data.length; i += step) {
    const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    if (lum >= CLIP_HIGH_LUM) high++;
    else if (lum <= CLIP_LOW_LUM) low++;
    count++;
  }
  return count ? { highlight: high / count, shadow: low / count } : { highlight: 0, shadow: 0 };
}

// ── Orizont inclinat (doar poze fara fete — peisaje/scene) ─────────────────
// Tehnica: gradient Sobel pe fiecare pixel -> unghiul MUCHIEI (nu al
// gradientului, care e perpendicular pe muchie) -> medie circulara ponderata
// cu magnitudinea gradientului, dupa dublarea unghiului (elimina ambiguitatea
// de 180° a unei linii nedirectionate — o muchie la +3° si una la 183° sunt
// aceeasi linie fizica). Ignoram muchiile aproape verticale (cladiri, copaci,
// stalpi) inainte de mediere, ca sa nu traga rezultatul spre 90° fara rost —
// ne intereseaza doar liniile aproape orizontale (orizontul real).
const HORIZON_MAX_CONSIDER_DEG = 45;
const HORIZON_MIN_GRADIENT = 18;
/**
 * O linie dominanta (orizont real) are un numar de pixeli-muchie proportional
 * cu LUNGIMEA ei (≈ latimea cadrului), nu cu suprafata totala — o linie
 * perfect orizontala e o tranzitie ingusta (2-3 randuri), asa ca un prag ca
 * fractiune din w*h o rateaza tocmai pe ea la rezolutii mai mari (cazul cel
 * mai simplu posibil, gasit testand: 0° nedetectat desi 8°/-12° au mers).
 * Prag pe dimensiunea liniara (latimea cadrului) evita asta.
 */
const HORIZON_MIN_EDGE_PIXELS_FACTOR = 0.5; // fractiune din latimea cadrului

function detectHorizonTiltDeg(img: ImageData): number | null {
  const { data, width: w, height: h } = img;
  const gray = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    gray[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
  }
  let sumCos = 0, sumSin = 0, edgeCount = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx = (gray[i - w + 1] + 2 * gray[i + 1] + gray[i + w + 1]) - (gray[i - w - 1] + 2 * gray[i - 1] + gray[i + w - 1]);
      const gy = (gray[i + w - 1] + 2 * gray[i + w] + gray[i + w + 1]) - (gray[i - w - 1] + 2 * gray[i - w] + gray[i - w + 1]);
      const mag = Math.hypot(gx, gy);
      if (mag < HORIZON_MIN_GRADIENT) continue;
      // unghiul tangentei la muchie = unghiul gradientului + 90°, normalizat la (-90, 90]
      let edgeDeg = (Math.atan2(gy, gx) * 180) / Math.PI + 90;
      edgeDeg = ((edgeDeg + 90) % 180 + 180) % 180 - 90;
      if (Math.abs(edgeDeg) > HORIZON_MAX_CONSIDER_DEG) continue;
      const rad2 = (edgeDeg * 2 * Math.PI) / 180;
      sumCos += mag * Math.cos(rad2);
      sumSin += mag * Math.sin(rad2);
      edgeCount++;
    }
  }
  if (edgeCount < w * HORIZON_MIN_EDGE_PIXELS_FACTOR) return null;
  const meanDeg = (Math.atan2(sumSin, sumCos) * 180) / Math.PI / 2;
  return Math.round(meanDeg * 10) / 10;
}

function classifyScene(faces: FaceInsight[], w: number, h: number): AnalysisRecord['sceneType'] {
  if (faces.length === 0) return w >= h ? 'landscape' : 'detail';
  // O singura fata e mereu "portret", indiferent de cat de mica/departe e in cadru
  // (bug real gasit de auditul QA: un portret de mediu/environmental cu subiectul mic
  // in cadru era clasificat gresit ca "group", diluand modelul de invatare per context).
  if (faces.length === 1) return 'portrait';
  if (faces.length >= 3) return 'group';
  const largest = Math.max(...faces.map(f => f.box[2] * f.box[3]));
  return largest > 0.04 ? 'portrait' : 'group';
}

// ── Compozitie (tehnici clasice de fotografie, calculate geometric) ────────────
// Sursa: regula treimilor si headroom sunt principii standard de compozitie
// (vezi ex. digital-photography-school.com/four-rules-of-photographic-composition,
// photoworkout.com/rule-of-thirds-in-photography) — nu simulari, ci geometrie
// directa pe cutia fetei principale, deja detectata de model.

const THIRDS_POINTS: [number, number][] = [[1 / 3, 1 / 3], [2 / 3, 1 / 3], [1 / 3, 2 / 3], [2 / 3, 2 / 3]];
// distanta de la centrul cadrului (compozitia cea mai "sigura"/plictisitoare) la cea mai apropiata intersectie
const THIRDS_MAX_DIST = Math.hypot(0.5 - 1 / 3, 0.5 - 1 / 3);

/** Cat de aproape e centrul subiectului de o intersectie de treimi — 1 = pe linie, 0 = centrat sau mai rau. */
function ruleOfThirdsScore(cx: number, cy: number): number {
  const d = Math.min(...THIRDS_POINTS.map(([tx, ty]) => Math.hypot(cx - tx, cy - ty)));
  return Math.max(0, Math.min(1, 1 - d / THIRDS_MAX_DIST));
}

const HEADROOM_IDEAL_MIN = 0.04; // sub asta, capul e prea lipit de marginea de sus
const HEADROOM_IDEAL_MAX = 0.22; // peste asta, prea mult spatiu gol deasupra

/** topY = distanta normalizata de la marginea de sus a cadrului la varful cutiei fetei. */
function headroomScore(topY: number): number {
  if (topY < HEADROOM_IDEAL_MIN) return topY / HEADROOM_IDEAL_MIN;
  if (topY > HEADROOM_IDEAL_MAX) return Math.max(0, 1 - (topY - HEADROOM_IDEAL_MAX) / (0.5 - HEADROOM_IDEAL_MAX));
  return 1;
}

/** Compozitie pe subiectul principal (fata cea mai mare) — neutru (0.5) cand nu exista fete detectate. */
function scoreComposition(faces: FaceInsight[]): { ruleOfThirds: number; headroom: number } {
  if (!faces.length) return { ruleOfThirds: 0.5, headroom: 0.5 };
  const main = faces.reduce((a, b) => (a.box[2] * a.box[3] > b.box[2] * b.box[3] ? a : b));
  const cx = main.box[0] + main.box[2] / 2;
  const cy = main.box[1] + main.box[3] / 2;
  return { ruleOfThirds: ruleOfThirdsScore(cx, cy), headroom: headroomScore(main.box[1]) };
}

// ── Analiza estetica avansata (compozitie extinsa, lumina, culoare, focus) ────
// Fara modele ML noi — tehnici clasice de viziune computerizata (Sobel,
// histograme HSV, varianta locala Laplaciana), rulate pe smallImg (320x320)
// deja decodat pentru claritate/expunere/clipping mai sus, ca sa nu adauge un
// al doilea draw pe canvas. Distorsiunea de aspect ratio a patratului nu
// conteaza pentru statistici agregate (acelasi motiv ca la sharpness/exposure/
// clipping), doar pentru masuratori unghiulare exacte (de-asta orizontul are
// propriul canvas cu raport de aspect real, mai sus).

function toGray(img: ImageData): Float32Array {
  const { data, width: w, height: h } = img;
  const gray = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    gray[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
  }
  return gray;
}

interface SobelMaps { mag: Float32Array; angleDeg: Float32Array }

/** Gradient Sobel: magnitudine + unghiul muchiei (nu al gradientului), normalizat la (-90,90]. */
function sobel(gray: Float32Array, w: number, h: number): SobelMaps {
  const mag = new Float32Array(w * h);
  const angleDeg = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx = (gray[i - w + 1] + 2 * gray[i + 1] + gray[i + w + 1]) - (gray[i - w - 1] + 2 * gray[i - 1] + gray[i + w - 1]);
      const gy = (gray[i + w - 1] + 2 * gray[i + w] + gray[i + w + 1]) - (gray[i - w - 1] + 2 * gray[i - w] + gray[i - w + 1]);
      mag[i] = Math.hypot(gx, gy);
      let edgeDeg = (Math.atan2(gy, gx) * 180) / Math.PI + 90;
      edgeDeg = ((edgeDeg + 90) % 180 + 180) % 180 - 90;
      angleDeg[i] = edgeDeg;
    }
  }
  return { mag, angleDeg };
}

const EDGE_SIGNIFICANT = 18; // acelasi prag ca HORIZON_MIN_GRADIENT mai sus

/**
 * Linii directoare: concentrare puternica a energiei muchiilor pe o singura
 * directie dominanta (unghi dublat ca la orizont, elimina ambiguitatea de
 * 180°) — semnal de "structura care ghideaza privirea", indiferent daca
 * directia exacta e diagonala, orizontala sau verticala.
 */
function detectLeadingLines(mag: Float32Array, angleDeg: Float32Array): boolean {
  const bins = new Float64Array(18); // bin-uri de 10 grade, (-90,90]
  let total = 0;
  for (let i = 0; i < mag.length; i++) {
    const m = mag[i];
    if (m < EDGE_SIGNIFICANT) continue;
    const bin = Math.min(17, Math.max(0, Math.floor((angleDeg[i] + 90) / 10)));
    bins[bin] += m;
    total += m;
  }
  if (total < 1) return false;
  const peak = Math.max(...bins);
  return peak / total > 0.22; // un singur bin de 10° concentreaza >22% din energia muchiilor
}

/**
 * Simetrie stanga-dreapta: corelatie normalizata intre harta de magnitudine a
 * muchiilor din jumatatea stanga si oglinda (flip orizontal) celei drepte,
 * pe o grila redusa de blocuri (mai robust la zgomot pixel-cu-pixel).
 */
export function detectSymmetry(mag: Float32Array, w: number, h: number): boolean {
  const GRID = 16;
  const halfW = Math.floor(w / 2);
  const bw = Math.max(1, Math.floor(halfW / GRID));
  const bh = Math.max(1, Math.floor(h / GRID));
  let num = 0, denomA = 0, denomB = 0;
  for (let by = 0; by < GRID; by++) {
    for (let bx = 0; bx < GRID; bx++) {
      let a = 0, b = 0;
      for (let y = by * bh; y < Math.min(h, (by + 1) * bh); y++) {
        for (let x = bx * bw; x < Math.min(halfW, (bx + 1) * bw); x++) {
          const rightX = w - 1 - x;
          if (rightX < halfW) continue;
          a += mag[y * w + x];
          b += mag[y * w + rightX];
        }
      }
      num += a * b; denomA += a * a; denomB += b * b;
    }
  }
  if (denomA < 1 || denomB < 1) return false;
  return num / Math.sqrt(denomA * denomB) > 0.6;
}

/** Fractiune de blocuri (grila 10x10) cu variatie locala scazuta ("goale") — cer, fundal uniform, spatiu negativ. */
export function negativeSpaceScore(gray: Float32Array, w: number, h: number): number {
  const GRID = 10;
  const bw = Math.max(1, Math.floor(w / GRID));
  const bh = Math.max(1, Math.floor(h / GRID));
  let emptyBlocks = 0, totalBlocks = 0;
  for (let by = 0; by < GRID; by++) {
    for (let bx = 0; bx < GRID; bx++) {
      let sum = 0, sumSq = 0, n = 0;
      for (let y = by * bh; y < Math.min(h, (by + 1) * bh); y++) {
        for (let x = bx * bw; x < Math.min(w, (bx + 1) * bw); x++) {
          const v = gray[y * w + x];
          sum += v; sumSq += v * v; n++;
        }
      }
      if (!n) continue;
      totalBlocks++;
      const variance = sumSq / n - (sum / n) ** 2;
      if (variance < 60) emptyBlocks++; // prag empiric ~sub 8 nivele de gri deviatie standard
    }
  }
  return totalBlocks ? emptyBlocks / totalBlocks : 0;
}

/** Duritatea luminii din distributia contrastului local (Sobel) + deviatia standard globala a luminantei. */
function detectLightQuality(gray: Float32Array, mag: Float32Array): NonNullable<AnalysisRecord['lightQuality']> {
  let sum = 0, sumSq = 0;
  for (let i = 0; i < gray.length; i++) { sum += gray[i]; sumSq += gray[i] * gray[i]; }
  const n = gray.length;
  const lumStd = Math.sqrt(Math.max(0, sumSq / n - (sum / n) ** 2));
  let edgeCount = 0, highEdge = 0;
  for (let i = 0; i < mag.length; i++) {
    if (mag[i] > 4) { edgeCount++; if (mag[i] > 90) highEdge++; }
  }
  if (edgeCount < n * 0.01) return 'unknown'; // cadru prea uniform pentru a estima duritatea luminii
  const hardEdgeFraction = highEdge / edgeCount;
  if (hardEdgeFraction > 0.1 && lumStd > 55) return 'hard';
  if (hardEdgeFraction < 0.04 && lumStd < 42) return 'soft';
  return 'mixed';
}

/** Traseaza cutiile de fete (normalizate 0..1) intr-o masca boolean pe grila w x h. */
function boxesToMask(w: number, h: number, boxes: FaceInsight['box'][]): Uint8Array {
  const mask = new Uint8Array(w * h);
  for (const [bx, by, bw, bh] of boxes) {
    const x0 = Math.max(0, Math.round(bx * w)), y0 = Math.max(0, Math.round(by * h));
    const x1 = Math.min(w, Math.round((bx + bw) * w)), y1 = Math.min(h, Math.round((by + bh) * h));
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) mask[y * w + x] = 1;
  }
  return mask;
}

/** Varianta Laplaciana restransa la interiorul sau exteriorul mastii de fete (-1 = regiune prea mica). */
export function regionLaplacianVariance(gray: Float32Array, w: number, h: number, mask: Uint8Array, inside: boolean): number {
  let sum = 0, sumSq = 0, n = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if ((mask[i] === 1) !== inside) continue;
      const lap = gray[i - w] + gray[i + w] + gray[i - 1] + gray[i + 1] - 4 * gray[i];
      sum += lap; sumSq += lap * lap; n++;
    }
  }
  if (n < 20) return -1;
  return sumSq / n - (sum / n) ** 2;
}

/**
 * Subiect in focus + calitatea bokeh-ului + claritatea subiectului (scor 0..100,
 * aceeasi scalare ca laplacianSharpness — vezi varianceToSharpnessScore) —
 * pentru blendSubjectSharpness mai jos. Subiectul e fetele (cand exista) sau,
 * pentru poze fara oameni, obiectul principal detectat de CenterNet
 * (mainObjectBox) — acelasi rationament ca la portrete: un fundal difuz
 * (bokeh) intentionat pe un macro/produs/animal nu trebuie sa penalizeze
 * poza doar pentru ca fundalul e neclar. 'n/a'/undefined fara niciun subiect
 * (nici fete, nici obiect suficient de sigur) SAU cand regiunea e prea mica
 * pentru o masuratoare stabila (acelasi prag ca regionLaplacianVariance,
 * n < 20 pixeli).
 */
export function scoreFocusAndBokeh(
  gray: Float32Array, w: number, h: number, faces: FaceInsight[], objectBox?: [number, number, number, number]
): {
  subjectInFocus?: boolean; bokehQuality: NonNullable<AnalysisRecord['bokehQuality']>; subjectSharpness?: number;
} {
  const subjectBoxes = faces.length ? faces.map(f => f.box) : (objectBox ? [objectBox] : []);
  if (!subjectBoxes.length) return { bokehQuality: 'n/a' };
  const mask = boxesToMask(w, h, subjectBoxes);
  const subjectVar = regionLaplacianVariance(gray, w, h, mask, true);
  const bgVar = regionLaplacianVariance(gray, w, h, mask, false);
  if (subjectVar < 0 || bgVar < 0) return { bokehQuality: 'n/a' };
  const subjectInFocus = subjectVar > 40 && subjectVar >= bgVar * 0.5;
  const ratio = bgVar / Math.max(subjectVar, 1);
  const bokehQuality: NonNullable<AnalysisRecord['bokehQuality']> =
    subjectVar < 40 ? 'n/a' // subiectul insusi e neclar -> nu putem judeca bokeh-ul fundalului
    : ratio < 0.35 ? 'good'
    : ratio < 0.65 ? 'average'
    : 'poor';
  return { subjectInFocus, bokehQuality, subjectSharpness: varianceToSharpnessScore(subjectVar) };
}

function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const d = max - min;
  let hue = 0;
  if (d !== 0) {
    if (max === r) hue = ((g - b) / d) % 6;
    else if (max === g) hue = (b - r) / d + 2;
    else hue = (r - g) / d + 4;
    hue *= 60;
    if (hue < 0) hue += 360;
  }
  const sat = max === 0 ? 0 : d / max;
  return [hue, sat, max];
}

function hexFromRgb(r: number, g: number, b: number): string {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

const HUE_BINS = 12; // 30 grade fiecare

/**
 * Culoare: hue-uri dominante ponderate cu saturatie*valoare (pixelii gri/
 * negru/alb aproape ca nu conteaza — nu au o "culoare" reala). Armonia se
 * masoara ca fractiunea de energie concentrata in top-3 hue-uri (o paleta
 * restransa citeste ca armonioasa; una imprastiata pe tot cercul cromatic,
 * dezordonata). "Ora de aur" e o aproximare pur vizuala (cast cald + saturatie
 * + expunere medie), fara date GPS/ora reala a rasaritului.
 */
export function analyzeColor(img: ImageData, exposure: number): {
  colorHarmonyScore: number; dominantColors: string[]; goldenHourDetected: boolean;
} {
  const { data } = img;
  const binWeight = new Float64Array(HUE_BINS);
  const binR = new Float64Array(HUE_BINS), binG = new Float64Array(HUE_BINS), binB = new Float64Array(HUE_BINS);
  let satSum = 0, totalWeight = 0, count = 0;
  const step = 8; // 1 din 2 pixeli (RGBA = 4 canale -> pas 8)
  for (let i = 0; i + 2 < data.length; i += step) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const [hue, sat, val] = rgbToHsv(r, g, b);
    const weight = sat * val;
    const bin = Math.min(HUE_BINS - 1, Math.floor(hue / (360 / HUE_BINS)));
    binWeight[bin] += weight; binR[bin] += r * weight; binG[bin] += g * weight; binB[bin] += b * weight;
    satSum += sat; totalWeight += weight; count++;
  }
  const avgSat = count ? satSum / count : 0;

  const order = Array.from(binWeight.keys()).sort((a, b) => binWeight[b] - binWeight[a]);
  const dominantColors = order.slice(0, 3)
    .filter(b => binWeight[b] > 0)
    .map(b => hexFromRgb(binR[b] / binWeight[b], binG[b] / binWeight[b], binB[b] / binWeight[b]));

  const colorHarmonyScore = avgSat < 0.12
    ? 0.85 // aproape monocrom/gri — citit ca armonios prin conventie
    : totalWeight > 0
      ? Math.max(0, Math.min(1, (binWeight[order[0]] + (binWeight[order[1]] ?? 0) + (binWeight[order[2]] ?? 0)) / totalWeight))
      : 0.5;

  // bin-urile 0 si 1 acopera 0-60° (rosu-portocaliu-auriu) — cast cald tipic de ora de aur
  const warmWeight = binWeight[0] + binWeight[1];
  const goldenHourDetected = totalWeight > 0 && (warmWeight / totalWeight) > 0.3 && avgSat > 0.25 && exposure > 25 && exposure < 85;

  return { colorHarmonyScore: Math.round(colorHarmonyScore * 100) / 100, dominantColors, goldenHourDetected };
}

/**
 * Hue-ul MAXIM (grade) al benzii tipice de ten uman — indiferent de nuanta
 * reala a pielii (deschisa/inchisa) sau etnie, tenul corect echilibrat cade
 * aproape mereu intre 0° si acest prag (rosu-portocaliu-galben cald), reper
 * folosit pe scara larga in literatura de skin-detection bazata pe HSV. Un
 * balans de alb GRESIT (tungsten fotografiat cu WB de exterior, fluorescent,
 * umbra fara compensare) impinge hue-ul EXPLICIT in afara acestei benzi
 * (verde, albastru, magenta) — semnalul de aici nu judeca "cat de deschis"
 * e tenul, doar daca are un cast de culoare nefiresc.
 */
const SKIN_HUE_MAX = 50;
/** Sub aceasta saturatie, zona (umbra adanca, par, ochelari, reflexii) e prea neutra ca sa fie un esantion de ten de incredere. */
const SKIN_MIN_SATURATION = 0.08;

/**
 * Ton de piele "natural" (fara cast de culoare) in interiorul cutiei unei
 * fete — vezi SKIN_HUE_MAX. undefined cand regiunea e prea mica/prea putin
 * saturata pentru o masuratoare de incredere (nu "fals", pur si simplu
 * nemasurabil — acelasi tipar ca bokehQuality 'n/a').
 */
export function hasNaturalSkinTone(img: ImageData, box: [number, number, number, number]): boolean | undefined {
  const { data, width: w, height: h } = img;
  const [bx, by, bw, bh] = box;
  const x0 = Math.max(0, Math.round(bx * w)), y0 = Math.max(0, Math.round(by * h));
  const x1 = Math.min(w, Math.round((bx + bw) * w)), y1 = Math.min(h, Math.round((by + bh) * h));
  let sumWeight = 0, sumSin = 0, sumCos = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * w + x) * 4;
      const [hue, sat, val] = rgbToHsv(data[i], data[i + 1], data[i + 2]);
      if (sat < SKIN_MIN_SATURATION) continue;
      const weight = sat * val;
      const rad = (hue * Math.PI) / 180;
      sumSin += weight * Math.sin(rad);
      sumCos += weight * Math.cos(rad);
      sumWeight += weight;
    }
  }
  if (sumWeight < 1) return undefined;
  let meanHue = (Math.atan2(sumSin, sumCos) * 180) / Math.PI;
  if (meanHue < 0) meanHue += 360;
  return meanHue <= SKIN_HUE_MAX || meanHue >= 350;
}

/** Scor agregat de compozitie (0..1) — cu subiect uman: treimi+headroom; fara: linii/simetrie/spatiu negativ. */
function aggregateComposition(p: {
  ruleOfThirds: number; headroom: number; hasFaces: boolean;
  leadingLines: boolean; symmetry: boolean; negativeSpace: number;
}): number {
  if (p.hasFaces) return Math.round((0.6 * p.ruleOfThirds + 0.4 * p.headroom) * 100) / 100;
  // scena fara subiect uman: scor maxim la ~30% spatiu negativ (nici gol, nici aglomerat)
  const negativeSpaceBalance = Math.max(0, 1 - Math.abs(p.negativeSpace - 0.3) / 0.7);
  const score = 0.4 * (p.leadingLines ? 1 : 0) + 0.3 * (p.symmetry ? 1 : 0) + 0.3 * negativeSpaceBalance;
  return Math.round(Math.max(0, Math.min(1, score)) * 100) / 100;
}

/** Eticheta compusa din tipul de scena + varsta minima estimata (Human.js face.age, cand e disponibila). */
function deriveSceneSemantic(sceneType: AnalysisRecord['sceneType'], faces: FaceResult[]): string {
  if (!faces.length) return sceneType; // 'landscape' | 'detail'
  const ages = faces.map(f => f.age).filter((a): a is number => typeof a === 'number');
  const childPresent = ages.length > 0 && Math.min(...ages) < 13;
  if (sceneType === 'portrait') return childPresent ? 'child_portrait' : 'portrait';
  if (sceneType === 'group') return childPresent ? 'family_group' : 'group';
  return sceneType;
}

// ── Service ──────────────────────────────────────────────────────────────────

const ACCELERATED_BACKENDS = ['webgl', 'humangl', 'webgpu', 'wasm'];

export class FaceAnalysisService {
  private human: Human | null = null;
  private known: KnownPerson[] = [];
  private backend = 'unknown';
  private analysisCanvas = new OffscreenCanvas(320, 320);
  /**
   * analysisCanvas e patrat (320x320) — perfect pentru statistici agregate
   * (claritate, expunere, clipping) unde distorsiunea de aspect ratio nu
   * conteaza, dar STRICA unghiurile geometrice: o imagine 1200x800 desenata
   * intr-un patrat 320x320 se scaleaza diferit pe X (0.267) fata de Y (0.4),
   * deci orice unghi masurat pe ea (orizont) iese gresit. horizonCanvas
   * pastreaza raportul de aspect real al cadrului, pentru masuratori corecte.
   */
  private horizonCanvas = new OffscreenCanvas(360, 360);
  /** Canvas mic, redimensionat per ochi — pentru detectCatchlight (vezi eyeCropBox). */
  private eyeCanvas = new OffscreenCanvas(32, 32);

  /**
   * Decupeaza regiunea unui ochi (eyeCropBox) direct din bitmap-ul ORIGINAL —
   * TREBUIE apelat inainte de bitmap.close() mai jos in analyze(). Un ochi mic/
   * la marginea cadrului poate produce un decupaj partial sau gol; asta duce
   * doar la "niciun catchlight detectat" (degradare sigura, nu eroare).
   */
  private hasCatchlight(bitmap: ImageBitmap, mesh: number[][], eye: typeof LEFT_EYE): boolean {
    const box = eyeCropBox(mesh, eye);
    const size = Math.max(4, Math.round(box.size));
    if (this.eyeCanvas.width !== size || this.eyeCanvas.height !== size) {
      this.eyeCanvas.width = size;
      this.eyeCanvas.height = size;
    }
    const ctx = this.eyeCanvas.getContext('2d', { willReadFrequently: true })!;
    ctx.clearRect(0, 0, size, size);
    ctx.drawImage(bitmap, box.x, box.y, size, size, 0, 0, size, size);
    return detectCatchlight(ctx.getImageData(0, 0, size, size));
  }

  /**
   * Returneaza backend-ul TFJS efectiv activ dupa incarcare (nu doar cel cerut
   * in config). Pe device-uri fara WebGL/WASM functionale, Human cade pe 'cpu'
   * (sau esueaza total) fara sa arunce — analiza continua dar fara fete reale,
   * silentios. Apelantul (workerPool -> store) foloseste asta ca sa avertizeze
   * utilizatorul in loc sa lase scorurile sa para "normale".
   */
  /**
   * `forcedBackend` — folosit de pool-ul de workeri (core/workerPool.ts) pentru
   * a evita ca MAI MULTI workeri sa incerce simultan aceeasi cascada completa
   * WebGPU->WebGL->CPU: pe telefoane cu hardware mai slab, pana la 4 workeri
   * facand toti in paralel detectie + warmup GPU independent creeaza destula
   * presiune de CPU/memorie cat sa intarzie inclusiv propriile timere de
   * siguranta ale fiecarui worker, ceea ce a produs blocaje reale raportate
   * de utilizatori (minute intregi pe "Se incarca modelele AI", fara nicio
   * eroare vizibila) — desi fiecare timeout individual e finit. Doar primul
   * worker face detectia completa; restul primesc direct backend-ul gasit.
   */
  async init(modelBasePath?: string, economicMode?: boolean, forcedBackend?: string): Promise<string> {
    if (this.human) return this.backend;
    const overrides: Partial<Config> = {
      ...(modelBasePath ? { modelBasePath } : {}),
      // mod economic: mai putina inferenta per poza — iris (gaze/contact vizual)
      // si emotie (zambet/engagement) sunt semnalele cele mai costisitoare dupa
      // detectia de baza; absenta lor e deja tratata "neutru" in tot restul
      // pipeline-ului (extractFeatures/ContextEngine), nu ca eroare. CenterNet
      // (obiecte) e un model separat de ~4MB incarcat in plus — dezactivat si el,
      // sceneTags ramane absent (optional, tratat neutru la fel ca restul).
      ...(economicMode ? {
        face: { ...HUMAN_CONFIG.face, iris: { enabled: false }, emotion: { enabled: false } },
        object: { ...HUMAN_CONFIG.object, enabled: false }
      } : {})
    };

    if (forcedBackend) {
      const forcedConfig: Partial<Config> = { ...HUMAN_CONFIG, ...overrides, backend: forcedBackend as BackendEnum };
      const forcedOk = forcedBackend === 'webgl'
        ? await this.tryWebglBackend(forcedConfig, WEBGL_INIT_TIMEOUT_MS)
        : await this.tryBackend(forcedConfig, WEBGL_INIT_TIMEOUT_MS);
      if (forcedOk) {
        return this.backend;
      }
      // rar, dar posibil (contentie tranzitorie) — acelasi refugiu final ca mai jos
      await this.loadFinalFallback({ ...HUMAN_CONFIG, ...overrides, backend: 'cpu' });
      return this.backend;
    }

    // Cascada WebGPU -> WebGL -> CPU, fiecare pe o instanta SEPARATA (nu
    // this.human inca) si cu timeout, pentru ca inregistrarea unui backend
    // accelerat poate ramane blocata la infinit fara sa arunce nicio eroare —
    // confirmat pe teren nu doar pentru WebGPU (adaptor GPU indisponibil), ci
    // si pentru WebGL (drivere restrictive/blocklist-uite de Chromium pe unele
    // telefoane, reprodus atat in Chrome cat si in Xiaomi Browser pe acelasi
    // device, supravietuind unui restart al aplicatiei). Daca un nivel esueaza
    // sau expira, incercarea respectiva e abandonata (poate ramane "agatata"
    // in fundal) si trecem la urmatorul, mai putin performant dar mai robust.
    const preferWebGpu = typeof navigator !== 'undefined' && 'gpu' in navigator;
    if (preferWebGpu && await this.tryBackend({ ...HUMAN_CONFIG, ...overrides, backend: 'webgpu' }, WEBGPU_INIT_TIMEOUT_MS)) {
      return this.backend;
    }
    if (await this.tryWebglBackend({ ...HUMAN_CONFIG, ...overrides, backend: 'webgl' }, WEBGL_INIT_TIMEOUT_MS)) {
      return this.backend;
    }

    // Ultima plasa de siguranta: CPU pur (tfjs-backend-cpu, deja parte din
    // pachetul Human, fara driver GPU si fara alt fisier/CDN de incarcat) —
    // mult mai lent, dar nu poate "agata" in acelasi fel ca WebGL/WebGPU, deci
    // fara timeout aici (exact comportamentul dinainte de introducerea acestei
    // cascade: daca esueaza total, analiza continua fara fete reale, silentios
    // — vezi comentariul de la inceputul functiei init()).
    await this.loadFinalFallback({ ...HUMAN_CONFIG, ...overrides, backend: 'cpu' });
    return this.backend;
  }

  /**
   * Incearca un backend cu timeout pe o instanta noua, separata de
   * `this.human`. Daca esueaza sau expira, NU atinge `this.human`/`this.backend`
   * (raman libere pentru urmatoarea incercare) — instanta esuata poate ramane
   * blocata la infinit in fundal, dar nu mai e folosita de restul aplicatiei.
   */
  private async tryBackend(config: Partial<Config>, timeoutMs: number, forceF16 = false): Promise<boolean> {
    const human = new Human(config);
    // Atins DOAR cand experimentul e activ si backend-ul e webgl — cand
    // EXPERIMENTAL_WEBGL_F16_TEXTURES e false (implicit), `.env()` nu e
    // niciodata chemat, exact comportamentul dinainte de acest experiment
    // (vezi comentariul de la constanta). `.env()` e un singleton global in
    // acest worker thread, nu per-instanta Human — trebuie setat explicit in
    // AMBELE sensuri cat timp experimentul E activ, altfel o incercare
    // anterioara cu forceF16=true (chiar daca a esuat/expirat si a fost
    // abandonata) lasa flagul agatat pe true pentru incercarile urmatoare.
    if (EXPERIMENTAL_WEBGL_F16_TEXTURES && config.backend === 'webgl') {
      human.tf.env().set('WEBGL_FORCE_F16_TEXTURES', forceF16);
    }
    try {
      await withTimeout(
        (async () => { await human.load(); await human.warmup(); })(),
        timeoutMs,
        `${config.backend} init timeout`
      );
    } catch (err) {
      console.error(`FaceAnalysisService: ${config.backend}${forceF16 ? ' (f16)' : ''} init failed/timed out, trying next backend`, err);
      return false;
    }
    const backend = human.tf?.getBackend?.() ?? 'unknown';
    if (!ACCELERATED_BACKENDS.includes(backend)) return false;
    this.human = human;
    this.backend = backend;
    if (forceF16) console.info('FaceAnalysisService: WebGL running with EXPERIMENTAL_WEBGL_F16_TEXTURES active');
    return true;
  }

  /**
   * WebGL cu incercare F16 (vezi EXPERIMENTAL_WEBGL_F16_TEXTURES) — daca GPU-ul
   * nu suporta texturi half-float, backend-ul WebGL esueaza complet la incarcare
   * (nu doar flagul), asa ca reincercam o data in plus, curat, fara flag, inainte
   * sa cedam controlul urmatorului nivel din cascada (CPU). Fara asta, un GPU
   * care nu suporta F16 ar sari direct la CPU si ar pierde acceleratia WebGL
   * normala, nu doar experimentul.
   */
  private async tryWebglBackend(config: Partial<Config>, timeoutMs: number): Promise<boolean> {
    if (EXPERIMENTAL_WEBGL_F16_TEXTURES && await this.tryBackend(config, timeoutMs, true)) {
      return true;
    }
    return this.tryBackend(config, timeoutMs);
  }

  /** Ultimul nivel al cascadei — fara timeout, comportament identic cu varianta dinaintea introducerii cascadei WebGPU/WebGL/CPU. */
  private async loadFinalFallback(config: Partial<Config>): Promise<void> {
    const human = new Human(config);
    try {
      await human.load();
      await human.warmup();   // JIT-compile shaders before the first real photo
    } catch (err) {
      console.error('FaceAnalysisService: final fallback (CPU) load/warmup failed', err);
    }
    this.human = human;
    this.backend = human.tf?.getBackend?.() ?? 'unknown';
  }

  isAccelerated(): boolean {
    return ACCELERATED_BACKENDS.includes(this.backend);
  }

  /** Enrollment data: reference embeddings for user / Ami / soția, from db.persons. */
  setKnownPersons(persons: KnownPerson[]): void {
    this.known = persons;
  }

  private matchPerson(embedding: number[]): { id: string | null; name: string | null; similarity: number } {
    let best = { id: null as string | null, name: null as string | null, similarity: 0 };
    for (const person of this.known) {
      for (const ref of person.embeddings) {
        const sim = cosineSimilarity(embedding, ref);
        if (sim > best.similarity) best = { id: person.id, name: person.name, similarity: sim };
      }
    }
    if (best.similarity < RECOGNITION_THRESHOLD) return { id: null, name: null, similarity: best.similarity };
    return best;
  }

  private toInsight(face: FaceResult, imgW: number, imgH: number, catchlight: boolean): FaceInsight {
    const mesh = face.mesh as unknown as number[][];
    const left = mesh?.length >= 468 ? eyeOpenness(mesh, LEFT_EYE) : 0.5;
    const right = mesh?.length >= 468 ? eyeOpenness(mesh, RIGHT_EYE) : 0.5;
    const mouthOpen = mesh?.length >= 468 ? mouthAspectRatio(mesh) > MOUTH_OPEN_THRESHOLD : false;
    const emotion = extractEmotion(face);
    const embedding = (face.embedding as number[]) ?? [];
    const match = embedding.length ? this.matchPerson(embedding) : { id: null, name: null, similarity: 0 };
    const [x, y, w, h] = face.box;
    return {
      box: [x / imgW, y / imgH, w / imgW, h / imgH],
      faceScore: face.faceScore ?? face.score ?? 0,
      smile: Math.round(emotion.happy * 100) / 100,
      eyesOpen: { left: Math.round(left * 100) / 100, right: Math.round(right * 100) / 100 },
      isBlinking: left < BLINK_EAR_THRESHOLD_NORMALIZED || right < BLINK_EAR_THRESHOLD_NORMALIZED,
      mouthOpen,
      catchlight,
      personId: match.id,
      personName: match.name,
      similarity: Math.round(match.similarity * 100) / 100,
      embedding,
      emotion,
      eyeContact: Math.round(eyeContactScore(face) * 100) / 100
    };
  }

  /**
   * Analyze one photo. The ImageBitmap MUST be sent as a transferable
   * (Comlink.transfer) — zero copy, and it is closed here after use.
   */
  async analyze(photoId: string, bitmap: ImageBitmap): Promise<AnalysisRecord> {
    if (!this.human) throw new Error('FaceAnalysisService not initialized — call init() first');

    // Global metrics on a small downsample (cheap, still in this worker)
    const ctx = this.analysisCanvas.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(bitmap, 0, 0, 320, 320);
    const smallImg = ctx.getImageData(0, 0, 320, 320);

    const result = await this.human.detect(bitmap);
    const imgW = bitmap.width, imgH = bitmap.height;

    // orizontul are sens doar cand nu exista subiect uman de compus dupa treimi/headroom
    // — desenat separat (proportii reale, nu patratul distorsionat de mai sus),
    // INAINTE de close() cat timp bitmap-ul e inca valid
    let horizonImg: ImageData | null = null;
    if (result.face.length === 0) {
      const HORIZON_MAX_SIDE = 360;
      const scale = Math.min(1, HORIZON_MAX_SIDE / Math.max(imgW, imgH));
      const hw = Math.max(1, Math.round(imgW * scale));
      const hh = Math.max(1, Math.round(imgH * scale));
      if (this.horizonCanvas.width !== hw || this.horizonCanvas.height !== hh) {
        this.horizonCanvas.width = hw;
        this.horizonCanvas.height = hh;
      }
      const hctx = this.horizonCanvas.getContext('2d', { willReadFrequently: true })!;
      hctx.drawImage(bitmap, 0, 0, hw, hh);
      horizonImg = hctx.getImageData(0, 0, hw, hh);
    }

    // catchlight-urile au nevoie de un decupaj de rezolutie mare per ochi, direct
    // din bitmap-ul ORIGINAL — trebuie calculate ACUM, cat inca e valid (smallImg
    // de mai sus e mult prea mic/distorsionat pentru asa ceva)
    const catchlights = result.face.map(f => {
      const mesh = f.mesh as unknown as number[][];
      if (!mesh || mesh.length < 468) return false;
      return this.hasCatchlight(bitmap, mesh, LEFT_EYE) || this.hasCatchlight(bitmap, mesh, RIGHT_EYE);
    });

    bitmap.close(); // free GPU/CPU memory immediately

    const faces = result.face.map((f, i) => this.toInsight(f, imgW, imgH, catchlights[i]));
    const known = faces.filter(f => f.personId !== null);
    const composition = scoreComposition(faces);
    const clipping = clippingScores(smallImg);
    const horizonTiltDeg = horizonImg ? detectHorizonTiltDeg(horizonImg) : null;
    const exposure = exposureScore(smallImg);

    // ── analiza estetica avansata — o singura trecere Sobel pe smallImg, reutilizata de mai multe scoruri
    const smallGray = toGray(smallImg);
    const { mag, angleDeg } = sobel(smallGray, smallImg.width, smallImg.height);
    const leadingLines = detectLeadingLines(mag, angleDeg);
    const symmetry = detectSymmetry(mag, smallImg.width, smallImg.height);
    const negSpace = negativeSpaceScore(smallGray, smallImg.width, smallImg.height);
    const lightQuality = detectLightQuality(smallGray, mag);
    // fara fete: incercam sa gasim un subiect (CenterNet) pentru care sa evaluam
    // focusul separat de fundal — vezi scoreFocusAndBokeh
    const mainObject = faces.length === 0 ? mainObjectBox(result.object) : undefined;
    const focusBokeh = scoreFocusAndBokeh(smallGray, smallImg.width, smallImg.height, faces, mainObject);
    const color = analyzeColor(smallImg, exposure);
    // balans de alb pe ten — vezi hasNaturalSkinTone; ignoram fetele unde nu s-a
    // putut masura (regiune prea mica/neutra), nu le tratam ca "nenatural"
    const skinToneSamples = faces
      .map(f => hasNaturalSkinTone(smallImg, f.box))
      .filter((r): r is boolean => r !== undefined);
    const groupSkinToneNaturalRatio = skinToneSamples.length
      ? skinToneSamples.filter(Boolean).length / skinToneSamples.length
      : undefined;
    const compositionScore = aggregateComposition({
      ruleOfThirds: composition.ruleOfThirds, headroom: composition.headroom, hasFaces: faces.length > 0,
      leadingLines, symmetry, negativeSpace: negSpace
    });
    const sceneType = classifyScene(faces, imgW, imgH);
    const sceneSemantic = deriveSceneSemantic(sceneType, result.face);
    // set dedupe: CenterNet poate detecta acelasi obiect de mai multe ori (ex. 3 scaune) —
    // pentru etichete/keywords conteaza TIPUL, nu numarul de instante
    const sceneTags = result.object.length ? [...new Set(result.object.map(o => o.label))] : undefined;

    return {
      photoId,
      faces,
      faceCount: faces.length,
      knownFaceCount: known.length,
      strangerCount: faces.length - known.length,
      bestSmile: faces.length ? Math.max(...faces.map(f => f.smile)) : 0,
      allEyesOpen: faces.every(f => !f.isBlinking),
      sharpness: blendSubjectSharpness(focusBokeh.subjectSharpness, laplacianSharpness(smallImg)),
      exposure,
      sceneType,
      ruleOfThirds: composition.ruleOfThirds,
      headroom: composition.headroom,
      groupEyesOpenRatio: faces.length ? faces.filter(f => !f.isBlinking).length / faces.length : undefined,
      groupSmileRatio: faces.length ? faces.filter(f => f.smile >= GROUP_SMILE_THRESHOLD).length / faces.length : undefined,
      groupAwkwardRatio: faces.length ? faces.filter(isAwkwardExpression).length / faces.length : undefined,
      groupGenuineSmileRatio: computeGroupGenuineSmileRatio(faces, lightQuality),
      groupCatchlightRatio: faces.length ? faces.filter(f => f.catchlight).length / faces.length : undefined,
      groupSkinToneNaturalRatio,
      avgEyeContact: faces.length ? faces.reduce((s, f) => s + (f.eyeContact ?? 0.5), 0) / faces.length : undefined,
      avgEngagement: faces.length
        ? faces.reduce((s, f) => s + engagementScore(f.emotion ?? { happy: 0, surprise: 0, negative: 0 }), 0) / faces.length
        : undefined,
      highlightClipping: clipping.highlight,
      shadowClipping: clipping.shadow,
      ...(horizonTiltDeg !== null ? { horizonTiltDeg } : {}),
      compositionScore,
      leadingLinesDetected: leadingLines,
      symmetryDetected: symmetry,
      negativeSpaceScore: Math.round(negSpace * 100) / 100,
      lightQuality,
      goldenHourDetected: color.goldenHourDetected,
      ...(focusBokeh.subjectInFocus !== undefined ? { subjectInFocus: focusBokeh.subjectInFocus } : {}),
      bokehQuality: focusBokeh.bokehQuality,
      colorHarmonyScore: color.colorHarmonyScore,
      dominantColors: color.dominantColors,
      sceneSemantic,
      ...(sceneTags ? { sceneTags } : {}),
      aiScore: 0,            // filled in later by ContextEngine on the main thread
      analyzedAt: Date.now()
    };
  }

  /**
   * Batch API with progress callback (wrapped by caller with Comlink.proxy).
   * The caller streams bitmaps in chunks; this keeps peak RAM flat even at 1000+ photos.
   */
  async analyzeBatch(
    items: { photoId: string; bitmap: ImageBitmap }[],
    onProgress?: (done: number, total: number, last: AnalysisRecord) => void
  ): Promise<AnalysisRecord[]> {
    const out: AnalysisRecord[] = [];
    for (let i = 0; i < items.length; i++) {
      const rec = await this.analyze(items[i].photoId, items[i].bitmap);
      out.push(rec);
      onProgress?.(i + 1, items.length, rec);
    }
    return out;
  }

  /**
   * Enroll a reference photo for a known person -> returns the embedding to
   * store in db.persons. `faceCount` e intors explicit (nu doar embedding-ul)
   * pentru ca apelantul (store.ts addPerson) sa poata avertiza utilizatorul
   * cand fotografia de referinta continea MAI MULTE fete — bug real gasit de
   * auditul QA: alegerea "fetei celei mai mari" era complet silentioasa, fara
   * nicio confirmare care fata a fost folosita. Un strain accidental mai
   * aproape de camera intr-o poza de grup putea ajunge inrolat sub numele
   * gresit, fara niciun semnal. Nu schimbam algoritmul (tot cea mai mare fata
   * — o interfata de decupare/alegere ar fi un fix mai complet, dar mult mai
   * mare ca domeniu), doar facem alegerea VIZIBILA.
   */
  async computeEnrollmentEmbedding(bitmap: ImageBitmap): Promise<{ embedding: number[]; faceCount: number } | null> {
    if (!this.human) throw new Error('Not initialized');
    const result = await this.human.detect(bitmap);
    bitmap.close();
    if (!result.face.length) return null;
    // Largest face in the enrollment photo is the subject
    const largest = result.face.reduce((a, b) => (a.box[2] * a.box[3] > b.box[2] * b.box[3] ? a : b));
    const embedding = (largest.embedding as number[] | undefined) ?? null;
    if (!embedding) return null;
    return { embedding, faceCount: result.face.length };
  }
}

export type FaceAnalysisAPI = FaceAnalysisService;

Comlink.expose(new FaceAnalysisService());
