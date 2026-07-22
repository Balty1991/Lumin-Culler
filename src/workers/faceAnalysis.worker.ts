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
import { Human, type Config, type FaceResult } from '@vladmandic/human';
import type { AnalysisRecord, FaceInsight, KnownPerson } from '../core/db';

// ── Config ───────────────────────────────────────────────────────────────────

const HUMAN_CONFIG: Partial<Config> = {
  // Models served locally from /public/models (copied from @vladmandic/human/models)
  // so the app works offline and on GitHub Pages without third-party CDNs.
  modelBasePath: '/models/',
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
  object: { enabled: false },
  gesture: { enabled: false },
  segmentation: { enabled: false }
};

// MediaPipe Face Mesh landmark indices for Eye Aspect Ratio (EAR)
const LEFT_EYE = { top: 159, bottom: 145, inner: 133, outer: 33 };
const RIGHT_EYE = { top: 386, bottom: 374, inner: 362, outer: 263 };

const RECOGNITION_THRESHOLD = 0.55; // cosine similarity above this = known person
const BLINK_EAR_THRESHOLD = 0.18;
const GROUP_SMILE_THRESHOLD = 0.4; // prag peste care o fata e considerata "zambitoare" pentru rate de grup

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
  return Math.min(100, Math.round(Math.sqrt(variance) * 2.2));
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

  /**
   * Returneaza backend-ul TFJS efectiv activ dupa incarcare (nu doar cel cerut
   * in config). Pe device-uri fara WebGL/WASM functionale, Human cade pe 'cpu'
   * (sau esueaza total) fara sa arunce — analiza continua dar fara fete reale,
   * silentios. Apelantul (workerPool -> store) foloseste asta ca sa avertizeze
   * utilizatorul in loc sa lase scorurile sa para "normale".
   */
  async init(modelBasePath?: string): Promise<string> {
    if (this.human) return this.backend;
    this.human = new Human({
      ...HUMAN_CONFIG,
      ...(modelBasePath ? { modelBasePath } : {})
    });
    try {
      await this.human.load();
      await this.human.warmup();   // JIT-compile shaders before the first real photo
    } catch (err) {
      console.error('FaceAnalysisService: model load/warmup failed', err);
    }
    this.backend = this.human.tf?.getBackend?.() ?? 'unknown';
    return this.backend;
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

  private toInsight(face: FaceResult, imgW: number, imgH: number): FaceInsight {
    const mesh = face.mesh as unknown as number[][];
    const left = mesh?.length >= 468 ? eyeOpenness(mesh, LEFT_EYE) : 0.5;
    const right = mesh?.length >= 468 ? eyeOpenness(mesh, RIGHT_EYE) : 0.5;
    const emotion = extractEmotion(face);
    const embedding = (face.embedding as number[]) ?? [];
    const match = embedding.length ? this.matchPerson(embedding) : { id: null, name: null, similarity: 0 };
    const [x, y, w, h] = face.box;
    return {
      box: [x / imgW, y / imgH, w / imgW, h / imgH],
      faceScore: face.faceScore ?? face.score ?? 0,
      smile: Math.round(emotion.happy * 100) / 100,
      eyesOpen: { left: Math.round(left * 100) / 100, right: Math.round(right * 100) / 100 },
      isBlinking: left < (BLINK_EAR_THRESHOLD / 0.25) || right < (BLINK_EAR_THRESHOLD / 0.25),
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

    bitmap.close(); // free GPU/CPU memory immediately

    const faces = result.face.map(f => this.toInsight(f, imgW, imgH));
    const known = faces.filter(f => f.personId !== null);
    const composition = scoreComposition(faces);
    const clipping = clippingScores(smallImg);
    const horizonTiltDeg = horizonImg ? detectHorizonTiltDeg(horizonImg) : null;

    return {
      photoId,
      faces,
      faceCount: faces.length,
      knownFaceCount: known.length,
      strangerCount: faces.length - known.length,
      bestSmile: faces.length ? Math.max(...faces.map(f => f.smile)) : 0,
      allEyesOpen: faces.every(f => !f.isBlinking),
      sharpness: laplacianSharpness(smallImg),
      exposure: exposureScore(smallImg),
      sceneType: classifyScene(faces, imgW, imgH),
      ruleOfThirds: composition.ruleOfThirds,
      headroom: composition.headroom,
      groupEyesOpenRatio: faces.length ? faces.filter(f => !f.isBlinking).length / faces.length : undefined,
      groupSmileRatio: faces.length ? faces.filter(f => f.smile >= GROUP_SMILE_THRESHOLD).length / faces.length : undefined,
      avgEyeContact: faces.length ? faces.reduce((s, f) => s + (f.eyeContact ?? 0.5), 0) / faces.length : undefined,
      avgEngagement: faces.length
        ? faces.reduce((s, f) => s + engagementScore(f.emotion ?? { happy: 0, surprise: 0, negative: 0 }), 0) / faces.length
        : undefined,
      highlightClipping: clipping.highlight,
      shadowClipping: clipping.shadow,
      ...(horizonTiltDeg !== null ? { horizonTiltDeg } : {}),
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

  /** Enroll a reference photo for a known person → returns the embedding to store in db.persons. */
  async computeEnrollmentEmbedding(bitmap: ImageBitmap): Promise<number[] | null> {
    if (!this.human) throw new Error('Not initialized');
    const result = await this.human.detect(bitmap);
    bitmap.close();
    if (!result.face.length) return null;
    // Largest face in the enrollment photo is the subject
    const largest = result.face.reduce((a, b) => (a.box[2] * a.box[3] > b.box[2] * b.box[3] ? a : b));
    return (largest.embedding as number[]) ?? null;
  }
}

export type FaceAnalysisAPI = FaceAnalysisService;

Comlink.expose(new FaceAnalysisService());
