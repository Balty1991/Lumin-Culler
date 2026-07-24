/**
 * state/store.ts
 * Managementul starii (Zustand) — separat de UI. Include fluxul de comparare
 * a seriilor: alegi cea mai buna poza dintr-un grup de cadre similare.
 */
import { create } from 'zustand';
import { db, type AnalysisRecord, type PhotoRecord, type KnownPerson } from '../core/db';
import { importFiles, originalFiles, createCancelToken, type ImportProgress, type ImportCancelToken } from '../core/importPipeline';
import { readEconomicMode, writeEconomicMode } from '../core/performanceSettings';
import { exportOriginalFiles, computeGroupPersonUnion } from '../core/exportPhotos';
import { exportXMPSidecars, deriveXmpKeywords, deriveAiScoreKeyword, deriveSeriesKeyword } from '../core/export/xmpGenerator';
import { analysisPool } from '../core/workerPool';
import { contextEngine, deriveContextKey, explainFactors } from '../core/learning/ContextEngine';
import { pickBestInGroup } from '../core/groupSelection';
import {
  pushHistory, popHistory, MAX_HISTORY, type HistoryEvent,
  pushBatchHistory, popBatchHistory, type BatchHistoryEvent
} from './history';
import { selectBulkRejectTargets, resolveGroups, selectTopPercent } from './batchOps';
import { readStoredTheme, applyTheme, type Theme } from './theme';
import { readStoredProjectName, writeProjectName } from './projectName';
import { readStoredGenre, writeStoredGenre } from './genre';
import { readGridDensity, writeGridDensity, type GridDensity } from './gridDensity';
import { readGridSort, writeGridSort, compareBy, type GridSort } from './gridSort';
import { recordUsage, readMonthlyUsage, FREE_TIER_MONTHLY_LIMIT } from './usage';
import { getProjectMetadata } from './projectMetadata';
import { buildPersonProfilesExport, personProfilesFileName, parsePersonProfilesFile } from '../core/personProfileTransfer';
import { readStoredLocale, writeStoredLocale, applyLocale, t, plural, type Locale } from '../i18n';
import { buildBackup, backupFileName, parseBackupFile, restoreBackup } from '../core/backupService';
import { buildClientGalleryHtml } from '../core/export/clientGallery';

export interface PhotoView {
  id: string;
  fileName: string;
  status: PhotoRecord['status'];
  rating: number;
  aiScore: number;
  sceneType: AnalysisRecord['sceneType'];
  contextKey: string;
  faceCount: number;
  knownFaceCount: number;
  strangerCount: number;
  bestSmile: number;
  allEyesOpen: boolean;
  sharpness: number;
  exposure: number;
  ruleOfThirds: number;
  headroom: number;
  groupEyesOpenRatio?: number;
  groupSmileRatio?: number;
  iso?: number;
  fNumber?: number;
  exposureTime?: number;
  focalLength?: number;
  /** "Panou de informatii extins" (plan 3.2.2) — metadate EXIF de camera/obiectiv/locatie. */
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
  aiFactors: { feature: string; contribution: number }[];
  personNames: string[];
  /** Persoanele cunoscute recunoscute in ACEASTA poza, cu similaritatea (0..1) cea mai buna dintre fetele care le corespund — "confidence score" (plan 3.2.3). */
  personMatches: { name: string; similarity: number }[];
  groupId?: string;
  capturedAt?: number;
  /** Genul fotografic activ la import ("Nunta", "Portret", ...) — vezi state/genre.ts si ContextEngine.deriveContextKey. */
  genre?: string;
  /** Numele proiectului/sesiunii active la import (ProjectNameField) — vezi PhotoRecord.project. */
  project?: string;
  goldenHourDetected?: boolean;
  dominantColors?: string[];
  /** Eticheta compusa scena+varsta (ex. "portrait_child") — folosita ca sursa de keywords la exportul XMP. */
  sceneSemantic?: string;
  /** Etichete generale de obiect/scena (COCO-80, ex. "dog", "cake", "boat") — vezi AnalysisRecord.sceneTags. */
  sceneTags?: string[];
}

export type FilterKey = 'all' | 'selected' | 'review' | 'rejected' | 'series' | 'blinks' | 'goldenHour';

/** Cheie de proiectFilter pentru pozele fara proiect ales — un nume de proiect real nu poate coincide cu acest sentinel (spatii, gol dupa trim). */
export const NO_PROJECT_KEY = 'no-project';

interface AppState {
  photos: PhotoView[];
  persons: KnownPerson[];
  progress: ImportProgress | null;
  /** Poate anula un import in curs — vezi runImport/cancelImport mai jos. */
  cancelImport: () => void;
  /** Mod economic: pool de un singur worker + fara iris/emotie — mai putina presiune pe CPU/RAM, pe hardware slab. */
  economicMode: boolean;
  setEconomicMode: (on: boolean) => void;
  /** Genul fotografic activ pentru urmatorul import ("Nunta", "Portret", ...) — vezi state/genre.ts. */
  genre: string;
  setGenre: (genre: string) => void;
  /** Densitatea grilei (dimensiunea miniaturilor) — persistata local, aplicata atat grilei simple cat si celei virtualizate. */
  gridDensity: GridDensity;
  setGridDensity: (density: GridDensity) => void;
  /** Criteriul de sortare a grilei (plan 3.2.1) — implicit dupa data capturii, ca pana acum. Persistat local. */
  gridSort: GridSort;
  setGridSort: (sort: GridSort) => void;
  /** Exporta persoanele cunoscute + modelele AI invatate (fara imagini) intr-un fisier JSON de backup. */
  exportBackup: () => Promise<void>;
  /** Restaureaza un backup: persoane + modele AI, plus reaplicarea deciziilor (status/rating) pe pozele curente care se potrivesc (nume fisier + data capturii). */
  importBackupFile: (file: File) => Promise<void>;
  /** Viteza ultimului import (poze procesate + durata) — afisata in Statistici; null inainte de primul import al sesiunii. */
  lastImportStats: { count: number; durationMs: number } | null;
  /** Contor informativ de poze procesate in luna curenta — vezi state/usage.ts (NU e o limita reala/blocanta). */
  monthlyUsage: number;
  statsOpen: boolean;
  setStatsOpen: (open: boolean) => void;
  filter: FilterKey;
  /** Filtru suplimentar, combinabil cu `filter` — numele unei persoane cunoscute, sau null (fara filtru). */
  personFilter: string | null;
  /** Filtru suplimentar dupa proiectul sub care a fost importata poza (PhotoRecord.project) — vezi ProjectsPanel. */
  projectFilter: string | null;
  setProjectFilter: (project: string | null) => void;
  projectsOpen: boolean;
  setProjectsOpen: (open: boolean) => void;
  /**
   * Filtre suplimentare, toate combinabile intre ele si cu `filter`/`personFilter` —
   * utile la biblioteci mari (mii de poze), unde navigarea doar prin status/persoana
   * nu mai e suficienta ca sa gasesti rapid o poza anume.
   */
  searchText: string;
  /** Interval de data (capturedAt), epoch ms — null = fara limita pe partea respectiva. */
  dateFrom: number | null;
  dateTo: number | null;
  /** Rating minim (1-5), 0 = fara filtru de rating. */
  minRating: number;
  detailId: string | null;
  compareGroupId: string | null;
  personsOpen: boolean;
  menuOpen: boolean;
  insightsOpen: boolean;
  workspaceMode: boolean;
  batchOpsOpen: boolean;
  paletteOpen: boolean;
  shortcutsOpen: boolean;
  theme: Theme;
  setTheme: (theme: Theme) => void;
  /** Limba interfetei — vezi i18n/index.ts. Migrare treptata: doar unele ecrane citesc asta deocamdata, restul ramane in romana codificata direct. */
  locale: Locale;
  setLocale: (locale: Locale) => void;
  projectName: string;
  setProjectName: (name: string) => void;
  booted: boolean;
  /** false daca dispozitivul nu a putut incarca WebGL/WASM — analiza continua dar fara fete reale. */
  aiDegraded: boolean;
  aiBackend: string;
  /**
   * Ultimele decizii manuale (Selecteaza/Respinge), pentru undo — NU include
   * actiunile de grup (keepOnlyInGroup), scop deliberat restrans la interactia
   * cea mai frecventa/predispusa la greseli (un swipe/tap accidental).
   */
  history: HistoryEvent[];
  /**
   * Istoric SEPARAT pentru operatiile in masa (Auto-Cull, Respinge sub prag,
   * Rezolva toate seriile, actiuni pe selectia multipla) — o intrare per lot
   * intreg, nu una per poza (ar inunda instant `history`, capat la 10).
   * `undo()` alege automat cea mai recenta dintre `history`/`batchHistory`
   * dupa timestamp, deci un singur buton/Ctrl+Z acopera ambele.
   */
  batchHistory: BatchHistoryEvent[];
  /**
   * Selectie in masa in grila — Ctrl/Cmd+Click adauga/scoate o poza, Shift+Click
   * selecteaza un interval fata de ultima poza atinsa cu Ctrl sau Shift, iar cat
   * timp exista ceva in selectie, un click simplu continua sa comute selectia
   * (nu mai deschide DetailView) pana la Deselecteaza/Escape — acelasi tipar ca
   * Gmail/Google Photos, nu necesita tinerea Ctrl apasat pentru fiecare click.
   */
  multiSelectIds: Set<string>;
  multiSelectAnchor: string | null;
  /**
   * "Mod selectie" explicit — comutator vizibil (buton), NU doar starea
   * implicita de "am ceva selectat deja" (multiSelectIds.size > 0). Necesar
   * pe touch: Ctrl/Shift+Click nu exista pe telefon/tableta, deci fara acest
   * comutator prima selectie ar fi imposibil de pornit fara tastatura/mouse.
   */
  selectMode: boolean;

