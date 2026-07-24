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
  /**
   * Rating 1-5 stele, independent de status (ca in Lightroom: flag-ul
   * pick/reject si rating-ul sunt axe separate — o poza poate fi Selectata
   * SI 3 stele, sau De verificat fara nicio stea). Optional/0/absent = fara
   * rating; nu necesita bump de schema Dexie (camp neindexat, filtrat client-side).
   */
  rating?: number;
  /**
   * Genul fotografic activ la momentul importului ("Nunta", "Portret", ...),
   * ales de utilizator inainte de import — vezi state/genre.ts. Prefixeaza
   * contextKey (ContextEngine.deriveContextKey), astfel incat modelul de
   * preferinte invatat pentru "Nunta:portrait:known" sa fie complet separat
   * de "Peisaj:landscape". Pastrat PE POZA (nu doar ca setare globala curenta)
   * ca schimbarea genului activ ulterior sa nu "mute" retroactiv contextul
   * unei corectii deja inregistrate. Optional: absent = fara gen ales
   * (comportament identic cu inainte de aceasta functie); nu necesita bump
   * de schema Dexie (camp neindexat, filtrat/citit client-side).
   */
  genre?: string;
  /**
   * Numele proiectului/sesiunii activ la momentul importului (ProjectNameField
   * din App.tsx, PhotoRecord distinct de `genre` — un proiect ("Nunta Ana & Mihai")
   * poate contine mai multe genuri, desi de obicei coincid). Pastrat PE POZA, nu
   * doar ca eticheta curenta, ca "Modulul Proiecte" (plan 3.2.3) sa poata agrega
   * retroactiv istoricul real de import per proiect. Optional: absent = fara
   * proiect ales; nu necesita bump de schema Dexie (camp neindexat).
   */
  project?: string;
  /**
   * Eticheta de culoare (Lightroom-style color label) — a DOUA axa de
   * organizare libera, independenta de status/rating (ex. "rosu" = de
   * retusat, "albastru" = trimis clientului deja). Absent sau 'none' = fara
   * eticheta; nu necesita bump de schema Dexie (camp neindexat, filtrat
   * client-side, exact ca `rating`/`genre`/`project` de mai sus).
   */
  colorLabel?: ColorLabel;
}

export type ColorLabel = 'none' | 'red' | 'yellow' | 'green' | 'blue' | 'purple';
/** Toate etichetele asignabile, EXCLUZAND 'none' (care inseamna "fara eticheta", nu o culoare reala) — sursa unica pentru orice UI de asignare/filtrare. */
export const COLOR_LABELS: Exclude<ColorLabel, 'none'>[] = ['red', 'yellow', 'green', 'blue', 'purple'];

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

/**
 * Referinta usoara catre fisierul original de pe disc (File System Access API),
 * folosita IN LOC de OriginalRecord.blob cand browserul o suporta — un handle
 * e cateva zeci de octeti (nu MB/zeci de MB per poza), asa ca nu risca
 * QuotaExceededError pe importuri mari. FileSystemFileHandle e clonabil
 * structural in IndexedDB (Chromium); getFile()/permisiunile sunt verificate
 * la citire (vezi filePicker.ts reacquireFile).
 */
export interface FileHandleRecord {
  photoId: string;
  handle: import('./filePicker').FileSystemFileHandleLike;
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
  /**
   * "Panou de informatii extins" (plan 3.2.2) — restul metadatelor EXIF utile
   * pentru camera/obiectiv/locatie, dincolo de campurile de mai sus (folosite
   * direct pentru scorare). Vezi core/exifParser.ts pentru ce anume citesc.
   */
  cameraMake?: string;
  cameraModel?: string;
  lensModel?: string;
  exifSoftware?: string;
  exifArtist?: string;
  exifCopyright?: string;
  exposureBias?: number;
  meteringMode?: string;
  flashFired?: boolean;
  whiteBalance?: 'auto' | 'manual';
  focalLength35mm?: number;
  gpsLatitude?: number;
  gpsLongitude?: number;

