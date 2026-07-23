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
  /**
   * Vectorul complet de emotie (7 clase, model FER standard) — smile ramane
   * pastrat separat pentru compatibilitate, dar engagement e derivat din
   * TOATE emotiile (happy+surprise pozitive, angry/disgust/sad/fear negative),
   * nu doar zambet. Optional: inregistrarile vechi nu au acest camp.
   */
  emotion?: { happy: number; surprise: number; neutral: number; negative: number };
  /**
   * Contact vizual estimat (0..1), din unghiul capului (yaw/pitch fata de
   * camera) + offset-ul irisului fata de centrul ochiului (Human.js
   * rotation.gaze). Foloseste doar MAGNITUDINEA acestor semnale, nu directia —
   * nu conteaza daca subiectul se uita stanga sau dreapta, doar CAT de departe
   * e de a privi direct spre camera. Optional: necesita mesh de 478 puncte
   * (iris activat) si o fata suficient de mare/clara.
   */
  eyeContact?: number;
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
  /**
   * Compozitie, calculata geometric din pozitia subiectului principal (fata
   * cea mai mare) fata de cadru — 0..1, 1 = aliniere ideala. Optionale: pozele
   * fara fete nu au subiect detectabil, iar inregistrarile mai vechi (dinainte
   * de aceasta functie) nu le au deloc — extractFeatures (ContextEngine)
   * trateaza absenta ca neutru (0.5), nu ca zero.
   */
  ruleOfThirds?: number;   // regula treimilor: cat de aproape e centrul fetei de o intersectie de treimi
  headroom?: number;       // spatiul deasupra capului: 0 = fata lipita de margine, 1 = in zona ideala
  /** topFactors din predictia ContextEngine la momentul importului — "de ce" a primit poza acest scor. */
  aiFactors?: { feature: string; contribution: number }[];
  /**
   * Scorare de GRUP (toate fetele, nu doar cea mai buna) — problema clasica la
   * poze cu mai multe persoane: mereu cineva clipeste. 0..1, fractiunea de fete
   * cu ochii deschisi / care zambesc. Optional: doar cand faceCount > 0.
   */
  groupEyesOpenRatio?: number;
  groupSmileRatio?: number;
  /** Media contact-vizual (eyeContact) pe toate fetele — 0..1. Optional: doar cand faceCount > 0. */
  avgEyeContact?: number;
  /** Media "engagement" (expresie pozitiva vs negativa) pe toate fetele — 0..1. Optional: doar cand faceCount > 0. */
  avgEngagement?: number;
  /**
   * Histograma pe versiunea redusa (320px) deja calculata pentru claritate —
   * fractiune de pixeli aproape complet alb / aproape complet negru, adica
   * detaliu pierdut in highlights/shadows. 0 = fara clipping, 1 = tot cadrul.
   */
  highlightClipping?: number;
  shadowClipping?: number;
  /**
   * Inclinarea orizontului fata de linia perfect orizontala, in grade (0 =
   * perfect drept). Calculata din directia dominanta a gradientilor de margine
   * — doar pentru poze fara fete (unde compozitia geometrica pe fata principala
   * nu se aplica). Optional: absenta = nu s-a putut estima (prea putine
   * margini clare, ex. cer uniform).
   */
  horizonTiltDeg?: number;
  /**
   * Metadate EXIF reale, citite direct din octetii fisierului original
   * (core/exifParser.ts) — createImageBitmap/canvas NU expun deloc EXIF.
   * Optionale: poze fara EXIF (PNG/WebP, sau JPEG cu metadate sterse).
   */
  iso?: number;
  fNumber?: number;        // f/X (diafragma)
  exposureTime?: number;   // secunde (1/250 -> 0.004)
  focalLength?: number;    // mm
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

/**
 * Istoric de decizii MANUALE (Selecteaza/Respinge), pentru undo — separat de
 * CorrectionRecord (care alimenteaza ContextEngine si NU e revertit la undo:
 * a "de-antrena" corect un pas de gradient online nu e o operatie sigura/
 * curata, iar impactul unui singur pas e oricum mic; undo aici inseamna doar
 * "arata-mi din nou ce am vazut inainte de decizie", nu "sterge ce a invatat
 * modelul din ea").
 */
export interface HistoryRecord {
  id?: number;
  photoId: string;
  previousStatus: PhotoRecord['status'];
  newStatus: PhotoRecord['status'];
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
  history!: Table<HistoryRecord, number>;

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
    // v4: istoric de decizii pentru undo ("Anuleaza ultimele 10 decizii") —
    // tabela noua, nu doar campuri adaugate, deci necesita bump de versiune.
    this.version(4).stores({
      photos: 'id, capturedAt, status, dHash, groupId',
      thumbnails: 'photoId',
      previews: 'photoId',
      originals: 'photoId',
      analyses: 'photoId, sceneType, aiScore',
      persons: 'id, name',
      contextModels: 'contextKey',
      corrections: '++id, contextKey, ts',
      history: '++id, ts'
    });
  }
}

export const db = new LuminDB();