  boot: () => Promise<void>;
  runImport: (files: File[]) => Promise<void>;
  setStatus: (id: string, status: PhotoRecord['status']) => Promise<void>;
  /**
   * Rating 1-5 stele — axa SEPARATA de status (pick/respins/de verificat),
   * ca in Lightroom. Click pe aceeasi stea deja setata o sterge (trece la 0).
   * Nu antreneaza ContextEngine (doar Selecteaza/Respinge fac asta) si nu
   * intra in istoricul de undo (actiune cu risc scazut, reversibila oricand
   * cu un nou click).
   */
  setRating: (id: string, rating: number) => Promise<void>;
  undo: () => Promise<void>;
  keepOnlyInGroup: (groupId: string, keepId: string) => Promise<void>;
  /**
   * Generalizarea lui keepOnlyInGroup pentru burst-uri mari (sport/wildlife —
   * zeci de cadre aproape identice dintr-o secvena de miscare): pastreaza MAI
   * MULTE cadre bune dintr-o serie, nu doar unul singur, restul se resping.
   */
  keepManyInGroup: (groupId: string, keepIds: string[]) => Promise<void>;
  /**
   * Recomandarea AI pentru "cea mai buna" poza dintr-o serie — ierarhie de
   * criterii (claritate > expunere > compozitie > expresii faciale > contact
   * vizual) pe AnalysisRecord complet, nu doar scorul AI brut (vezi
   * core/groupSelection.ts). Nu schimba nimic in DB — doar raspunde cu id-ul
   * recomandat, pentru afisare in UI (GroupCompare).
   */
  selectBestPhotoInGroup: (groupId: string) => Promise<string | null>;
  /** Respinge in bloc pozele nedecise (nu selectate/respinse deja) cu scor sub prag. */
  bulkRejectBelow: (threshold: number) => Promise<{ affected: number }>;
  /** Rezolva TOATE seriile deodata: cea mai buna poza din fiecare ramane, restul se resping. */
  resolveAllSeries: () => Promise<{ groupsResolved: number }>;
  /** Auto-Cull: pastreaza cele mai bune X% (dupa scor) din pozele nedecise, respinge restul. */
  autoCullTopPercent: (percent: number) => Promise<{ selected: number; rejected: number }>;
  /** Comuta o singura poza in/din selectia in masa — Ctrl/Cmd+Click sau, cat timp selectia nu e goala, orice click simplu pe card. */
  toggleMultiSelect: (id: string) => void;
  /** Selecteaza tot intervalul dintre ultimul anchor si `id`, in ordinea data (lista filtrata curenta) — Shift+Click. */
  rangeMultiSelect: (id: string, orderedIds: string[]) => void;
  /** Forteaza o poza in/afara selectiei (spre deosebire de toggleMultiSelect) — folosit la "vopsirea" prin drag peste mai multe carduri. */
  setMultiSelected: (id: string, on: boolean) => void;
  clearMultiSelect: () => void;
  setSelectMode: (on: boolean) => void;
  /** Aplica un status TUTUROR pozelor din selectia curenta (antreneaza AI-ul per poza, ca setStatus). */
  bulkSetStatusForSelection: (status: PhotoRecord['status']) => Promise<void>;
  /** Aplica un rating TUTUROR pozelor din selectia curenta. */
  bulkSetRatingForSelection: (rating: number) => Promise<void>;
  setFilter: (f: FilterKey) => void;
  setPersonFilter: (name: string | null) => void;
  setSearchText: (text: string) => void;
  setDateRange: (from: number | null, to: number | null) => void;
  setMinRating: (rating: number) => void;
  clearAdvancedFilters: () => void;
  openDetail: (id: string | null) => void;
  openCompare: (groupId: string | null) => void;
  stepDetail: (dir: 1 | -1) => void;
  addPerson: (name: string, files: File[]) => Promise<{ ok: boolean; message: string }>;
  removePerson: (id: string) => Promise<void>;
  /** Sterge mai multe persoane deodata (bulk delete, plan 3.2.3 "Gestionare avansata"). */
  removePersons: (ids: string[]) => Promise<void>;
  /** Uneste 2+ persoane intr-un singur profil (ex. aceeasi persoana inrolata de doua ori, sub nume diferite) — pastreaza numele dat, uneste referintele faciale. */
  mergePersons: (ids: string[], keepName: string) => Promise<void>;
  /** Exporta profilurile alese (nume + referinte faciale) intr-un JSON — distinct de backup-ul general (exportBackup), care exporta TOT. */
  exportPersonProfiles: (ids: string[]) => Promise<void>;
  importPersonProfiles: (file: File) => Promise<void>;
  /**
   * Inroleaza o persoana noua direct dintr-un cluster de fete NErecunoscute
   * sugerat de AI (vezi core/faceClustering.ts) — foloseste embedding-urile
   * deja calculate (nu cere poze noi de referinta) si re-eticheteaza
   * RETROACTIV fetele din cluster in analizele deja existente, ca persoana
   * sa nu mai apara drept "strain" in restul bibliotecii curente.
   */
  enrollFaceCluster: (name: string, members: { photoId: string; faceIndex: number; embedding: number[] }[]) => Promise<void>;
  setPersonsOpen: (open: boolean) => void;
  setMenuOpen: (open: boolean) => void;
  setInsightsOpen: (open: boolean) => void;
  setWorkspaceMode: (on: boolean) => void;
  setBatchOpsOpen: (open: boolean) => void;
  setPaletteOpen: (open: boolean) => void;
  setShortcutsOpen: (open: boolean) => void;
  clearAll: () => Promise<void>;
  /**
   * "Golește sesiunea" curata doar biblioteca de poze — persoanele inrolate
   * (nume + embeddings faciale) sunt profiluri durabile, nu date de sesiune,
   * si supravietuiesc intentionat. Pentru un utilizator care vrea sa nu
   * ramana NIMIC biometric pe dispozitiv, e nevoie de o actiune separata,
   * explicita — vezi PersonsPanel.
   */
  clearAllIncludingPersons: () => Promise<void>;
  /** toast general de stare: rezultat export, avertisment de stocare etc. */
  notice: string | null;
  clearNotice: () => void;
  exportSelection: () => Promise<void>;
  exportManifest: () => Promise<void>;
  exportXMP: () => Promise<void>;
  /** Genereaza si descarca o galerie HTML statica cu pozele selectate, pentru feedback de la client. */
  exportClientGallery: () => Promise<void>;
  filtered: () => PhotoView[];
  groupOf: (groupId: string) => PhotoView[];
}

