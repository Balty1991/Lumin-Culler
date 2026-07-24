/**
 * state/store.ts
 * Managementul starii (Zustand) — separat de UI. Include fluxul de comparare
 * a seriilor: alegi cea mai buna poza dintr-un grup de cadre similare.
 */
import { create } from 'zustand';
import { db, type AnalysisRecord, type PhotoRecord, type KnownPerson } from '../core/db';
import { importFiles, originalFiles, createCancelToken, type ImportProgress, type ImportCancelToken } from '../core/importPipeline';
import { readEconomicMode, writeEconomicMode } from '../core/performanceSettings';
import { exportOriginalFiles } from '../core/exportPhotos';
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
import { buildBackup, backupFileName, parseBackupFile, restoreBackup } from '../core/backupService';

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
  aiFactors: { feature: string; contribution: number }[];
  personNames: string[];
  groupId?: string;
  capturedAt?: number;
  /** Genul fotografic activ la import ("Nunta", "Portret", ...) — vezi state/genre.ts si ContextEngine.deriveContextKey. */
  genre?: string;
  goldenHourDetected?: boolean;
  dominantColors?: string[];
  /** Eticheta compusa scena+varsta (ex. "portrait_child") — folosita ca sursa de keywords la exportul XMP. */
  sceneSemantic?: string;
  /** Etichete generale de obiect/scena (COCO-80, ex. "dog", "cake", "boat") — vezi AnalysisRecord.sceneTags. */
  sceneTags?: string[];
}

export type FilterKey = 'all' | 'selected' | 'review' | 'rejected' | 'series' | 'blinks';

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
  /** Exporta persoanele cunoscute + modelele AI invatate (fara imagini) intr-un fisier JSON de backup. */
  exportBackup: () => Promise<void>;
  /** Restaureaza un backup: persoane + modele AI, plus reaplicarea deciziilor (status/rating) pe pozele curente care se potrivesc (nume fisier + data capturii). */
  importBackupFile: (file: File) => Promise<void>;
  filter: FilterKey;
  /** Filtru suplimentar, combinabil cu `filter` — numele unei persoane cunoscute, sau null (fara filtru). */
  personFilter: string | null;
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
  filtered: () => PhotoView[];
  groupOf: (groupId: string) => PhotoView[];
}

/** Token-ul importului CURENT (daca vreunul ruleaza) — traieste in afara Zustand
    fiindca nu are sens sa fie parte din snapshot-ul de stare serializabil. */
let activeCancelToken: ImportCancelToken | null = null;

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
    aiFactors: analysis?.aiFactors ?? [],
    personNames: analysis
      ? Array.from(new Set(analysis.faces.map(f => f.personName).filter((n): n is string => !!n)))
      : [],
    groupId: photo.groupId,
    capturedAt: photo.capturedAt,
    genre: photo.genre,
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

const QUOTA_NOTICE = 'Spatiu de stocare plin — fotografia a fost marcata, dar originalul nu a putut fi ' +
  'salvat pentru export. Elibereaza spatiu (Goleste sesiunea sau exporta ce ai deja) si reincearca.';

/** Plafon de referinte faciale per persoana — reinrolarile succesive extind profilul, nu-l lasa sa creasca la nesfarsit. */
const MAX_PERSON_EMBEDDINGS = 12;

const STATUS_LABELS: Record<PhotoRecord['status'], string> = {
  pending: 'în așteptare',
  selected: 'selectată',
  rejected: 'respinsă',
  review: 'de verificat'
};