  /**
   * Metadate IPTC-IIM (segment Photoshop APP13, distinct de EXIF/XMP) — vezi
   * core/iptcParser.ts. Multe fluxuri profesionale (agentii foto, Photo
   * Mechanic, exporturi Lightroom mai vechi) inca scriu doar IPTC-IIM.
   */
  iptcByline?: string;
  iptcCaption?: string;
  iptcHeadline?: string;
  iptcCredit?: string;
  iptcSource?: string;
  iptcCopyright?: string;
  iptcCity?: string;
  iptcCountry?: string;
  iptcKeywords?: string[];

  // ── Analiza estetica avansata ──────────────────────────────────────────
  // Toate calculate geometric/statistic direct din pixeli (Sobel, histograme
  // HSV, varianta locala) sau din campurile deja detectate (fete, EXIF) —
  // fara modele ML noi. Optionale: absente pe inregistrari mai vechi,
  // tratate ca neutre in ContextEngine (extractFeatures), nu ca zero.
  /** Scor agregat de compozitie (0..1) — combina treimile/headroom (subiect uman)
   *  sau liniile directoare/simetria/spatiul negativ (scene fara fete). */
  compositionScore?: number;
  /** Concentrare puternica a muchiilor pe directii convergente/diagonale dominante. */
  leadingLinesDetected?: boolean;
  /** Jumatatea stanga a cadrului e aproape o oglinda a celei drepte (harta de muchii). */
  symmetryDetected?: boolean;
  /** Fractiune din cadru cu detaliu local scazut (zone "goale" — cer, perete, fundal uniform), 0..1. */
  negativeSpaceScore?: number;
  /** Duritatea luminii, din distributia contrastului local (Sobel): 'hard' = umbre nete/contrast mare. */
  lightQuality?: 'soft' | 'hard' | 'mixed' | 'unknown';
  /** Nuanta calda dominanta (portocaliu/auriu) + ora capturii apropiata de rasarit/apus — semnal aproximativ. */
  goldenHourDetected?: boolean;
  /** Doar cand exista fete: subiectul principal e mai clar decat fundalul (claritate locala box fata vs. rest). */
  subjectInFocus?: boolean;
  /** Diferenta de claritate subiect/fundal, calitativa — 'n/a' cand nu exista subiect uman de comparat. */
  bokehQuality?: 'good' | 'average' | 'poor' | 'n/a';
  /** Armonia paletei de culori (0..1) — complementara/analoaga = scor mare, culori dezordonate = scor mic. */
  colorHarmonyScore?: number;
  /** Cele mai frecvente 3 culori din cadru (cuantizate), format hex — pentru afisare/paleta. */
  dominantColors?: string[];
  /** Eticheta compusa din tipul de scena + varsta estimata a subiectului principal (cand e disponibila). */
  sceneSemantic?: string;
  /**
   * Etichete generale de obiect/scena (ex. "seashore", "golden retriever", "mountain bike"),
   * dintr-un clasificator ImageNet generic (MobileNetV2) — spre deosebire de sceneSemantic
   * (derivat din fetele detectate), acestea functioneaza si pe cadre fara oameni. Optionale:
   * absente daca modelul de clasificare nu s-a putut incarca (degradare graduala, ca
   * aiDegraded) sau pe inregistrari dinaintea acestei functii.
   */
  sceneTags?: string[];
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
  fileHandles!: Table<FileHandleRecord, string>;
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
    // v5: handle-uri File System Access API pentru fisierele originale (plan
    // 2.3.4) — tabela noua, separata de `originals` (care ramane blob-ul
    // complet, fallback pentru browserele fara suport pentru API).
    this.version(5).stores({
      photos: 'id, capturedAt, status, dHash, groupId',
      thumbnails: 'photoId',
      previews: 'photoId',
      originals: 'photoId',
      fileHandles: 'photoId',
      analyses: 'photoId, sceneType, aiScore',
      persons: 'id, name',
      contextModels: 'contextKey',
      corrections: '++id, contextKey, ts',
      history: '++id, ts'
    });
  }
}

export const db = new LuminDB();