/** Token-ul importului CURENT (daca vreunul ruleaza) — traieste in afara Zustand
    fiindca nu are sens sa fie parte din snapshot-ul de stare serializabil. */
let activeCancelToken: ImportCancelToken | null = null;

/** Cea mai buna similaritate per nume recunoscut — o poza poate avea mai multe fete ale aceleiasi persoane (rar, dar posibil geometric). */
function bestMatchPerName(faces: AnalysisRecord['faces']): { name: string; similarity: number }[] {
  const best = new Map<string, number>();
  for (const f of faces) {
    if (!f.personName) continue;
    const current = best.get(f.personName);
    if (current === undefined || f.similarity > current) best.set(f.personName, f.similarity);
  }
  return Array.from(best, ([name, similarity]) => ({ name, similarity }));
}

function toView(photo: PhotoRecord, analysis: AnalysisRecord | undefined): PhotoView {
  return {
    id: photo.id,
    fileName: photo.fileName,
    status: photo.status,
    rating: photo.rating ?? 0,
    aiScore: analysis?.aiScore ?? 0,
    sceneType: analysis?.sceneType ?? 'detail',
    contextKey: analysis ? deriveContextKey(analysis, photo.genre) : 'detail',
    faceCount: analysis?.faceCount ?? 0,
    knownFaceCount: analysis?.knownFaceCount ?? 0,
    strangerCount: analysis?.strangerCount ?? 0,
    bestSmile: analysis?.bestSmile ?? 0,
    allEyesOpen: analysis?.allEyesOpen ?? true,
    sharpness: analysis?.sharpness ?? 0,
    exposure: analysis?.exposure ?? 0,
    ruleOfThirds: analysis?.ruleOfThirds ?? 0.5,
    headroom: analysis?.headroom ?? 0.5,
    groupEyesOpenRatio: analysis?.groupEyesOpenRatio,
    groupSmileRatio: analysis?.groupSmileRatio,
    iso: analysis?.iso,
    fNumber: analysis?.fNumber,
    exposureTime: analysis?.exposureTime,
    focalLength: analysis?.focalLength,
    cameraMake: analysis?.cameraMake,
    cameraModel: analysis?.cameraModel,
    lensModel: analysis?.lensModel,
    exifSoftware: analysis?.exifSoftware,
    exifArtist: analysis?.exifArtist,
    exifCopyright: analysis?.exifCopyright,
    exposureBias: analysis?.exposureBias,
    meteringMode: analysis?.meteringMode,
    flashFired: analysis?.flashFired,
    whiteBalance: analysis?.whiteBalance,
    focalLength35mm: analysis?.focalLength35mm,
    gpsLatitude: analysis?.gpsLatitude,
    gpsLongitude: analysis?.gpsLongitude,
    aiFactors: analysis?.aiFactors ?? [],
    personNames: analysis
      ? Array.from(new Set(analysis.faces.map(f => f.personName).filter((n): n is string => !!n)))
      : [],
    personMatches: analysis ? bestMatchPerName(analysis.faces) : [],
    groupId: photo.groupId,
    capturedAt: photo.capturedAt,
    genre: photo.genre,
    project: photo.project,
    goldenHourDetected: analysis?.goldenHourDetected,
    dominantColors: analysis?.dominantColors,
    sceneSemantic: analysis?.sceneSemantic,
    sceneTags: analysis?.sceneTags
  };
}

/** Reconstruieste toate PhotoView-urile direct din Dexie — folosit la boot() si dupa restaurarea unui backup. */
async function reloadPhotoViews(): Promise<PhotoView[]> {
  const [photos, analyses] = await Promise.all([db.photos.toArray(), db.analyses.toArray()]);
  const byId = new Map(analyses.map(a => [a.photoId, a]));
  return photos
    .map(p => toView(p, byId.get(p.id)))
    .sort((a, b) => (a.capturedAt ?? 0) - (b.capturedAt ?? 0));
}

async function train(id: string, userDecision: boolean): Promise<void> {
  const [analysis, photo] = await Promise.all([db.analyses.get(id), db.photos.get(id)]);
  if (!analysis) return;
  const aiDecision = analysis.aiScore >= 65;
  await contextEngine.recordCorrection({ photoId: id, analysis, aiDecision, userDecision, genre: photo?.genre });
}

function makeBatchEvent(label: string, changes: { photoId: string; previousStatus: PhotoRecord['status'] }[]): BatchHistoryEvent {
  return { id: crypto.randomUUID(), label, changes, ts: Date.now() };
}

/**
 * Pastreaza fisierul original in IndexedDB doar cat timp poza e SELECTATA —
 * altfel exportul "format original" depinde de un File tinut in memorie care
 * dispare la orice reload de tab (frecvent pe mobil, cand browserul descarca
 * tab-urile din fundal ca sa economiseasca RAM). La deselectare, il stergem
 * la loc ca sa nu dublam spatiul ocupat de intregul import.
 */
async function syncOriginal(id: string, status: PhotoRecord['status']): Promise<{ quotaError: boolean }> {
  if (status === 'selected') {
    const file = originalFiles.get(id);
    if (file) {
      try {
        await db.originals.put({ photoId: id, blob: file, fileName: file.name, type: file.type });
      } catch (err) {
        if (err instanceof DOMException && err.name === 'QuotaExceededError') return { quotaError: true };
        throw err;
      }
    }
  } else {
    await db.originals.delete(id);
  }
  return { quotaError: false };
}

function quotaNotice(locale: Locale): string {
  return t(locale, 'store.quotaNotice');
}

/** Plafon de referinte faciale per persoana — reinrolarile succesive extind profilul, nu-l lasa sa creasca la nesfarsit. */
const MAX_PERSON_EMBEDDINGS = 12;

function statusLabel(locale: Locale, status: PhotoRecord['status']): string {
  return t(locale, `store.statusLabel.${status}`);
}

// index.html porneste static cu lang="ro" — sincronizam imediat cu limba
// persistata (fara asta, un utilizator care revine cu engleza deja aleasa
// ar avea temporar/permanent atributul lang gresit pana la primul setLocale).
applyLocale(readStoredLocale());

