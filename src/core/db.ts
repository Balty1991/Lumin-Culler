/**
 * core/db.ts
 * Persistence layer (IndexedDB via Dexie).
 * All heavy data (thumbnails, embeddings, AI metadata) lives here, NOT in RAM.
 */
import Dexie, { type Table } from 'dexie';

// ── Domain types ─────────────────────────────────────────────────────────────

export interface PhotoRecord {
  id: string;               // uuid
  fileName: string;
  capturedAt?: number;      // EXIF timestamp (ms)
  importedAt: number;
  width: number;
  height: number;
  dHash: string;            // perceptual hash for duplicate grouping
  status: 'pending' | 'selected' | 'rejected' | 'review';
}

export interface ThumbnailRecord {
  photoId: string;
  blob: Blob;               // JPEG thumbnail ~512px — never keep full-res in memory
}

export interface FaceInsight {
  box: [number, number, number, number];   // x, y, w, h (normalized 0..1)
  faceScore: number;                        // detector confidence 0..1
  smile: number;                            // 0..1 (emotion "happy")
  eyesOpen: { left: number; right: number }; // EAR-derived openness 0..1
  isBlinking: boolean;
  personId: string | null;                  // matched known person, or null = stranger
  personName: string | null;
  similarity: number;                       // cosine similarity to best known match
  embedding?: number[];                     // 1024-dim descriptor (stored for re-matching)
}

export interface AnalysisRecord {
  photoId: string;
  faces: FaceInsight[];
  faceCount: number;
  knownFaceCount: number;
  strangerCount: number;
  bestSmile: number;
  allEyesOpen: boolean;
  sharpness: number;        // 0..100 (Laplacian variance, computed in worker)
  exposure: number;         // 0..100
  sceneType: 'portrait' | 'group' | 'landscape' | 'detail';
  aiScore: number;          // final score from ContextEngine
  analyzedAt: number;
}

export interface KnownPerson {
  id: string;               // uuid
  name: string;             // "Ami", "Soția", "Eu"
  embeddings: number[][];   // multiple reference embeddings per person (enrollment)
  updatedAt: number;
}

export interface ContextModelRecord {
  contextKey: string;       // e.g. "portrait:known", "landscape", "group:mixed"
  weights: Record<string, number>;
  bias: number;
  featureStats: Record<string, { mean: number; m2: number; n: number }>; // Welford
  sampleCount: number;
  updatedAt: number;
}

export interface CorrectionRecord {
  id?: number;
  photoId: string;
  contextKey: string;
  features: Record<string, number>;
  aiDecision: boolean;      // AI said "select"
  userDecision: boolean;    // user said "select"
  ts: number;
}

// ── Database ─────────────────────────────────────────────────────────────────

export class LuminDB extends Dexie {
  photos!: Table<PhotoRecord, string>;
  thumbnails!: Table<ThumbnailRecord, string>;
  analyses!: Table<AnalysisRecord, string>;
  persons!: Table<KnownPerson, string>;
  contextModels!: Table<ContextModelRecord, string>;
  corrections!: Table<CorrectionRecord, number>;

  constructor() {
    super('lumin-culler-v2');
    this.version(1).stores({
      photos: 'id, capturedAt, status, dHash',
      thumbnails: 'photoId',
      analyses: 'photoId, sceneType, aiScore',
      persons: 'id, name',
      contextModels: 'contextKey',
      corrections: '++id, contextKey, ts'
    });
  }
}

export const db = new LuminDB();
