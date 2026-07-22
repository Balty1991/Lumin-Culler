/**
 * core/db.ts
 * Persistence layer (IndexedDB via Dexie).
 * All heavy data (thumbnails, previews, embeddings, AI metadata) lives here, NOT in RAM.
 */
import Dexie, { type Table } from 'dexie';

// ── Domain types ─────────────────────────────────────────────────────────────

export interface PhotoRecord {
  id: string;
  fileName: string;
  capturedAt?: number;
  importedAt: number;
  width: number;
  height: number;
  dHash: string;
  groupId?: string;         // seria/duplicatele din care face parte
  status: 'pending' | 'selected' | 'rejected' | 'review';
}

export interface ThumbnailRecord {
  photoId: string;
  blob: Blob;               // JPEG ~512px pentru grila
}

export interface PreviewRecord {
  photoId: string;
  blob: Blob;               // JPEG ~2048px pentru evaluarea claritatii (zoom 100%)
}

export interface OriginalRecord {
  photoId: string;
  blob: Blob;                // fisierul original, byte-cu-byte (pentru export "format original")
  fileName: string;
  type: string;
}

export interface FaceInsight {
  box: [number, number, number, number];
  faceScore: number;
  smile: number;
  eyesOpen: { left: number; right: number };
  isBlinking: boolean;
  personId: string | null;
  personName: string | null;
  similarity: number;
  embedding?: number[];
}

export interface AnalysisRecord {
  photoId: string;
  faces: FaceInsight[];
  faceCount: number;
  knownFaceCount: number;
  strangerCount: number;
  bestSmile: number;
  allEyesOpen: boolean;
  sharpness: number;
  exposure: number;
  sceneType: 'portrait' | 'group' | 'landscape' | 'detail';
  aiScore: number;
  analyzedAt: number;
}

export interface KnownPerson {
  id: string;
  name: string;
  embeddings: number[][];
  updatedAt: number;
}

export interface ContextModelRecord {
  contextKey: string;
  weights: Record<string, number>;
  bias: number;
  featureStats: Record<string, { mean: number; m2: number; n: number }>;
  sampleCount: number;
  updatedAt: number;
}

export interface CorrectionRecord {
  id?: number;
  photoId: string;
  contextKey: string;
  features: Record<string, number>;
  aiDecision: boolean;
  userDecision: boolean;
  ts: number;
}

// ── Database ─────────────────────────────────────────────────────────────────

export class LuminDB extends Dexie {
  photos!: Table<PhotoRecord, string>;
  thumbnails!: Table<ThumbnailRecord, string>;
  previews!: Table<PreviewRecord, string>;
  originals!: Table<OriginalRecord, string>;
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
    this.version(2).stores({
      photos: 'id, capturedAt, status, dHash, groupId',
      thumbnails: 'photoId',
      previews: 'photoId',
      analyses: 'photoId, sceneType, aiScore',
      persons: 'id, name',
      contextModels: 'contextKey',
      corrections: '++id, contextKey, ts'
    });
    // v3: pastram fisierul original doar pentru pozele SELECTATE (nu toate cele
    // 1000+ importate) — suficient ca exportul "format original" sa supravietuiasca
    // unui reload de tab (frecvent pe mobil, cand browserul descarca tab-urile
    // puse in fundal), fara sa dublam spatiul ocupat de intregul import.
    this.version(3).stores({
      photos: 'id, capturedAt, status, dHash, groupId',
      thumbnails: 'photoId',
      previews: 'photoId',
      originals: 'photoId',
      analyses: 'photoId, sceneType, aiScore',
      persons: 'id, name',
      contextModels: 'contextKey',
      corrections: '++id, contextKey, ts'
    });
  }
}

export const db = new LuminDB();