export const useStore = create<AppState>((set, get) => ({
  photos: [],
  persons: [],
  progress: null,
  filter: 'all',
  personFilter: null,
  projectFilter: null,
  setProjectFilter: project => set({ projectFilter: project }),
  projectsOpen: false,
  setProjectsOpen: open => set({ projectsOpen: open }),
  searchText: '',
  dateFrom: null,
  dateTo: null,
  minRating: 0,
  detailId: null,
  compareGroupId: null,
  personsOpen: false,
  menuOpen: false,
  insightsOpen: false,
  // implicit Workspace (lupa + filmstrip) e ecranul principal la pornire —
  // grila ramane accesibila (buton dedicat), dar nu mai e ce vede utilizatorul
  // intai; ramane fals doar daca utilizatorul comuta explicit inapoi la grila.
  workspaceMode: true,
  batchOpsOpen: false,
  paletteOpen: false,
  shortcutsOpen: false,
  theme: readStoredTheme(),
  setTheme: theme => { applyTheme(theme); set({ theme }); },
  locale: readStoredLocale(),
  setLocale: locale => { writeStoredLocale(locale); applyLocale(locale); set({ locale }); },
  projectName: readStoredProjectName(),
  setProjectName: name => { writeProjectName(name); set({ projectName: name }); },
  booted: false,
  aiDegraded: false,
  aiBackend: '',
  notice: null,
  history: [],
  multiSelectIds: new Set(),
  multiSelectAnchor: null,
  selectMode: false,
  batchHistory: [],
  economicMode: readEconomicMode(),
  setEconomicMode: on => {
    writeEconomicMode(on);
    const applyNow = analysisPool.isReady;
    const locale = get().locale;
    set({
      economicMode: on,
      notice: t(locale, on ? 'store.state.activated' : 'store.state.deactivated') +
        t(locale, applyNow ? 'store.appliesNow' : 'store.appliesNextImport')
    });
    if (applyNow) void analysisPool.resizeForEconomicMode(on);
  },
  genre: readStoredGenre(),
  setGenre: genre => { writeStoredGenre(genre); set({ genre }); },
  gridDensity: readGridDensity(),
  setGridDensity: density => { writeGridDensity(density); set({ gridDensity: density }); },
  gridSort: readGridSort(),
  setGridSort: sort => { writeGridSort(sort); set({ gridSort: sort }); },
  lastImportStats: null,
  monthlyUsage: readMonthlyUsage(),
  statsOpen: false,
  setStatsOpen: open => set({ statsOpen: open }),

  exportBackup: async () => {
    const data = await buildBackup();
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = backupFileName();
    a.click();
    // vezi exportManifest mai sus — nu revocam URL-ul imediat (Android descarca async).
    set({ notice: t(get().locale, 'store.backup.exported', { persons: data.persons.length, models: data.contextModels.length, decisions: data.photoDecisions.length }) });
  },

  importBackupFile: async (file: File) => {
    const locale = get().locale;
    try {
      const data = await parseBackupFile(file);
      const result = await restoreBackup(data);
      const [views, persons] = await Promise.all([reloadPhotoViews(), db.persons.toArray()]);
      set({
        photos: views,
        persons,
        notice: t(locale, 'store.backup.restored', { persons: result.personsRestored, models: result.modelsRestored }) +
          (result.decisionsTotal > 0
            ? t(locale, 'store.backup.restored.withDecisions', { matched: result.decisionsMatched, total: result.decisionsTotal })
            : t(locale, 'store.backup.restored.noDecisions'))
      });
    } catch (err) {
      set({ notice: t(locale, 'store.backup.restoreFailed', { error: err instanceof Error ? err.message : String(err) }) });
    }
  },

  /**
   * Galerie HTML statica pentru feedback de la client (plan 3.2.3, "Client Review") —
   * exporta doar pozele SELECTATE (acelasi domeniu ca exportSelection), cu
   * miniaturile deja generate (nu re-decodeaza originalele). Un singur fisier
   * .html, autonom, cu marcaj de favorite in browserul clientului — nu e o
   * galerie "gazduita": fotograful trebuie sa-l trimita el insusi (email, cloud propriu).
   */
  exportClientGallery: async () => {
    const locale = get().locale;
    const selected = get().photos.filter(p => p.status === 'selected');
    if (!selected.length) { set({ notice: t(locale, 'store.clientGallery.noSelection') }); return; }
    try {
      const thumbnails = await Promise.all(selected.map(p => db.thumbnails.get(p.id)));
      const items = selected
        .map((p, i) => ({ fileName: p.fileName, thumbnail: thumbnails[i]?.blob }))
        .filter((it): it is { fileName: string; thumbnail: Blob } => !!it.thumbnail);
      const title = get().projectName ? t(locale, 'store.clientGallery.title', { project: get().projectName }) : t(locale, 'store.clientGallery.titleDefault');
      const html = await buildClientGalleryHtml(items, title);
      const blob = new Blob([html], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `lumin-culler-galerie-client-${new Date().toISOString().slice(0, 10)}.html`;
      a.click();
      set({ notice: t(locale, 'store.clientGallery.generated', { count: items.length }) });
    } catch (err) {
      set({ notice: t(locale, 'store.clientGallery.failed', { error: err instanceof Error ? err.message : String(err) }) });
    }
  },

  cancelImport: () => { if (activeCancelToken) activeCancelToken.cancelled = true; },

  boot: async () => {
    if (get().booted) return;
    const [views, persons, history] = await Promise.all([
      reloadPhotoViews(),
      db.persons.toArray(),
      db.history.orderBy('ts').toArray()
    ]);
    set({ photos: views, persons, history, booted: true });
  },

  runImport: async (files: File[]) => {
    set({ progress: { done: 0, total: files.length, fileName: '', phase: 'incarcare' } });
    let warning: string | undefined;
    let done = 0;
    const startedAt = Date.now();
    const cancelToken = createCancelToken();
    activeCancelToken = cancelToken;
    try {
      await importFiles(
        files,
        progress => { warning = progress.warning; done = progress.done; set({ progress: { ...progress } }); },
        item => set(state => ({ photos: [...state.photos, toView(item.photo, item.analysis)] })),
        cancelToken,
        get().genre,
        get().projectName
      );
    } catch (err) {
      // fara asta, o promisiune respinsa (ex. retea slaba la incarcarea modelelor AI)
      // lasa bara de progres blocata la "0/N" pentru totdeauna, fara nicio eroare vizibila
      set({
        progress: null,
        notice: t(get().locale, 'store.import.failed', { error: err instanceof Error ? err.message : String(err) })
      });
      return;
    } finally {
      if (activeCancelToken === cancelToken) activeCancelToken = null;
    }
    // reincarca statusurile si groupId-urile persistate dupa gruparea seriilor
    const fresh = await db.photos.toArray();
    const byId = new Map(fresh.map(p => [p.id, p]));
    const aiDegraded = !analysisPool.isAccelerated;
    // contor informativ de utilizare lunara (plan 4.2, freemium) — vezi state/usage.ts
    // pentru de ce NU blocheaza nimic, doar informeaza la prima depasire a pragului
    const usageBefore = readMonthlyUsage();
    const monthlyUsage = recordUsage(done);
    const crossedFreeTierLimit = usageBefore < FREE_TIER_MONTHLY_LIMIT && monthlyUsage >= FREE_TIER_MONTHLY_LIMIT;
    const usageNotice = crossedFreeTierLimit
      ? t(get().locale, 'store.import.usageNotice', { count: monthlyUsage, limit: FREE_TIER_MONTHLY_LIMIT })
      : undefined;
    set(state => ({
      progress: null,
      notice: warning ?? usageNotice ?? state.notice,
      aiDegraded,
      aiBackend: analysisPool.detectedBackend,
      lastImportStats: done > 0 ? { count: done, durationMs: Date.now() - startedAt } : state.lastImportStats,
      monthlyUsage,
      photos: state.photos.map(p => {
        const rec = byId.get(p.id);
        return rec ? { ...p, status: rec.status, groupId: rec.groupId } : p;
      })
    }));
  },

  setStatus: async (id, status) => {
    const previousStatus = get().photos.find(p => p.id === id)?.status;
    await db.photos.update(id, { status });
    set(state => ({ photos: state.photos.map(p => (p.id === id ? { ...p, status } : p)) }));
    const { quotaError } = await syncOriginal(id, status);
    if (quotaError) set({ notice: quotaNotice(get().locale) });
    if (status === 'selected' || status === 'rejected') await train(id, status === 'selected');
    if (previousStatus && previousStatus !== status) {
      const event: HistoryEvent = { photoId: id, previousStatus, newStatus: status, ts: Date.now() };
      set(state => ({ history: pushHistory(state.history, event) }));
      await db.history.add(event);
      // pastram doar ultimele MAX_HISTORY si in DB, ca sa nu creasca la nesfarsit
      const all = await db.history.orderBy('ts').toArray();
      if (all.length > MAX_HISTORY) {
        await db.history.bulkDelete(all.slice(0, all.length - MAX_HISTORY).map(r => r.id!));
      }
    }
  },

  setRating: async (id, rating) => {
    const clamped = Math.max(0, Math.min(5, Math.round(rating)));
    await db.photos.update(id, { rating: clamped });
    set(state => ({ photos: state.photos.map(p => (p.id === id ? { ...p, rating: clamped } : p)) }));
  },

  /**
   * Anuleaza ultima actiune — fie o decizie manuala unica (P/X), fie o
   * operatie in masa (Auto-Cull, Respinge sub prag, Rezolva serii, actiune pe
   * selectie), oricare a fost mai recenta (dupa timestamp). Reverta DOAR
   * statusul pozei/pozelor (si sincronizarea originalului pentru export) — NU
   * incearca sa "de-antreneze" ContextEngine, care a invatat deja din acea
   * decizie: a inversa curat un pas de gradient online nu e o operatie
   * sigura, iar impactul unui singur pas e oricum mic (regularizare L2 +
   * normalizare Welford). Undo aici inseamna "arata-mi pozele ca inainte",
   * nu "sterge ce a invatat modelul".
   */
  undo: async () => {
    const { history, batchHistory, locale } = get();
    const lastSingleTs = history.length ? history[history.length - 1].ts : -1;
    const lastBatchTs = batchHistory.length ? batchHistory[batchHistory.length - 1].ts : -1;
    if (lastSingleTs === -1 && lastBatchTs === -1) { set({ notice: t(locale, 'store.undo.nothing') }); return; }

    if (lastBatchTs > lastSingleTs) {
      const { event, rest } = popBatchHistory(batchHistory);
      if (!event) return;
      set({ batchHistory: rest });
      for (const c of event.changes) {
        await db.photos.update(c.photoId, { status: c.previousStatus });
        await syncOriginal(c.photoId, c.previousStatus);
      }
      const changed = new Map(event.changes.map(c => [c.photoId, c.previousStatus]));
      set(state => ({
        photos: state.photos.map(p => (changed.has(p.id) ? { ...p, status: changed.get(p.id)! } : p))
      }));
      set({ notice: t(locale, 'store.undo.batch', { label: event.label, count: event.changes.length }) });
      return;
    }

    const { event, rest } = popHistory(history);
    if (!event) return;
    set({ history: rest });
    await db.photos.update(event.photoId, { status: event.previousStatus });
    set(state => ({
      photos: state.photos.map(p => (p.id === event.photoId ? { ...p, status: event.previousStatus } : p))
    }));
    await syncOriginal(event.photoId, event.previousStatus);
    const lastPersisted = await db.history.orderBy('ts').last();
    if (lastPersisted?.id !== undefined) await db.history.delete(lastPersisted.id);
    const fileName = get().photos.find(p => p.id === event.photoId)?.fileName ?? event.photoId;
    set({ notice: t(locale, 'store.undo.single', { fileName, status: statusLabel(locale, event.previousStatus) }) });
  },

  /** Fluxul principal de serie: pastreaza o singura poza, respinge restul grupului. */
  keepOnlyInGroup: async (groupId, keepId) => {
    const members = get().photos.filter(p => p.groupId === groupId);
    const changes = members.map(m => ({ photoId: m.id, previousStatus: m.status }));
    let quotaError = false;
    for (const m of members) {
      const status = m.id === keepId ? 'selected' : 'rejected';
      await db.photos.update(m.id, { status });
      const res = await syncOriginal(m.id, status);
      if (res.quotaError) quotaError = true;
      await train(m.id, m.id === keepId);
    }
    const locale = get().locale;
    set(state => ({
      photos: state.photos.map(p =>
        p.groupId === groupId ? { ...p, status: p.id === keepId ? 'selected' : 'rejected' } : p
      ),
      compareGroupId: null,
      batchHistory: pushBatchHistory(state.batchHistory, makeBatchEvent(t(locale, 'store.batchEvent.resolveSeries'), changes)),
      notice: quotaError ? quotaNotice(locale) : state.notice
    }));
  },

  keepManyInGroup: async (groupId, keepIds) => {
    const keepSet = new Set(keepIds);
    const members = get().photos.filter(p => p.groupId === groupId);
    const changes = members.map(m => ({ photoId: m.id, previousStatus: m.status }));
    let quotaError = false;
    for (const m of members) {
      const status = keepSet.has(m.id) ? 'selected' : 'rejected';
      await db.photos.update(m.id, { status });
      const res = await syncOriginal(m.id, status);
      if (res.quotaError) quotaError = true;
      await train(m.id, keepSet.has(m.id));
    }
    const locale = get().locale;
    set(state => ({
      photos: state.photos.map(p =>
        p.groupId === groupId ? { ...p, status: keepSet.has(p.id) ? 'selected' : 'rejected' } : p
      ),
      compareGroupId: null,
      batchHistory: pushBatchHistory(state.batchHistory, makeBatchEvent(t(locale, 'store.batchEvent.keepManyInSeries', { count: keepIds.length }), changes)),
      notice: quotaError ? quotaNotice(locale) : state.notice
    }));
  },

  selectBestPhotoInGroup: async groupId => {
    const members = get().photos.filter(p => p.groupId === groupId);
    if (!members.length) return null;
    const analyses = await Promise.all(members.map(m => db.analyses.get(m.id)));
    return pickBestInGroup(members.map((m, i) => {
      const a = analyses[i];
      return {
        id: m.id,
        sharpness: a?.sharpness ?? m.sharpness,
        exposure: a?.exposure ?? m.exposure,
        compositionScore: a?.compositionScore,
        faceCount: m.faceCount,
        bestSmile: m.bestSmile,
        groupSmileRatio: m.groupSmileRatio,
        allEyesOpen: m.allEyesOpen,
        groupEyesOpenRatio: m.groupEyesOpenRatio,
        avgEyeContact: a?.avgEyeContact
      };
    }));
  },

  /**
   * Ca si keepOnlyInGroup, actiunea are propria confirmare explicita in UI
   * (BatchOpsPanel), cu numarul exact afisat inainte de aplicare — dar acum
   * e si reversibila dintr-o data cu Ctrl+Z (batchHistory), nu doar protejata
   * de confirm() la aplicare.
   */
  bulkRejectBelow: async (threshold) => {
    const targets = selectBulkRejectTargets(get().photos, threshold);
    const changes = targets.map(p => ({ photoId: p.id, previousStatus: p.status }));
    let quotaError = false;
    for (const p of targets) {
      await db.photos.update(p.id, { status: 'rejected' });
      const res = await syncOriginal(p.id, 'rejected');
      if (res.quotaError) quotaError = true;
      await train(p.id, false);
    }
    const ids = new Set(targets.map(p => p.id));
    const locale = get().locale;
    set(state => ({
      photos: state.photos.map(p => (ids.has(p.id) ? { ...p, status: 'rejected' } : p)),
      batchHistory: pushBatchHistory(state.batchHistory, makeBatchEvent(t(locale, 'store.batchEvent.rejectBelowThreshold', { threshold }), changes)),
      notice: quotaError ? quotaNotice(locale) : t(locale, 'store.bulkReject.notice', { count: targets.length, threshold })
    }));
    return { affected: targets.length };
  },

  resolveAllSeries: async () => {
    const resolutions = resolveGroups(get().photos);
    const changes: { photoId: string; previousStatus: PhotoRecord['status'] }[] = [];
    let quotaError = false;
    for (const g of resolutions) {
      const current = get().photos.find(p => p.id === g.keepId);
      if (current?.status !== 'selected') {
        changes.push({ photoId: g.keepId, previousStatus: current?.status ?? 'pending' });
        await db.photos.update(g.keepId, { status: 'selected' });
        const res = await syncOriginal(g.keepId, 'selected');
        if (res.quotaError) quotaError = true;
        await train(g.keepId, true);
      }
      for (const rejectId of g.rejectIds) {
        const rec = get().photos.find(p => p.id === rejectId);
        if (rec?.status === 'rejected') continue; // deja rezolvat, sarim (evita re-antrenare redundanta)
        changes.push({ photoId: rejectId, previousStatus: rec?.status ?? 'pending' });
        await db.photos.update(rejectId, { status: 'rejected' });
        const res = await syncOriginal(rejectId, 'rejected');
        if (res.quotaError) quotaError = true;
        await train(rejectId, false);
      }
    }
    const keepIds = new Set(resolutions.map(g => g.keepId));
    const rejectIds = new Set(resolutions.flatMap(g => g.rejectIds));
    const locale = get().locale;
    set(state => ({
      photos: state.photos.map(p => {
        if (keepIds.has(p.id)) return { ...p, status: 'selected' };
        if (rejectIds.has(p.id)) return { ...p, status: 'rejected' };
        return p;
      }),
      batchHistory: pushBatchHistory(state.batchHistory, makeBatchEvent(t(locale, 'store.batchEvent.resolveAllSeries'), changes)),
      notice: quotaError ? quotaNotice(locale) : t(locale, 'store.resolveSeries.notice', { count: resolutions.length })
    }));
    return { groupsResolved: resolutions.length };
  },

  /** Ca si celelalte operatii in masa — reversibila dintr-o data cu Ctrl+Z (batchHistory). */
  autoCullTopPercent: async (percent) => {
    const { selectIds, rejectIds } = selectTopPercent(get().photos, percent);
    const byId = new Map(get().photos.map(p => [p.id, p.status]));
    const changes = [...selectIds, ...rejectIds].map(id => ({ photoId: id, previousStatus: byId.get(id) ?? 'pending' as PhotoRecord['status'] }));
    let quotaError = false;
    for (const id of selectIds) {
      await db.photos.update(id, { status: 'selected' });
      const res = await syncOriginal(id, 'selected');
      if (res.quotaError) quotaError = true;
      await train(id, true);
    }
    for (const id of rejectIds) {
      await db.photos.update(id, { status: 'rejected' });
      const res = await syncOriginal(id, 'rejected');
      if (res.quotaError) quotaError = true;
      await train(id, false);
    }
    const selectSet = new Set(selectIds);
    const rejectSet = new Set(rejectIds);
    const locale = get().locale;
    set(state => ({
      batchHistory: pushBatchHistory(state.batchHistory, makeBatchEvent(t(locale, 'store.batchEvent.autoCull', { percent }), changes)),
      photos: state.photos.map(p => {
        if (selectSet.has(p.id)) return { ...p, status: 'selected' };
        if (rejectSet.has(p.id)) return { ...p, status: 'rejected' };
        return p;
      }),
      notice: quotaError ? quotaNotice(locale) : t(locale, 'store.autoCull.notice', { selected: selectIds.length, rejected: rejectIds.length })
    }));
    return { selected: selectIds.length, rejected: rejectIds.length };
  },

  toggleMultiSelect: id => set(state => {
    const next = new Set(state.multiSelectIds);
    if (next.has(id)) next.delete(id); else next.add(id);
    return { multiSelectIds: next, multiSelectAnchor: id };
  }),

  rangeMultiSelect: (id, orderedIds) => set(state => {
    const anchor = state.multiSelectAnchor;
    const next = new Set(state.multiSelectIds);
    if (!anchor) { next.add(id); return { multiSelectIds: next, multiSelectAnchor: id }; }
    const from = orderedIds.indexOf(anchor);
    const to = orderedIds.indexOf(id);
    if (from === -1 || to === -1) { next.add(id); return { multiSelectIds: next, multiSelectAnchor: id }; }
    const [start, end] = from <= to ? [from, to] : [to, from];
    for (let i = start; i <= end; i++) next.add(orderedIds[i]);
    return { multiSelectIds: next, multiSelectAnchor: id };
  }),

  setMultiSelected: (id, on) => set(state => {
    if (state.multiSelectIds.has(id) === on) return {}; // deja in starea ceruta — evitam un re-render inutil in timpul drag-ului
    const next = new Set(state.multiSelectIds);
    if (on) next.add(id); else next.delete(id);
    return { multiSelectIds: next, multiSelectAnchor: id };
  }),

  clearMultiSelect: () => set({ multiSelectIds: new Set(), multiSelectAnchor: null }),
  setSelectMode: on => set(state => ({
    selectMode: on,
    // la iesire din mod, golim si selectia — la intrare, pornim de la zero
    multiSelectIds: on ? state.multiSelectIds : new Set(),
    multiSelectAnchor: on ? state.multiSelectAnchor : null
  })),

  /** Ca si celelalte operatii in masa — reversibila dintr-o data cu Ctrl+Z (batchHistory). */
  bulkSetStatusForSelection: async status => {
    const ids = Array.from(get().multiSelectIds);
    if (!ids.length) return;
    const byId = new Map(get().photos.map(p => [p.id, p.status]));
    const changes = ids.map(id => ({ photoId: id, previousStatus: byId.get(id) ?? 'pending' as PhotoRecord['status'] }));
    let quotaError = false;
    for (const id of ids) {
      await db.photos.update(id, { status });
      const res = await syncOriginal(id, status);
      if (res.quotaError) quotaError = true;
      if (status === 'selected' || status === 'rejected') await train(id, status === 'selected');
    }
    const idSet = new Set(ids);
    const locale = get().locale;
    set(state => ({
      photos: state.photos.map(p => (idSet.has(p.id) ? { ...p, status } : p)),
      multiSelectIds: new Set(),
      multiSelectAnchor: null,
      batchHistory: pushBatchHistory(state.batchHistory, makeBatchEvent(t(locale, 'store.batchEvent.bulkAction', { status: statusLabel(locale, status) }), changes)),
      notice: quotaError ? quotaNotice(locale) : t(locale, 'store.bulkStatus.notice', { count: ids.length, status: statusLabel(locale, status) })
    }));
  },

  bulkSetRatingForSelection: async rating => {
    const ids = Array.from(get().multiSelectIds);
    if (!ids.length) return;
    const clamped = Math.max(0, Math.min(5, Math.round(rating)));
    for (const id of ids) await db.photos.update(id, { rating: clamped });
    const idSet = new Set(ids);
    const locale = get().locale;
    set(state => ({
      photos: state.photos.map(p => (idSet.has(p.id) ? { ...p, rating: clamped } : p)),
      multiSelectIds: new Set(),
      multiSelectAnchor: null,
      notice: t(locale, 'store.bulkRating.notice', {
        count: ids.length,
        rating: clamped > 0 ? t(locale, 'store.bulkRating.stars', { n: clamped }) : t(locale, 'store.bulkRating.cleared')
      })
    }));
  },

  setFilter: f => set({ filter: f }),
  setPersonFilter: name => set({ personFilter: name }),
  setSearchText: text => set({ searchText: text }),
  setDateRange: (from, to) => set({ dateFrom: from, dateTo: to }),
  setMinRating: rating => set({ minRating: rating }),
  clearAdvancedFilters: () => set({ searchText: '', dateFrom: null, dateTo: null, minRating: 0 }),
  openDetail: id => set({ detailId: id }),
  openCompare: groupId => set({ compareGroupId: groupId }),

  stepDetail: dir => {
    const { detailId } = get();
    const list = get().filtered();
    if (!detailId || !list.length) return;
    const idx = list.findIndex(p => p.id === detailId);
    const next = list[(idx + dir + list.length) % list.length];
    set({ detailId: next.id });
  },

  /**
   * Daca exista deja o persoana cu acelasi nume, adauga noile referinte la ea
   * (nu creeaza un duplicat) — esential pentru subiecti a caror fata se
   * schimba vizibil in timp (ex. un copil mic): reinrolarea periodica, cu
   * poze recente, extinde profilul in loc sa-l inlocuiasca sau sa-l fragmenteze
   * in mai multe "persoane" separate cu acelasi nume.
   */
  addPerson: async (name, files) => {
    await analysisPool.init();
    const embeddings: number[][] = [];
    for (const file of files.slice(0, 4)) {
      try {
        const bitmap = await createImageBitmap(file, { resizeWidth: 1024 } as ImageBitmapOptions);
        const emb = await analysisPool.computeEnrollmentEmbedding(bitmap);
        if (emb && emb.length) embeddings.push(emb);
      } catch (err) {
        console.error('Inrolare esuata:', err);
      }
    }
    if (!embeddings.length) {
      return { ok: false, message: 'Nicio fata detectata in pozele de referinta. Alege poze clare, frontale.' };
    }
    const trimmedName = name.trim();
    const existing = get().persons.find(p => p.name.trim().toLowerCase() === trimmedName.toLowerCase());
    let person: KnownPerson;
    let message: string;
    if (existing) {
      // pastram doar cele mai RECENTE MAX_PERSON_EMBEDDINGS referinte — trasaturile
      // vechi de acum multe luni conteaza mai putin decat cele actuale la recunoastere
      const merged = [...existing.embeddings, ...embeddings].slice(-MAX_PERSON_EMBEDDINGS);
      person = { ...existing, embeddings: merged, updatedAt: Date.now() };
      message = `${trimmedName}: +${embeddings.length} referinte noi adaugate la profilul existent (total ${merged.length}).`;
    } else {
      person = { id: crypto.randomUUID(), name: trimmedName, embeddings, updatedAt: Date.now() };
      message = trimmedName + ': ' + embeddings.length + ' referinte salvate.';
    }
    await db.persons.put(person);
    const persons = await db.persons.toArray();
    await analysisPool.setKnownPersons(persons);
    set({ persons });
    return { ok: true, message };
  },

  removePerson: async id => {
    await db.persons.delete(id);
    const persons = await db.persons.toArray();
    await analysisPool.setKnownPersons(persons).catch(() => {});
    set({ persons });
  },

  removePersons: async ids => {
    if (!ids.length) return;
    await db.persons.bulkDelete(ids);
    const persons = await db.persons.toArray();
    await analysisPool.setKnownPersons(persons).catch(() => {});
    set({ persons });
  },

  mergePersons: async (ids, keepName) => {
    const toMerge = get().persons.filter(p => ids.includes(p.id));
    if (toMerge.length < 2) return;
    // pastram cele mai RECENTE MAX_PERSON_EMBEDDINGS referinte din toate profilurile unite
    // (acelasi plafon ca la reinrolare normala, addPerson) — identitatea (id) supravietuitoare
    // e a primului profil, ca referintele externe (daca ar exista vreodata) sa nu se piarda
    const merged = toMerge.flatMap(p => p.embeddings).slice(-MAX_PERSON_EMBEDDINGS);
    const survivor: KnownPerson = { id: toMerge[0].id, name: keepName.trim() || toMerge[0].name, embeddings: merged, updatedAt: Date.now() };
    await db.persons.put(survivor);
    await db.persons.bulkDelete(toMerge.slice(1).map(p => p.id));
    const persons = await db.persons.toArray();
    await analysisPool.setKnownPersons(persons).catch(() => {});
    set({ persons });
  },

  exportPersonProfiles: async ids => {
    const selected = get().persons.filter(p => ids.includes(p.id));
    if (!selected.length) return;
    const data = buildPersonProfilesExport(selected);
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = personProfilesFileName(selected);
    a.click();
    const locale = get().locale;
    set({ notice: t(locale, plural(selected.length, 'store.personProfiles.exported.one', 'store.personProfiles.exported.other'), { count: selected.length }) });
  },

  importPersonProfiles: async file => {
    const locale = get().locale;
    try {
      const data = await parsePersonProfilesFile(file);
      let added = 0, merged = 0;
      for (const incoming of data.persons) {
        const existing = get().persons.find(p => p.name.trim().toLowerCase() === incoming.name.trim().toLowerCase());
        if (existing) {
          const combined = [...existing.embeddings, ...incoming.embeddings].slice(-MAX_PERSON_EMBEDDINGS);
          await db.persons.put({ ...existing, embeddings: combined, updatedAt: Date.now() });
          merged++;
        } else {
          await db.persons.put({ id: crypto.randomUUID(), name: incoming.name, embeddings: incoming.embeddings, updatedAt: Date.now() });
          added++;
        }
      }
      const persons = await db.persons.toArray();
      await analysisPool.setKnownPersons(persons).catch(() => {});
      set({ persons, notice: t(locale, 'store.personProfiles.imported', { added, merged }) });
    } catch (err) {
      set({ notice: t(locale, 'store.personProfiles.importFailed', { error: err instanceof Error ? err.message : String(err) }) });
    }
  },

  enrollFaceCluster: async (name, members) => {
    const trimmedName = name.trim();
    if (!trimmedName || !members.length) return;
    const newEmbeddings = members.map(m => m.embedding);
    const existing = get().persons.find(p => p.name.trim().toLowerCase() === trimmedName.toLowerCase());
    const person: KnownPerson = existing
      ? { ...existing, embeddings: [...existing.embeddings, ...newEmbeddings].slice(-MAX_PERSON_EMBEDDINGS), updatedAt: Date.now() }
      : { id: crypto.randomUUID(), name: trimmedName, embeddings: newEmbeddings.slice(-MAX_PERSON_EMBEDDINGS), updatedAt: Date.now() };
    await db.persons.put(person);

    // re-eticheteaza RETROACTIV exact fetele din cluster (identificate prin
    // faceIndex, stabil - nu prin embedding, care s-ar putea sa nu compare
    // egal ca referinta intre interogari separate) in analizele deja
    // existente. NU recalculam scorul AI/statusul deja decis pentru aceste
    // poze (ar necesita re-rularea ContextEngine si ar putea schimba decizii
    // deja luate de utilizator) — doar identificarea (nume/numar cunoscuti),
    // care conteaza pentru afisare si export.
    const photoIds = Array.from(new Set(members.map(m => m.photoId)));
    const analyses = await db.analyses.bulkGet(photoIds);
    for (let i = 0; i < photoIds.length; i++) {
      const analysis = analyses[i];
      if (!analysis) continue;
      const faceIndexes = members.filter(m => m.photoId === photoIds[i]).map(m => m.faceIndex);
      let changed = false;
      for (const idx of faceIndexes) {
        const face = analysis.faces[idx];
        if (face && !face.personId) {
          face.personId = person.id;
          face.personName = person.name;
          changed = true;
        }
      }
      if (changed) {
        analysis.knownFaceCount = analysis.faces.filter(f => f.personId).length;
        analysis.strangerCount = analysis.faces.filter(f => !f.personId).length;
        await db.analyses.put(analysis);
      }
    }

    const persons = await db.persons.toArray();
    await analysisPool.setKnownPersons(persons).catch(() => {});
    const views = await reloadPhotoViews();
    set({
      persons, photos: views,
      notice: t(get().locale, 'store.faceCluster.enrolled', { name: trimmedName, detections: members.length, photos: photoIds.length })
    });
  },

  setPersonsOpen: open => set({ personsOpen: open }),
  setMenuOpen: open => set({ menuOpen: open }),
  setInsightsOpen: open => set({ insightsOpen: open }),
  setWorkspaceMode: on => set({ workspaceMode: on, detailId: on ? get().detailId : null }),
  setBatchOpsOpen: open => set({ batchOpsOpen: open }),
  setPaletteOpen: open => set({ paletteOpen: open }),
  setShortcutsOpen: open => set({ shortcutsOpen: open }),
  clearNotice: () => set({ notice: null }),

  clearAll: async () => {
    await Promise.all([
      db.photos.clear(), db.thumbnails.clear(), db.previews.clear(), db.originals.clear(),
      db.analyses.clear(), db.history.clear()
    ]);
    originalFiles.clear();
    set({ photos: [], detailId: null, compareGroupId: null, history: [] });
  },

  clearAllIncludingPersons: async () => {
    await Promise.all([
      db.photos.clear(), db.thumbnails.clear(), db.previews.clear(), db.originals.clear(),
      db.analyses.clear(), db.history.clear(),
      db.persons.clear(), db.corrections.clear(),
      contextEngine.reset()
    ]);
    originalFiles.clear();
    await analysisPool.setKnownPersons([]).catch(() => {});
    set({ photos: [], persons: [], detailId: null, compareGroupId: null, history: [], batchHistory: [] });
  },

  /** Exporta pozele selectate ca fisiere reale, in formatul original (JPEG/PNG/etc), grupate pe subfoldere. */
  exportSelection: async () => {
    const allPhotos = get().photos;
    const selected = allPhotos.filter(p => p.status === 'selected');
    if (!selected.length) return;
    try {
      // vezi computeGroupPersonUnion: un cadru dintr-un burst poate rata o
      // fata pe care alt cadru din ACEEASI serie a recunoscut-o clar —
      // unim persoanele recunoscute pe toata seria, ca folderul de export
      // sa reflecte cine e cu-adevarat in poza, nu doar ce a prins acel cadru.
      const groupUnion = computeGroupPersonUnion(allPhotos);
      const result = await exportOriginalFiles(selected.map(p => ({
        id: p.id,
        fileName: p.fileName,
        personNames: p.groupId ? (groupUnion.get(p.groupId) ?? p.personNames) : p.personNames,
        faceCount: p.faceCount,
        strangerCount: p.strangerCount,
        sceneType: p.sceneType
      })));
      if (result.cancelled) return;
      const locale = get().locale;
      const parts = [
        result.exported
          ? t(locale,
              result.method === 'folder' ? 'store.exportSelection.exportedFolder'
              : result.grouped ? 'store.exportSelection.exportedZip'
              : 'store.exportSelection.exportedDirect',
              { count: result.exported }
            )
          : t(locale, 'store.exportSelection.none')
      ];
      if (result.missing.length) {
        parts.push(t(locale, 'store.exportSelection.missing', { count: result.missing.length }));
      }
      set({ notice: parts.join(' ') });
    } catch (err) {
      set({ notice: t(get().locale, 'store.exportSelection.failed', { error: String(err) }) });
    }
  },

  /** Lista JSON cu numele fisierelor selectate — util pentru selectie-dupa-nume in Lightroom. */
  exportManifest: async () => {
    const selected = get().photos.filter(p => p.status === 'selected');
    const payload = {
      exportedAt: new Date().toISOString(),
      count: selected.length,
      files: selected.map(p => p.fileName)
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'selectie-lumin-' + new Date().toISOString().slice(0, 10) + '.json';
    a.click();
    // NU revocam imediat — pe Android managerul de descarcari citeste blob:
    // URL-ul asincron, in fundal; o revocare instant poate rupe transferul
    // cu "Eroare de retea" (bug real gasit la exportul de poze/XMP, acelasi
    // tipar). Lasam browserul sa curete URL-ul natural la reincarcare.
  },

  /**
   * Exporta sidecar-uri XMP (rating + eticheta de culoare) pentru TOATE pozele
   * decise (selectate/respinse/de verificat) — nu doar selectia, spre deosebire
   * de exportSelection. Nu copiaza nicio poza: fisierele .xmp trebuie asezate
   * langa originalele deja existente pe disc (acelasi nume, alta extensie) ca
   * Lightroom/Bridge sa le asocieze automat.
   */
  exportXMP: async () => {
    const allPhotos = get().photos;
    const decided = allPhotos.filter(p => p.status !== 'pending');
    const locale = get().locale;
    if (!decided.length) { set({ notice: t(locale, 'store.exportXmp.noDecided') }); return; }
    try {
      // vezi computeGroupPersonUnion (exportPhotos.ts) — acelasi principiu ca la
      // exportSelection: un cadru din burst poate rata o fata pe care alt cadru
      // din aceeasi serie a recunoscut-o clar; unim persoanele pe toata seria.
      const groupUnion = computeGroupPersonUnion(allPhotos);
      const result = await exportXMPSidecars(decided.map(p => {
        const meta = p.project ? getProjectMetadata(p.project) : {};
        const personNames = p.groupId ? (groupUnion.get(p.groupId) ?? p.personNames) : p.personNames;
        return {
          fileName: p.fileName,
          status: p.status,
          rating: p.rating,
          keywords: [
            ...deriveXmpKeywords(personNames, p.sceneSemantic, p.sceneTags),
            deriveAiScoreKeyword(p.aiScore),
            ...(p.groupId ? [deriveSeriesKeyword(p.groupId)] : []),
            ...(meta.client ? [t(locale, 'store.xmpKeyword.client', { value: meta.client })] : []),
            ...(meta.event ? [t(locale, 'store.xmpKeyword.event', { value: meta.event })] : []),
            ...(meta.location ? [t(locale, 'store.xmpKeyword.location', { value: meta.location })] : [])
          ],
          aiScore: p.aiScore,
          aiFactors: explainFactors(p.aiFactors).map(f => `${f.label} (${f.positive ? '+' : '-'})`),
          groupId: p.groupId,
          client: meta.client,
          event: meta.event,
          location: meta.location
        };
      }));
      if (result.cancelled) return;
      const msg = result.exported
        ? t(locale,
            result.method === 'folder' ? 'store.exportXmp.exportedFolder'
              : result.exported === 1 ? 'store.exportXmp.exportedSingle'
              : 'store.exportXmp.exportedZip',
            { count: result.exported }
          )
        : t(locale, 'store.exportXmp.none');
      set({ notice: msg });
    } catch (err) {
      set({ notice: t(locale, 'store.exportXmp.failed', { error: String(err) }) });
    }
  },

  filtered: () => {
    const { photos, filter, personFilter, projectFilter, searchText, dateFrom, dateTo, minRating, gridSort } = get();
    let base: PhotoView[];
    switch (filter) {
      case 'selected': base = photos.filter(p => p.status === 'selected'); break;
      case 'review': base = photos.filter(p => p.status === 'review'); break;
      case 'rejected': base = photos.filter(p => p.status === 'rejected'); break;
      case 'blinks': base = photos.filter(p => p.faceCount > 0 && !p.allEyesOpen); break;
      case 'goldenHour': base = photos.filter(p => p.goldenHourDetected); break;
      case 'series': {
        const withGroup = photos.filter(p => p.groupId);
        base = withGroup.sort((a, b) =>
          a.groupId === b.groupId ? b.aiScore - a.aiScore : (a.groupId! < b.groupId! ? -1 : 1)
        );
        break;
      }
      default: base = photos;
    }
    // filtru dupa persoana cunoscuta — combinabil cu orice alt filtru de mai sus
    // (ex. "Selectate" + "Ami" = pozele selectate in care apare Ami), nu un
    // FilterKey fix (persoanele sunt dinamice, inrolate de utilizator)
    if (personFilter) base = base.filter(p => p.personNames.includes(personFilter));
    // filtru dupa proiect — vezi ProjectsPanel (fara proiect ales = grupul "Fara proiect")
    if (projectFilter) {
      base = projectFilter === NO_PROJECT_KEY
        ? base.filter(p => !p.project)
        : base.filter(p => p.project === projectFilter);
    }
    // cautare text dupa numele fisierului — utila la biblioteci mari, unde
    // stii deja (partial) cum se numeste poza cautata
    const q = searchText.trim().toLowerCase();
    if (q) base = base.filter(p => p.fileName.toLowerCase().includes(q));
    // interval de data (capturedAt) — poze fara data cunoscuta sunt excluse
    // doar daca s-a cerut explicit un capat de interval (altfel raman vizibile)
    if (dateFrom !== null) base = base.filter(p => (p.capturedAt ?? 0) >= dateFrom);
    if (dateTo !== null) base = base.filter(p => (p.capturedAt ?? 0) <= dateTo);
    // rating minim — 0 = fara filtru
    if (minRating > 0) base = base.filter(p => p.rating >= minRating);
    // sortarea utilizatorului (plan 3.2.1) — filtrul "Serii" isi pastreaza propria
    // ordine (grupate, cea mai buna din fiecare serie prima), altfel gruparea vizuala s-ar sparge
    if (filter !== 'series') {
      base = [...base].sort((a, b) => {
        const cmp = compareBy(gridSort.key, a, b);
        return gridSort.dir === 'asc' ? cmp : -cmp;
      });
    }
    return base;
  },

  groupOf: groupId =>
    get().photos.filter(p => p.groupId === groupId).sort((a, b) => b.aiScore - a.aiScore)
}));
