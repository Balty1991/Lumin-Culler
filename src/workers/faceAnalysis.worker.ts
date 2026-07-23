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
function detectSymmetry(mag: Float32Array, w: number, h: number): boolean {
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
function negativeSpaceScore(gray: Float32Array, w: number, h: number): number {
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
function regionLaplacianVariance(gray: Float32Array, w: number, h: number, mask: Uint8Array, inside: boolean): number {
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

/** Subiect in focus + calitatea bokeh-ului: claritate locala pe fete vs. restul cadrului. 'n/a' fara fete detectate. */
function scoreFocusAndBokeh(gray: Float32Array, w: number, h: number, faces: FaceInsight[]): {
  subjectInFocus?: boolean; bokehQuality: NonNullable<AnalysisRecord['bokehQuality']>;
} {
  if (!faces.length) return { bokehQuality: 'n/a' };
  const mask = boxesToMask(w, h, faces.map(f => f.box));
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
  return { subjectInFocus, bokehQuality };
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
function analyzeColor(img: ImageData, exposure: number): {
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

  /**
   * Returneaza backend-ul TFJS efectiv activ dupa incarcare (nu doar cel cerut
   * in config). Pe device-uri fara WebGL/WASM functionale, Human cade pe 'cpu'
   * (sau esueaza total) fara sa arunce — analiza continua dar fara fete reale,
   * silentios. Apelantul (workerPool -> store) foloseste asta ca sa avertizeze
   * utilizatorul in loc sa lase scorurile sa para "normale".
   */
  async init(modelBasePath?: string, economicMode?: boolean): Promise<string> {
    if (this.human) return this.backend;
    this.human = new Human({
      ...HUMAN_CONFIG,
      ...(modelBasePath ? { modelBasePath } : {}),
      // mod economic: mai putina inferenta per poza — iris (gaze/contact vizual)
      // si emotie (zambet/engagement) sunt semnalele cele mai costisitoare dupa
      // detectia de baza; absenta lor e deja tratata "neutru" in tot restul
      // pipeline-ului (extractFeatures/ContextEngine), nu ca eroare
      ...(economicMode ? { face: { ...HUMAN_CONFIG.face, iris: { enabled: false }, emotion: { enabled: false } } } : {})
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
    const exposure = exposureScore(smallImg);

    // ── analiza estetica avansata — o singura trecere Sobel pe smallImg, reutilizata de mai multe scoruri
    const smallGray = toGray(smallImg);
    const { mag, angleDeg } = sobel(smallGray, smallImg.width, smallImg.height);
    const leadingLines = detectLeadingLines(mag, angleDeg);
    const symmetry = detectSymmetry(mag, smallImg.width, smallImg.height);
    const negSpace = negativeSpaceScore(smallGray, smallImg.width, smallImg.height);
    const lightQuality = detectLightQuality(smallGray, mag);
    const focusBokeh = scoreFocusAndBokeh(smallGray, smallImg.width, smallImg.height, faces);
    const color = analyzeColor(smallImg, exposure);
    const compositionScore = aggregateComposition({
      ruleOfThirds: composition.ruleOfThirds, headroom: composition.headroom, hasFaces: faces.length > 0,
      leadingLines, symmetry, negativeSpace: negSpace
    });
    const sceneType = classifyScene(faces, imgW, imgH);
    const sceneSemantic = deriveSceneSemantic(sceneType, result.face);

    return {
      photoId,
      faces,
      faceCount: faces.length,
      knownFaceCount: known.length,
      strangerCount: faces.length - known.length,
      bestSmile: faces.length ? Math.max(...faces.map(f => f.smile)) : 0,
      allEyesOpen: faces.every(f => !f.isBlinking),
      sharpness: laplacianSharpness(smallImg),
      exposure,
      sceneType,
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
