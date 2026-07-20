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

function classifyScene(faces: FaceInsight[], w: number, h: number): AnalysisRecord['sceneType'] {
  if (faces.length === 0) return w >= h ? 'landscape' : 'detail';
  if (faces.length >= 3) return 'group';
  const largest = Math.max(...faces.map(f => f.box[2] * f.box[3]));
  return largest > 0.04 ? 'portrait' : 'group';
}

// ── Service ──────────────────────────────────────────────────────────────────

export class FaceAnalysisService {
  private human: Human | null = null;
  private known: KnownPerson[] = [];
  private analysisCanvas = new OffscreenCanvas(320, 320);

  async init(modelBasePath?: string): Promise<void> {
    if (this.human) return;
    this.human = new Human({
      ...HUMAN_CONFIG,
      ...(modelBasePath ? { modelBasePath } : {})
    });
    await this.human.load();
    await this.human.warmup();   // JIT-compile shaders before the first real photo
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
    const smile = face.emotion?.find(e => e.emotion === 'happy')?.score ?? 0;
    const embedding = (face.embedding as number[]) ?? [];
    const match = embedding.length ? this.matchPerson(embedding) : { id: null, name: null, similarity: 0 };
    const [x, y, w, h] = face.box;
    return {
      box: [x / imgW, y / imgH, w / imgW, h / imgH],
      faceScore: face.faceScore ?? face.score ?? 0,
      smile: Math.round(smile * 100) / 100,
      eyesOpen: { left: Math.round(left * 100) / 100, right: Math.round(right * 100) / 100 },
      isBlinking: left < (BLINK_EAR_THRESHOLD / 0.25) || right < (BLINK_EAR_THRESHOLD / 0.25),
      personId: match.id,
      personName: match.name,
      similarity: Math.round(match.similarity * 100) / 100,
      embedding
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
    bitmap.close(); // free GPU/CPU memory immediately

    const faces = result.face.map(f => this.toInsight(f, imgW, imgH));
    const known = faces.filter(f => f.personId !== null);

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