export const useStore = create<AppState>((set, get) => ({
  photos: [],
  persons: [],
  progress: null,
  filter: 'all',
  personFilter: null,
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
    set({
      economicMode: on,
      notice: 'Modul economic ' + (on ? 'activat' : 'dezactivat') +
        (applyNow ? ' — se aplica imediat.' : ' — se aplica de la urmatorul import.')
    });
    if (applyNow) void analysisPool.resizeForEconomicMode(on);
  },
  genre: readStoredGenre(),
  setGenre: genre => { writeStoredGenre(genre); set({ genre }); },
  gridDensity: readGridDensity(),
  setGridDensity: density => { writeGridDensity(density); set({ gridDensity: density }); },

  exportBackup: async () => {
    const data = await buildBackup();
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = backupFileName();
    a.click();
    // vezi exportManifest mai sus — nu revocam URL-ul imediat (Android descarca async).
    set({ notice: `Backup exportat: ${data.persons.length} persoane, ${data.contextModels.length} profiluri AI invatate, ${data.photoDecisions.length} decizii.` });
  },

  importBackupFile: async (file: File) => {
    try {
      const data = await parseBackupFile(file);
      const result = await restoreBackup(data);
      const [views, persons] = await Promise.all([reloadPhotoViews(), db.persons.toArray()]);
      set({
        photos: views,
        persons,
        notice: `Backup restaurat: ${result.personsRestored} persoane, ${result.modelsRestored} profiluri AI` +
          (result.decisionsTotal > 0 ? `, ${result.decisionsMatched}/${result.decisionsTotal} decizii potrivite cu pozele curente.` : '.')
      });
    } catch (err) {
      set({ notice: 'Restaurare backup esuata: ' + (err instanceof Error ? err.message : String(err)) });
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
    const cancelToken = createCancelToken();
    activeCancelToken = cancelToken;
    try {
      await importFiles(
        files,
        progress => { warning = progress.warning; set({ progress: { ...progress } }); },
        item => set(state => ({ photos: [...state.photos, toView(item.photo, item.analysis)] })),
        cancelToken,
        get().genre
      );
    } catch (err) {
      // fara asta, o promisiune respinsa (ex. retea slaba la incarcarea modelelor AI)
      // lasa bara de progres blocata la "0/N" pentru totdeauna, fara nicio eroare vizibila
      set({
        progress: null,
        notice: 'Import esuat: ' + (err instanceof Error ? err.message : String(err)) + ' — incearca din nou.'
      });
      return;
    } finally {
      if (activeCancelToken === cancelToken) activeCancelToken = null;
    }
    // reincarca statusurile si groupId-urile persistate dupa gruparea seriilor
    const fresh = await db.photos.toArray();
    const byId = new Map(fresh.map(p => [p.id, p]));
    const aiDegraded = !analysisPool.isAccelerated;
    set(state => ({
      progress: null,
      notice: warning ?? state.notice,
      aiDegraded,
      aiBackend: analysisPool.detectedBackend,
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
    if (quotaError) set({ notice: QUOTA_NOTICE });
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
    const { history, batchHistory } = get();
    const lastSingleTs = history.length ? history[history.length - 1].ts : -1;
    const lastBatchTs = batchHistory.length ? batchHistory[batchHistory.length - 1].ts : -1;
    if (lastSingleTs === -1 && lastBatchTs === -1) { set({ notice: 'Nimic de anulat.' }); return; }

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
      set({ notice: `Anulat: „${event.label}" (${event.changes.length} poze).` });
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
    set({ notice: `Anulat: "${fileName}" înapoi la ${STATUS_LABELS[event.previousStatus]}.` });
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
    set(state => ({
      photos: state.photos.map(p =>
        p.groupId === groupId ? { ...p, status: p.id === keepId ? 'selected' : 'rejected' } : p
      ),
      compareGroupId: null,
      batchHistory: pushBatchHistory(state.batchHistory, makeBatchEvent('Rezolva serie', changes)),
      notice: quotaError ? QUOTA_NOTICE : state.notice
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
    set(state => ({
      photos: state.photos.map(p =>
        p.groupId === groupId ? { ...p, status: keepSet.has(p.id) ? 'selected' : 'rejected' } : p
      ),
      compareGroupId: null,
      batchHistory: pushBatchHistory(state.batchHistory, makeBatchEvent(`Pastreaza ${keepIds.length} din serie`, changes)),
      notice: quotaError ? QUOTA_NOTICE : state.notice
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
    set(state => ({
      photos: state.photos.map(p => (ids.has(p.id) ? { ...p, status: 'rejected' } : p)),
      batchHistory: pushBatchHistory(state.batchHistory, makeBatchEvent(`Respinge sub prag (${threshold})`, changes)),
      notice: quotaError ? QUOTA_NOTICE : `${targets.length} poze respinse (scor sub ${threshold}).`
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
    set(state => ({
      photos: state.photos.map(p => {
        if (keepIds.has(p.id)) return { ...p, status: 'selected' };
        if (rejectIds.has(p.id)) return { ...p, status: 'rejected' };
        return p;
      }),
      batchHistory: pushBatchHistory(state.batchHistory, makeBatchEvent('Rezolva toate seriile', changes)),
      notice: quotaError ? QUOTA_NOTICE : `${resolutions.length} serii rezolvate.`
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
    set(state => ({
      batchHistory: pushBatchHistory(state.batchHistory, makeBatchEvent(`Auto-Cull (${percent}%)`, changes)),
      photos: state.photos.map(p => {
        if (selectSet.has(p.id)) return { ...p, status: 'selected' };
        if (rejectSet.has(p.id)) return { ...p, status: 'rejected' };
        return p;
      }),
      notice: quotaError ? QUOTA_NOTICE : `Auto-Cull: ${selectIds.length} selectate, ${rejectIds.length} respinse.`
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
    set(state => ({
      photos: state.photos.map(p => (idSet.has(p.id) ? { ...p, status } : p)),
      multiSelectIds: new Set(),
      multiSelectAnchor: null,
      batchHistory: pushBatchHistory(state.batchHistory, makeBatchEvent(`Actiune in masa: ${STATUS_LABELS[status]}`, changes)),
      notice: quotaError ? QUOTA_NOTICE : `${ids.length} poze ${STATUS_LABELS[status]}.`
    }));
  },

  bulkSetRatingForSelection: async rating => {
    const ids = Array.from(get().multiSelectIds);
    if (!ids.length) return;
    const clamped = Math.max(0, Math.min(5, Math.round(rating)));
    for (const id of ids) await db.photos.update(id, { rating: clamped });
    const idSet = new Set(ids);
    set(state => ({
      photos: state.photos.map(p => (idSet.has(p.id) ? { ...p, rating: clamped } : p)),
      multiSelectIds: new Set(),
      multiSelectAnchor: null,
      notice: `${ids.length} poze cu rating ${clamped > 0 ? clamped + ' stele' : 'sters'}.`
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
    const selected = get().photos.filter(p => p.status === 'selected');
    if (!selected.length) return;
    try {
      const result = await exportOriginalFiles(selected.map(p => ({
        id: p.id,
        fileName: p.fileName,
        personNames: p.personNames,
        faceCount: p.faceCount,
        strangerCount: p.strangerCount,
        sceneType: p.sceneType
      })));
      if (result.cancelled) return;
      const parts = [
        result.exported
          ? `${result.exported} poze exportate` + (
              result.method === 'folder' ? ' in subfoldere (persoane/scenă), în folderul ales.'
              : result.grouped ? ' intr-o arhiva .zip (subfoldere pe persoane/scenă) — descarcarile multiple separate sunt blocate de multe browsere mobile, o singura arhiva e mereu de incredere.'
              : ' (descărcare directă).'
            )
          : 'Nicio poza nu a putut fi exportata in format original.'
      ];
      if (result.missing.length) {
        parts.push(`${result.missing.length} nu mai erau disponibile (importate inainte de ultima actualizare) — reimporta-le pentru export.`);
      }
      set({ notice: parts.join(' ') });
    } catch (err) {
      set({ notice: 'Export esuat: ' + String(err) });
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
    const decided = get().photos.filter(p => p.status !== 'pending');
    if (!decided.length) { set({ notice: 'Nicio poza cu decizie luata inca — Selecteaza/Respinge cel putin una.' }); return; }
    try {
      const result = await exportXMPSidecars(decided.map(p => ({
        fileName: p.fileName,
        status: p.status,
        rating: p.rating,
        keywords: [
          ...deriveXmpKeywords(p.personNames, p.sceneSemantic, p.sceneTags),
          deriveAiScoreKeyword(p.aiScore),
          ...(p.groupId ? [deriveSeriesKeyword(p.groupId)] : [])
        ],
        aiScore: p.aiScore,
        aiFactors: explainFactors(p.aiFactors).map(f => `${f.label} (${f.positive ? '+' : '-'})`),
        groupId: p.groupId
      })));
      if (result.cancelled) return;
      const msg = result.exported
        ? `${result.exported} sidecar-uri XMP exportate` + (
            result.method === 'folder'
              ? ' in folderul ales — copiaza-le langa pozele ORIGINALE (structura de foldere de la import, nu cea grupata pe persoane/scena a exportului de poze) ca Lightroom sa le vada.'
              : result.exported === 1
                ? ' (descarcare directa) — muta-l langa poza ORIGINALA ca Lightroom sa il vada.'
                : ' intr-o arhiva .zip — dezarhiveaza-le si muta-le langa pozele ORIGINALE (nu intr-un folder grupat pe persoane/scena) ca Lightroom sa le vada.'
          )
        : 'Niciun sidecar XMP nu a putut fi exportat.';
      set({ notice: msg });
    } catch (err) {
      set({ notice: 'Export XMP esuat: ' + String(err) });
    }
  },

  filtered: () => {
    const { photos, filter, personFilter, searchText, dateFrom, dateTo, minRating } = get();
    let base: PhotoView[];
    switch (filter) {
      case 'selected': base = photos.filter(p => p.status === 'selected'); break;
      case 'review': base = photos.filter(p => p.status === 'review'); break;
      case 'rejected': base = photos.filter(p => p.status === 'rejected'); break;
      case 'blinks': base = photos.filter(p => p.faceCount > 0 && !p.allEyesOpen); break;
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
    return base;
  },

  groupOf: groupId =>
    get().photos.filter(p => p.groupId === groupId).sort((a, b) => b.aiScore - a.aiScore)
}));
