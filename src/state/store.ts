/**
 * state/store.ts
 * Managementul starii (Zustand) — separat de UI. Include fluxul de comparare
 * a seriilor: alegi cea mai buna poza dintr-un grup de cadre similare.
 */
import { create } from 'zustand';
import { db, type AnalysisRecord, type PhotoRecord, type KnownPerson, type ColorLabel, type CollectionRecord } from '../core/db';
import {
  loadCollections, createCollection as createCollectionRecord, renameCollection as renameCollectionRecord,
  deleteCollection as deleteCollectionRecord, addPhotosToCollection as addPhotosToCollectionRecord,
  removePhotosFromCollection as removePhotosFromCollectionRecord
} from '../core/collections';
import { readSavedFilters, writeSavedFilters, type SavedFilterPreset } from './savedFilters';
import { applyAdjustmentsToBlob, isNeutral, type EditAdjustments } from '../core/imageAdjust';
import { readApplyEditsInGallery, writeApplyEditsInGallery } from './applyEditsPreference';
import { clearPreviewUrlCache } from '../core/previewUrlCache';
import {
  importFiles, originalFiles, originalHandles, createCancelToken, SELECT_THRESHOLD, REJECT_THRESHOLD, decidePhotoStatus,
  type ImportProgress, type ImportCancelToken
} from '../core/importPipeline';
import type { FileSystemFileHandleLike } from '../core/filePicker';
import { readEconomicMode, writeEconomicMode } from '../core/performanceSettings';
import { vibrate } from '../ui/haptics';
import { exportOriginalFiles, computeGroupPersonUnion } from '../core/exportPhotos';
import { exportXMPSidecars, deriveXmpKeywords, deriveAiScoreKeyword, deriveSeriesKeyword } from '../core/export/xmpGenerator';
import { analysisPool } from '../core/workerPool';
import { contextEngine, deriveContextKey, explainFactors, type WeightShift } from '../core/learning/ContextEngine';
import { pickBestInGroup } from '../core/groupSelection';
import {
  pushHistory, popHistory, MAX_HISTORY, type HistoryEvent,
  pushBatchHistory, popBatchHistory, type BatchHistoryEvent, type FieldBatchHistoryEvent
} from './history';
import { selectBulkRejectTargets, resolveGroups, selectTopPercent, selectHighlights, selectBlinks } from './batchOps';
import { readStoredTheme, applyTheme, type Theme } from './theme';
import { readStoredProjectName, writeProjectName } from './projectName';
import { readStoredWatermarkText, writeWatermarkText } from './watermarkText';
import { readStoredGenre, writeStoredGenre } from './genre';
import { readGridDensity, writeGridDensity, type GridDensity } from './gridDensity';
import { readGridSort, writeGridSort, compareBy, type GridSort } from './gridSort';
import { readStoredRenameTemplate, writeStoredRenameTemplate } from '../core/renameTemplate';
import { recordUsage, readMonthlyUsage, FREE_TIER_MONTHLY_LIMIT } from './usage';
import { getProjectMetadata } from './projectMetadata';
import { buildPersonProfilesExport, personProfilesFileName, parsePersonProfilesFile } from '../core/personProfileTransfer';
import { readStoredLocale, writeStoredLocale, applyLocale, t, plural, type Locale } from '../i18n';
import { translateSceneTag, normalizeForSearch } from '../core/sceneTagLabels';
import { buildBackup, backupFileName, parseBackupFile, restoreBackup } from '../core/backupService';
import { writeLastBackupAt } from './backupReminder';
import { buildClientGalleryHtml } from '../core/export/clientGallery';
import { parseClientFeedbackFile } from '../core/export/clientFeedback';
import { downloadBlob } from '../core/export/directoryPicker';
import { buildSessionReportText } from '../core/export/sessionReport';
import { computeLibraryStats } from '../core/stats';

/** Cerere activa de dialog tematizat (vezi askConfirm/askPrompt mai jos) — `resolve` e apelat o singura data, de componenta ConfirmDialog. */
export type DialogRequest =
  | { kind: 'confirm'; message: string; confirmLabel?: string; cancelLabel?: string; danger?: boolean; resolve: (value: boolean) => void }
  | { kind: 'prompt'; message: string; defaultValue?: string; confirmLabel?: string; cancelLabel?: string; resolve: (value: string | null) => void };

export interface PhotoView {
  id: string;
  fileName: string;
  /** Momentul importului in aplicatie (nu data capturii — vezi capturedAt), folosit pentru raportul de sesiune. */
  importedAt: number;
  status: PhotoRecord['status'];
  rating: number;
  /** Eticheta de culoare (vezi core/db.ts) — absent = fara eticheta ('none'). */
  colorLabel?: ColorLabel;
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
  /**
   * Compozitie pentru scene FARA subiect uman (peisaje/detalii) — treimile si
   * headroom-ul de mai sus n-au sens fara o fata de referinta, asa ca aici
   * folosim linii directoare/simetrie/spatiu negativ (plan 2.2.3), calculate
   * geometric in faceAnalysis.worker.ts (detectLeadingLines/detectSymmetry/
   * negativeSpaceScore), deja factorizate in scorul AI dar niciodata afisate
   * separat utilizatorului pana acum.
   */
  leadingLinesDetected?: boolean;
  symmetryDetected?: boolean;
  negativeSpaceScore?: number;
  groupEyesOpenRatio?: number;
  groupSmileRatio?: number;
  /** Fractie de fete cu o expresie stanjenitoare (gura deschisa fara zambet/surpriza reala) — vezi ContextEngine PRIOR_WEIGHTS. Folosit pentru badge-ul "Zambet fortat" pe thumbnail. */
  groupAwkwardRatio?: number;
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
  /** Metadate IPTC-IIM (segment Photoshop APP13) — vezi core/iptcParser.ts. */
  iptcByline?: string;
  iptcCaption?: string;
  iptcHeadline?: string;
  iptcCredit?: string;
  iptcSource?: string;
  iptcCopyright?: string;
  iptcCity?: string;
  iptcCountry?: string;
  iptcKeywords?: string[];
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
  /** Placeholder minuscul blurat, disponibil sincron — vezi PhotoRecord.lqip. Absent pe importuri vechi. */
  lqip?: string;
  /** Ajustari de baza non-destructive (expunere/contrast/...) — vezi core/imageAdjust.ts si PhotoRecord.edits. Absent = fara ajustari. */
  edits?: EditAdjustments;
  /** Alegerea clientului importata din "galeria client cu feedback" — vezi PhotoRecord.clientFeedback. Absent = niciun feedback importat. */
  clientFeedback?: 'like' | 'dislike';
}

export type FilterKey = 'all' | 'selected' | 'review' | 'rejected' | 'series' | 'blinks' | 'goldenHour' | 'highlights';

/** Cheie de proiectFilter pentru pozele fara proiect ales — un nume de proiect real nu poate coincide cu acest sentinel (spatii, gol dupa trim). */
export const NO_PROJECT_KEY = 'no-project';

/**
 * `etaSeconds` e calculat AICI (nu in importPipeline.ts, care nu stie/nu-i pasa
 * de timp real, doar de done/total) — medie cumulativa done/elapsed de la
 * primul tick de faza 'analiza', suficient de stabila fara sa mai tinem o
 * fereastra glisanta separata. Absent (`undefined`) cat timp nu avem inca
 * destule date (primul tick, sau done===0).
 */
type ProgressState = ImportProgress & { etaSeconds?: number };

interface AppState {
  photos: PhotoView[];
  persons: KnownPerson[];
  /** Foldere personalizate (cerinta directa a utilizatorului) — vezi core/collections.ts. */
  collections: CollectionRecord[];
  progress: ProgressState | null;
  /**
   * Bifat imediat cand se apasa Anuleaza, INAINTE ca importul sa se opreasca
   * efectiv — cancelImport() muta direct o proprietate pe un obiect simplu
   * (activeCancelToken.cancelled), care NU trece prin set() si deci nu
   * declanseaza niciun re-render; fara acest flag separat, butonul ramanea
   * vizual neschimbat cat timp pozele deja in curs de analiza isi terminau
   * rundele (poate dura cateva zeci de secunde), lasand impresia falsa ca
   * apasarea n-a facut nimic (raportat de utilizator ca buton "stricat").
   */
  importCancelling: boolean;
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
  /**
   * Sablon de redenumire in masa la export (vezi core/renameTemplate.ts) —
   * token-uri {client} {eveniment} {locatie} {data} {secventa} {nume}. Gol
   * (implicit) = pastreaza numele original de fisier, neschimbat. Persistat
   * local, folosit de exportSelection.
   */
  renameTemplate: string;
  setRenameTemplate: (template: string) => void;
  /** Exporta persoanele cunoscute + modelele AI invatate (fara imagini) intr-un fisier JSON de backup. */
  exportBackup: () => Promise<void>;
  /** Restaureaza un backup: persoane + modele AI, plus reaplicarea deciziilor (status/rating) pe pozele curente care se potrivesc (nume fisier + data capturii). */
  importBackupFile: (file: File) => Promise<void>;
  /**
   * Importa alegerile clientului (JSON descarcat din galeria statica trimisa
   * clientului — vezi core/export/clientGallery.ts + clientFeedback.ts): scrie
   * PhotoRecord.clientFeedback pe pozele care se potrivesc (id, fallback nume
   * fisier) SI antreneaza ContextEngine exact ca la o decizie normala a
   * fotografului, ca AI-ul sa invete si din alegerile clientului.
   */
  importClientFeedback: (file: File) => Promise<void>;
  /** Viteza ultimului import (poze procesate + durata) — afisata in Statistici; null inainte de primul import al sesiunii. */
  lastImportStats: { count: number; durationMs: number } | null;
  /** Contor informativ de poze procesate in luna curenta — vezi state/usage.ts (NU e o limita reala/blocanta). */
  monthlyUsage: number;
  statsOpen: boolean;
  setStatsOpen: (open: boolean) => void;
  /** Contact sheet printabil (plan "cat mai pro") — grila compacta cu toate miniaturile + status/rating, gata de window.print(). */
  contactSheetOpen: boolean;
  setContactSheetOpen: (open: boolean) => void;
  /** Prezentare fullscreen cinematica (auto-advance) — pentru aratat pozele clientului pe loc, fara laptop deschis pe grila de lucru. */
  presentationOpen: boolean;
  setPresentationOpen: (open: boolean) => void;
  filter: FilterKey;
  /** Filtru suplimentar, combinabil cu `filter` — numele unei persoane cunoscute, sau null (fara filtru). */
  personFilter: string | null;
  /** Filtru suplimentar dupa eticheta de culoare (vezi core/db.ts ColorLabel), combinabil cu restul. Null = fara filtru. */
  colorLabelFilter: ColorLabel | null;
  setColorLabelFilter: (label: ColorLabel | null) => void;
  /** Filtru suplimentar dupa o eticheta de scena/obiect (PhotoView.sceneTags, COCO-80 — ex. "dog", "cake"), combinabil cu restul. Null = fara filtru. */
  sceneTagFilter: string | null;
  setSceneTagFilter: (tag: string | null) => void;
  /** Filtru suplimentar dupa proiectul sub care a fost importata poza (PhotoRecord.project) — vezi ProjectsPanel. */
  projectFilter: string | null;
  setProjectFilter: (project: string | null) => void;
  /** Filtru suplimentar dupa aparatul foto (EXIF cameraModel), combinabil cu restul. Null = fara filtru. */
  cameraFilter: string | null;
  setCameraFilter: (camera: string | null) => void;
  projectsOpen: boolean;
  setProjectsOpen: (open: boolean) => void;
  /** Filtru suplimentar dupa un folder personalizat (CollectionRecord.id), combinabil cu restul. Null = fara filtru. */
  collectionFilter: string | null;
  setCollectionFilter: (collectionId: string | null) => void;
  collectionsOpen: boolean;
  setCollectionsOpen: (open: boolean) => void;
  createCollection: (name: string) => Promise<CollectionRecord | null>;
  renameCollection: (id: string, name: string) => Promise<void>;
  deleteCollection: (id: string) => Promise<void>;
  /** Adauga fotografiile date (implicit selectia multipla curenta) intr-un folder — vezi core/collections.ts. */
  addPhotosToCollection: (id: string, photoIds: string[]) => Promise<void>;
  removePhotosFromCollection: (id: string, photoIds: string[]) => Promise<void>;
  /** Exporta toate pozele dintr-un folder personalizat, indiferent de status — vezi comentariul de langa implementare. */
  exportCollection: (id: string) => Promise<void>;
  /**
   * Combinatii de filtre denumite de utilizator, reaplicabile dintr-un click —
   * vezi state/savedFilters.ts pentru ce campuri chiar sunt salvate (si de ce
   * NU toate). Persistate local, nu in Dexie — o preferinta reutilizabila peste
   * sesiuni/biblioteci, nu date legate strict de sesiunea curenta.
   */
  savedFilters: SavedFilterPreset[];
  /** null daca nu exista niciun filtru secundar activ de salvat (vezi implementarea). */
  saveCurrentFiltersAsPreset: (name: string) => SavedFilterPreset | null;
  applySavedFilterPreset: (id: string) => void;
  deleteSavedFilterPreset: (id: string) => void;
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
  /** Poza deschisa in EditPanel (modulul de editare de baza) — null = panoul e inchis. */
  editingPhotoId: string | null;
  /** vezi openEdit — consumat o singura data de EditPanel la incarcarea pozei, nu ramane "agatat" intre deschideri (openEdit il rescrie mereu, inclusiv la false). */
  editAutoApplyRequested: boolean;
  personsOpen: boolean;
  menuOpen: boolean;
  insightsOpen: boolean;
  workspaceMode: boolean;
  batchOpsOpen: boolean;
  paletteOpen: boolean;
  shortcutsOpen: boolean;
  /**
   * Dialog de confirmare/prompt TEMATIZAT (plan "cat mai pro") — inlocuieste
   * window.confirm/window.prompt (popup nativ de browser, nu respecta tema
   * dark/light si sparge iluzia de aplicatie completa). Un singur request activ
   * o data; askConfirm/askPrompt intorc o Promise care se rezolva cand
   * utilizatorul raspunde (buton, Enter, Escape sau click pe fundal).
   */
  dialogRequest: DialogRequest | null;
  askConfirm: (message: string, opts?: { confirmLabel?: string; cancelLabel?: string; danger?: boolean }) => Promise<boolean>;
  askPrompt: (message: string, defaultValue?: string, opts?: { confirmLabel?: string; cancelLabel?: string }) => Promise<string | null>;
  resolveDialog: (value: boolean | string | null) => void;
  theme: Theme;
  setTheme: (theme: Theme) => void;
  /** Limba interfetei — vezi i18n/index.ts. Migrare treptata: doar unele ecrane citesc asta deocamdata, restul ramane in romana codificata direct. */
  locale: Locale;
  setLocale: (locale: Locale) => void;
  projectName: string;
  setProjectName: (name: string) => void;
  /** Text de watermark pentru galeria client (core/export/watermark.ts) — gol = fara watermark, comportament neschimbat. */
  watermarkText: string;
  setWatermarkText: (text: string) => void;
  /** Coace ajustarile de baza (EditPanel) in miniaturile din galeria pentru client — implicit fals, activata explicit doar cand se doreste (vezi exportClientGallery). */
  applyEditsInGallery: boolean;
  setApplyEditsInGallery: (value: boolean) => void;
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
   * Istoric SEPARAT pentru editari in masa pe campuri ALTELE decat status
   * (rating/eticheta de culoare/descriere/cuvinte cheie override, vezi
   * bulkSet*ForSelection mai jos) — stiva proprie (nu extinde
   * BatchHistoryEvent) ca sa nu atinga formatul deja folosit de cele ~7
   * actiuni de status existente. `undo()` alege cea mai recenta dintre toate
   * cele 3 stive dupa timestamp.
   */
  fieldBatchHistory: FieldBatchHistoryEvent[];
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
  runImport: (files: File[], handles?: (FileSystemFileHandleLike | undefined)[]) => Promise<void>;
  setStatus: (id: string, status: PhotoRecord['status']) => Promise<void>;
  /**
   * Rating 1-5 stele — axa SEPARATA de status (pick/respins/de verificat),
   * ca in Lightroom. Click pe aceeasi stea deja setata o sterge (trece la 0).
   * Nu antreneaza ContextEngine (doar Selecteaza/Respinge fac asta) si nu
   * intra in istoricul de undo (actiune cu risc scazut, reversibila oricand
   * cu un nou click).
   */
  setRating: (id: string, rating: number) => Promise<void>;
  setColorLabel: (id: string, label: ColorLabel) => Promise<void>;
  /** Salveaza ajustarile de baza (EditPanel) — non-destructiv, vezi PhotoRecord.edits. */
  setEditAdjustments: (id: string, adjustments: EditAdjustments) => Promise<void>;
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
  /**
   * Re-analizeaza scorul AI al TUTUROR pozelor deja importate, cu modelul
   * ContextEngine CURENT (nu re-decodeaza imaginile — refoloseste analiza deja
   * calculata). Utila dupa ce modelul s-a antrenat suplimentar sau dupa
   * restaurarea unui backup cu un model diferit: pozele importate INAINTE de
   * acel moment raman cu scorul/starea calculate atunci, cu modelul vechi,
   * pana ruleaza asta explicit. Spre deosebire de celelalte operatii in masa,
   * poate schimba starea unor poze deja SELECTATE/RESPINSE (nu doar cele
   * nedecise) — de-asta cere confirmare explicita in UI (BatchOpsPanel) si e
   * inregistrata in batchHistory pentru undo.
   */
  rescorePhotos: () => Promise<{ total: number; changed: number }>;
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
  bulkSetColorLabelForSelection: (label: ColorLabel) => Promise<void>;
  /** Suprascrie descrierea IPTC pe toata selectia curenta (multiSelectIds) — vezi PhotoRecord.captionOverride. */
  bulkSetCaptionForSelection: (caption: string) => Promise<void>;
  /** Suprascrie cuvintele-cheie IPTC pe toata selectia curenta — vezi PhotoRecord.keywordsOverride. */
  bulkSetKeywordsForSelection: (keywords: string[]) => Promise<void>;
  setFilter: (f: FilterKey) => void;
  /** Intra direct in Workspace (lupa + navigare tastatura) filtrat pe "de verificat" — vezi CullGauge (stat clickabil) si ui/Workspace.tsx. */
  startQuickReview: () => void;
  setPersonFilter: (name: string | null) => void;
  setSearchText: (text: string) => void;
  setDateRange: (from: number | null, to: number | null) => void;
  setMinRating: (rating: number) => void;
  clearAdvancedFilters: () => void;
  /**
   * Reseteaza TOATE filtrele combinabile dintr-o singura apasare (cerinta
   * directa a utilizatorului: fara asta, ca sa dezactivezi un filtru trebuia
   * sa stii exact care era activ si sa-l re-selectezi in panoul lui —
   * persoana/eticheta/scena/aparat/proiect/folder aveau fiecare propriul
   * mecanism de "sterge", niciunul central). NU atinge `filter` (statusul
   * principal Toate/Selectate/...) — acela are deja "Toate" ca reset
   * evident, cu sens diferit (schimbarea lui ar putea surprinde un
   * utilizator care vrea doar sa scape de filtrul de persoana, de exemplu).
   */
  clearAllFilters: () => void;
  openDetail: (id: string | null) => void;
  openCompare: (groupId: string | null) => void;
  /** `autoApply: true` — EditPanel invoca "Auto" o singura data, imediat ce poza s-a incarcat (vezi PhotoInfoTabs, butonul "Aplica" de pe o sugestie fixabila acum). */
  openEdit: (id: string | null, opts?: { autoApply?: boolean }) => void;
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
  setNotice: (message: string) => void;
  clearNotice: () => void;
  exportSelection: () => Promise<void>;
  exportManifest: () => Promise<void>;
  /** Sumar text (nr. poze, scor mediu, durata sesiunii) pentru documentare/facturare fata de client. */
  exportSessionReport: () => Promise<void>;
  exportXMP: () => Promise<void>;
  /** Genereaza si descarca o galerie HTML statica cu pozele selectate, pentru feedback de la client. */
  exportClientGallery: () => Promise<void>;
  filtered: () => PhotoView[];
  /** Id-urile pozelor "cele mai bune" din propriul grup — vezi computeBestInGroupIds, pentru badge-ul "Best of series". */
  bestInGroupIds: () => Set<string>;
  /** Aceeasi biblioteca, cu doar filtrele SECUNDARE aplicate (persoana/eticheta/scena/camera/proiect/cautare/data/rating) — vezi comentariul de la implementare. */
  secondaryFiltered: () => PhotoView[];
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
    importedAt: photo.importedAt,
    status: photo.status,
    rating: photo.rating ?? 0,
    colorLabel: photo.colorLabel,
    lqip: photo.lqip,
    edits: photo.edits,
    clientFeedback: photo.clientFeedback,
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
    leadingLinesDetected: analysis?.leadingLinesDetected,
    symmetryDetected: analysis?.symmetryDetected,
    negativeSpaceScore: analysis?.negativeSpaceScore,
    groupEyesOpenRatio: analysis?.groupEyesOpenRatio,
    groupSmileRatio: analysis?.groupSmileRatio,
    groupAwkwardRatio: analysis?.groupAwkwardRatio,
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
    iptcByline: analysis?.iptcByline,
    // suprascrierea manuala (editare in masa) precede valoarea parsata din fisier, fara sa o modifice
    iptcCaption: photo.captionOverride ?? analysis?.iptcCaption,
    iptcHeadline: analysis?.iptcHeadline,
    iptcCredit: analysis?.iptcCredit,
    iptcSource: analysis?.iptcSource,
    iptcCopyright: analysis?.iptcCopyright,
    iptcCity: analysis?.iptcCity,
    iptcCountry: analysis?.iptcCountry,
    iptcKeywords: photo.keywordsOverride ?? analysis?.iptcKeywords,
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

/**
 * Bug real gasit de auditul QA: removePerson/removePersons/mergePersons
 * atingeau doar db.persons — AnalysisRecord.faces[i].personId/personName e o
 * fotografie INSTANTANEE, salvata la momentul analizei (faceAnalysis.worker.ts),
 * si tot ce afiseaza identificarea (grila, export XMP/nume fisier, statistici
 * de recunoastere din core/stats.ts) citeste DOAR din acea fotografie, nu din
 * tabelul persons live. Rezultat: dupa stergerea unei persoane, pozele deja
 * analizate continuau sa arate numele ei; dupa unirea a doua profiluri, pozele
 * deja etichetate ramaneau cu identitatea veche, fragmentata, in loc de cea
 * unita — exact acelasi tipar de re-etichetare RETROACTIVA pe care
 * enrollFaceCluster il face deja corect pentru propriul caz. `mapping` leaga
 * fiecare id VECHI (sters SAU absorbit intr-o unire) la noua identitate
 * ({id,name}) sau la null (stergere simpla, straini de-acum). Scaneaza intreg
 * tabelul analyses (nu doar pozele curent incarcate) — actiune rara, deliberata,
 * nu un cost care conteaza pe hot path.
 */
/**
 * Muta in-place (fara sa atinga Dexie) faces-urile lui `analysis` care
 * poarta un personId din `mapping`, spre noua identitate — extrasa separat
 * de relabelAnalyses ca sa fie testabila unitar fara IndexedDB reala.
 * Intoarce true daca a schimbat ceva (apelantul stie ce sa scrie inapoi).
 */
export function relabelFaces(analysis: AnalysisRecord, mapping: Map<string, { id: string; name: string } | null>): boolean {
  let changed = false;
  for (const face of analysis.faces) {
    if (face.personId && mapping.has(face.personId)) {
      const target = mapping.get(face.personId) ?? null;
      face.personId = target?.id ?? null;
      face.personName = target?.name ?? null;
      changed = true;
    }
  }
  if (changed) {
    analysis.knownFaceCount = analysis.faces.filter(f => f.personId).length;
    analysis.strangerCount = analysis.faces.filter(f => !f.personId).length;
  }
  return changed;
}

async function relabelAnalyses(mapping: Map<string, { id: string; name: string } | null>): Promise<void> {
  const all = await db.analyses.toArray();
  const updates = all.filter(analysis => relabelFaces(analysis, mapping));
  if (updates.length) await db.analyses.bulkPut(updates);
}

/**
 * Bug real gasit de auditul QA: o simpla concatenare + tail-slice la
 * `maxTotal` NU pastreaza "cele mai recente" cum pretindea comentariul vechi
 * din mergePersons — KnownPerson.embeddings n-are timestamp per-element, deci
 * acel tail-slice putea sterge 100% din referintele UNUI profil (cel listat
 * primul) daca celalalt era deja aproape de plafon. Fiecare profil isi
 * pastreaza insa propria ordine cronologica (addPerson adauga mereu la coada)
 * — asa ca luam cate un plafon EGAL din coada FIECARUI profil, garantand ca o
 * unire nu poate elimina complet contributia niciunuia.
 */
export function selectMergedEmbeddings(profiles: number[][][], maxTotal: number): number[][] {
  if (!profiles.length) return [];
  const perProfileCap = Math.max(1, Math.floor(maxTotal / profiles.length));
  return profiles.flatMap(p => p.slice(-perProfileCap)).slice(-maxTotal);
}

async function train(id: string, userDecision: boolean): Promise<{ topShift: WeightShift | null }> {
  const [analysis, photo] = await Promise.all([db.analyses.get(id), db.photos.get(id)]);
  if (!analysis) return { topShift: null };
  const aiDecision = analysis.aiScore >= 65;
  const locale = useStore.getState().locale;
  return contextEngine.recordCorrection({ photoId: id, analysis, aiDecision, userDecision, genre: photo?.genre, locale });
}

/**
 * Bug real gasit de auditul QA (bug/medium, scalabilitate): fiecare operatie
 * in masa (Auto-Cull, Respinge sub prag, Rezolva serii, actiuni pe selectia
 * multipla) facea, per poza, db.photos.update() + syncOriginal() SERIAL
 * inainte de train() — pentru un lot de cateva sute de poze (Auto-Cull la
 * 50% pe o biblioteca mare, mai ales nedecisa), asta transforma o actiune
 * care ar trebui sa fie aproape instantanee intr-o operatie de ordinul
 * secundelor, agravandu-se pe masura ce biblioteca creste peste 1000+ poze.
 * train() insa NU poate fi paralelizat/batch-uit fara sa schimbe semantica
 * invatarii online (fiecare corectie foloseste ca baza ponderile deja
 * actualizate de cea anterioara, un gradient SGD secvential) — dar
 * verificat direct: train() nu depinde de scrierea `status` in sine
 * (foloseste doar AnalysisRecord, neschimbat de aceste actiuni, si
 * photo.genre, la fel neschimbat), deci scrierile DB pot rula in PARALEL
 * intre ele, cu train() ramas strict secvential dupa, identic ca inainte.
 */
async function applyBulkStatusChanges(
  changes: { id: string; status: PhotoRecord['status'] }[],
  trainDecision: (status: PhotoRecord['status']) => boolean | null
): Promise<{ quotaError: boolean }> {
  let quotaError = false;
  await Promise.all(changes.map(async c => {
    await db.photos.update(c.id, { status: c.status });
    const res = await syncOriginal(c.id, c.status);
    if (res.quotaError) quotaError = true;
  }));
  for (const c of changes) {
    const decision = trainDecision(c.status);
    if (decision !== null) await train(c.id, decision);
  }
  return { quotaError };
}

function makeBatchEvent(label: string, changes: { photoId: string; previousStatus: PhotoRecord['status'] }[]): BatchHistoryEvent {
  return { id: crypto.randomUUID(), label, changes, ts: Date.now() };
}

function makeFieldBatchEvent(
  label: string,
  field: FieldBatchHistoryEvent['field'],
  changes: { photoId: string; previousValue: FieldBatchHistoryEvent['changes'][number]['previousValue'] }[]
): FieldBatchHistoryEvent {
  return { id: crypto.randomUUID(), label, field, changes, ts: Date.now() };
}

/**
 * Pastreaza o referinta la fisierul original doar cat timp poza e SELECTATA —
 * altfel exportul "format original" depinde de un File tinut in memorie care
 * dispare la orice reload de tab (frecvent pe mobil, cand browserul descarca
 * tab-urile din fundal ca sa economiseasca RAM). La deselectare, o stergem la
 * loc ca sa nu dublam spatiul ocupat de intregul import.
 *
 * Cand importul a folosit File System Access API (plan 2.3.4), preferam
 * handle-ul (cateva zeci de octeti, in db.fileHandles) fata de o copie
 * completa a blob-ului (db.originals) — elimina exact riscul de
 * QuotaExceededError pe care copierea integrala il avea pe biblioteci mari.
 */
async function syncOriginal(id: string, status: PhotoRecord['status']): Promise<{ quotaError: boolean }> {
  if (status === 'selected') {
    const handle = originalHandles.get(id);
    if (handle) {
      await db.fileHandles.put({ photoId: id, handle });
      await db.originals.delete(id); // daca exista deja o copie blob dintr-o versiune anterioara, n-o mai dublam
      return { quotaError: false };
    }
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
    // Bug real raportat de utilizator (confirmat pe device: "Exporta" pe un
    // folder personalizat nu facea NIMIC): o poza membra a unui folder
    // personalizat dar NU 'selected' isi pierdea originalul persistat aici de
    // fiecare data cand statusul ei se schimba (inclusiv indirect, prin alta
    // actiune) — desi exportCollection() promite explicit sa exporte un folder
    // "indiferent de status" (vezi comentariul acelei actiuni). Verificam
    // apartenenta la vreun folder personalizat INAINTE de stergere; vezi si
    // persistOriginalForCollectionMember/cleanupOrphanedOriginal mai jos,
    // care persista/elibereaza aceeasi copie la adaugarea/scoaterea dintr-un
    // folder (nu doar la (de)selectare, singurul caz acoperit aici).
    const inAnyCollection = useStore.getState().collections.some(c => c.memberIds.includes(id));
    if (!inAnyCollection) {
      await db.originals.delete(id);
      await db.fileHandles.delete(id);
    }
    // Nota (verificat, NU reparat): originalFiles/originalHandles (in memorie,
    // per sesiune) NU pot fi curatate aici desi randurile din DB tocmai au
    // fost sterse — daca poza e re-selectata mai tarziu in aceeasi sesiune
    // (inclusiv prin undo(), care re-cheama syncOriginal cu statusul anterior
    // 'selected'), acest cod are nevoie de exact aceste Map-uri ca sa poata
    // repersista originalul. Golirea lor aici ar rupe select->reject->select
    // (sau orice undo dupa un reject). Cresterea lor pe durata sesiunii e deci
    // un compromis deliberat, nu un bug — au ramas neatinse intentionat.
  }
  return { quotaError: false };
}

/**
 * Persista o copie a originalului pentru o poza adaugata intr-un folder
 * personalizat, INDIFERENT de statusul ei — syncOriginal() de mai sus face
 * asta doar pentru 'selected', dar exportCollection() promite explicit sa
 * exporte un folder "indiferent de status". No-op daca exista deja o copie
 * (ex. poza e si 'selected') sau daca fisierul nu mai e disponibil in
 * memorie (sesiune deja reincarcata inainte de adaugarea in folder) —
 * exportul va raporta atunci corect acea poza ca lipsa, acelasi
 * comportament onest ca oriunde altundeva in aplicatie.
 */
async function persistOriginalForCollectionMember(id: string): Promise<void> {
  const [existingHandle, existingBlob] = await Promise.all([db.fileHandles.get(id), db.originals.get(id)]);
  if (existingHandle || existingBlob) return;
  const handle = originalHandles.get(id);
  if (handle) { await db.fileHandles.put({ photoId: id, handle }); return; }
  const file = originalFiles.get(id);
  if (!file) return;
  try {
    await db.originals.put({ photoId: id, blob: file, fileName: file.name, type: file.type });
  } catch (err) {
    if (!(err instanceof DOMException && err.name === 'QuotaExceededError')) throw err;
    // cota depasita — nu blocam adaugarea in folder pentru atat, exportul va raporta poza ca lipsa mai tarziu
  }
}

/** Elibereaza originalul persistat pentru o poza scoasa dintr-un folder (sau al carui folder a fost sters), daca nu mai e necesar din niciun alt motiv. */
async function cleanupOrphanedOriginal(id: string, collectionsAfter: CollectionRecord[]): Promise<void> {
  if (collectionsAfter.some(c => c.memberIds.includes(id))) return;
  const photo = await db.photos.get(id);
  if (photo?.status === 'selected') return;
  await db.originals.delete(id);
  await db.fileHandles.delete(id);
}

function quotaNotice(locale: Locale): string {
  return t(locale, 'store.quotaNotice');
}

/** Plafon de referinte faciale per persoana — reinrolarile succesive extind profilul, nu-l lasa sa creasca la nesfarsit. */
const MAX_PERSON_EMBEDDINGS = 12;

/**
 * Plafon de fisiere de referinta procesate per apel addPerson. Bug real gasit
 * de auditul QA: fisierele peste acest plafon erau ignorate complet silentios
 * — mesajul de succes nu mentiona taierea, iar numaratoarea "N poze alese"
 * din PersonsPanel.tsx arata numarul TOTAL selectat, nu cel folosit efectiv.
 * Fix: mesajul de succes de mai jos mentioneaza explicit cate au fost sarite.
 */
const MAX_PERSON_REFERENCE_FILES = 4;

function statusLabel(locale: Locale, status: PhotoRecord['status']): string {
  return t(locale, `store.statusLabel.${status}`);
}

// index.html porneste static cu lang="ro" — sincronizam imediat cu limba
// persistata (fara asta, un utilizator care revine cu engleza deja aleasa
// ar avea temporar/permanent atributul lang gresit pana la primul setLocale).
applyLocale(readStoredLocale());

/**
 * Cautarea text (filtered()/secondaryFiltered()) potriveste ACUM si dupa
 * etichetele de scena/obiect detectate de AI (COCO-80, traduse in romana —
 * vezi core/sceneTagLabels.ts), nu doar numele fisierului — feedback direct
 * de la utilizator: cauta "pisica" si asteapta sa gaseasca pozele in care AI-ul
 * a detectat o pisica, nu doar fisiere cu "pisica" in nume (aproape niciodata
 * cazul). normalizeForSearch scoate diacriticele din ambele parti, ca "pisica"
 * tastat fara "ă" tot sa gaseasca "pisică".
 */
function matchesSearch(p: PhotoView, normalizedQuery: string, locale: Locale): boolean {
  if (normalizeForSearch(p.fileName).includes(normalizedQuery)) return true;
  return (p.sceneTags ?? []).some(tag => normalizeForSearch(translateSceneTag(tag, locale)).includes(normalizedQuery));
}

/**
 * Distanta pana la CEL MAI APROPIAT prag (select sau reject) pentru un scor
 * din banda "de verificat" (REJECT_THRESHOLD < scor < SELECT_THRESHOLD) —
 * folosita pentru ordinea implicita a filtrului 'review' (vezi filtered()).
 * Valoare mica = decizie usoara (aproape de un prag), valoare mare = poza cu
 * adevarat ambigua (aproape de mijlocul benzii).
 */
function reviewProximity(score: number): number {
  return Math.min(score - REJECT_THRESHOLD, SELECT_THRESHOLD - score);
}

/**
 * Memoizare pentru filtered(): fara ea, FIECARE schimbare de stare (chiar una
 * fara nicio legatura, ex. o litera tastata in campul de watermark) recalcula
 * integral filtrarea + sortarea pe toata biblioteca — si o facea de mai multe
 * ori, o data per componenta care apeleaza useStore(s => s.filtered())
 * (App.tsx, Workspace.tsx, ContactSheet.tsx, PresentationMode.tsx). Pe o
 * biblioteca de 1000+ poze, asta insemna sute de operatii .filter()/.sort()
 * inutile pe secunda la o simpla tastare. Cache-ul de mai jos returneaza
 * ACEEASI referinta de array cand niciuna din dependentele reale nu s-a
 * schimbat — Zustand foloseste Object.is pe rezultatul selectorului, deci o
 * referinta identica opreste re-renderul, nu doar recalculul.
 */
/**
 * Id-urile pozelor "cele mai bune" din propriul grup (serie/duplicate) —
 * pentru badge-ul "Best of series" pe thumbnail (cerinta directa). Grupurile
 * de 1 membru n-au un "cel mai bun" cu sens (n-au cu ce compara), deci raman
 * excluse. Memoizat prin referinta la `photos` (acelasi tipar ca filteredCache
 * de mai jos) — un card individual (PhotoCard) n-are acces la restul
 * bibliotecii, deci calculul trebuie facut o singura data, central, nu per-card.
 *
 * Foloseste doar campurile deja disponibile pe PhotoView (sharpness/exposure/
 * faceCount/bestSmile/groupSmileRatio/allEyesOpen/groupEyesOpenRatio) — spre
 * deosebire de selectBestPhotoInGroup (folosit la comparatia explicita de
 * grup, GroupCompare.tsx), care mai citeste si compositionScore/avgEyeContact
 * direct din db.analyses (absente pe PhotoView). Rezultatul poate deci sa
 * difere usor de recomandarea din ecranul de comparatie — acceptabil pentru
 * un badge orientativ pe grila, nu vrem N interogari IndexedDB doar ca sa
 * afisam niste insigne.
 */
let bestInGroupCache: { photos: PhotoView[]; result: Set<string> } | null = null;

function computeBestInGroupIds(photos: PhotoView[]): Set<string> {
  if (bestInGroupCache && bestInGroupCache.photos === photos) return bestInGroupCache.result;
  const groups = new Map<string, PhotoView[]>();
  for (const p of photos) {
    if (!p.groupId) continue;
    const arr = groups.get(p.groupId);
    if (arr) arr.push(p); else groups.set(p.groupId, [p]);
  }
  const result = new Set<string>();
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    result.add(pickBestInGroup(members));
  }
  bestInGroupCache = { photos, result };
  return result;
}

let filteredCache: {
  photos: PhotoView[];
  filter: FilterKey;
  personFilter: string | null;
  colorLabelFilter: ColorLabel | null;
  sceneTagFilter: string | null;
  cameraFilter: string | null;
  projectFilter: string | null;
  collectionFilter: string | null;
  /** referinta de array — o schimbare de apartenenta (adaugare/scoatere poze dintr-un folder) creeaza mereu un array nou in store (vezi actiunile din core/collections.ts), deci Object.is aici invalideaza corect cache-ul. */
  collections: CollectionRecord[];
  searchText: string;
  /** cautarea potriveste si etichete de scena TRADUSE — schimbarea limbii schimba rezultatul. */
  locale: Locale;
  dateFrom: number | null;
  dateTo: number | null;
  minRating: number;
  gridSortKey: GridSort['key'];
  gridSortDir: GridSort['dir'];
  result: PhotoView[];
} | null = null;

/**
 * Cache separat pentru secondaryFiltered() — vezi comentariul de acolo pentru
 * bug-ul real pe care il rezolva (badge-urile de numar din randul de filtre
 * nu reflectau filtrele secundare active). Aceeasi tehnica de memoizare ca
 * filteredCache de mai sus, dar fara `filter`/sortare (nu conteaza aici).
 */
let secondaryFilteredCache: {
  photos: PhotoView[];
  personFilter: string | null;
  colorLabelFilter: ColorLabel | null;
  sceneTagFilter: string | null;
  cameraFilter: string | null;
  projectFilter: string | null;
  collectionFilter: string | null;
  /** referinta de array — o schimbare de apartenenta (adaugare/scoatere poze dintr-un folder) creeaza mereu un array nou in store (vezi actiunile din core/collections.ts), deci Object.is aici invalideaza corect cache-ul. */
  collections: CollectionRecord[];
  searchText: string;
  locale: Locale;
  dateFrom: number | null;
  dateTo: number | null;
  minRating: number;
  result: PhotoView[];
} | null = null;

export const useStore = create<AppState>((set, get) => ({
  photos: [],
  persons: [],
  collections: [],
  progress: null,
  importCancelling: false,
  filter: 'all',
  personFilter: null,
  projectFilter: null,
  setProjectFilter: project => set({ projectFilter: project }),
  projectsOpen: false,
  setProjectsOpen: open => set({ projectsOpen: open }),
  collectionFilter: null,
  setCollectionFilter: collectionId => set({ collectionFilter: collectionId }),
  collectionsOpen: false,
  setCollectionsOpen: open => set({ collectionsOpen: open }),
  createCollection: async name => {
    const record = await createCollectionRecord(name);
    if (!record) return null;
    set(state => ({ collections: [...state.collections, record] }));
    return record;
  },
  renameCollection: async (id, name) => {
    await renameCollectionRecord(id, name);
    const trimmed = name.trim();
    if (!trimmed) return;
    set(state => ({ collections: state.collections.map(c => (c.id === id ? { ...c, name: trimmed } : c)) }));
  },
  deleteCollection: async id => {
    const removedIds = get().collections.find(c => c.id === id)?.memberIds ?? [];
    await deleteCollectionRecord(id);
    const nextCollections = get().collections.filter(c => c.id !== id);
    // eliberam originalele pastrate DOAR pentru acest folder (vezi
    // persistOriginalForCollectionMember) — cele ale pozelor si 'selected',
    // sau membre in alt folder, raman neatinse (cleanupOrphanedOriginal verifica).
    await Promise.all(removedIds.map(pid => cleanupOrphanedOriginal(pid, nextCollections)));
    set(state => ({
      collections: nextCollections,
      collectionFilter: state.collectionFilter === id ? null : state.collectionFilter
    }));
  },
  addPhotosToCollection: async (id, photoIds) => {
    if (!photoIds.length) return;
    const updated = await addPhotosToCollectionRecord(id, photoIds);
    if (!updated) return;
    // Bug real raportat de utilizator: fara asta, o poza NEselectata adaugata
    // intr-un folder nu avea originalul persistat, deci exportul acelui
    // folder nu gasea nimic (vezi comentariul syncOriginal/exportCollection).
    await Promise.all(photoIds.map(pid => persistOriginalForCollectionMember(pid)));
    const locale = get().locale;
    set(state => ({
      collections: state.collections.map(c => (c.id === id ? updated : c)),
      notice: t(locale, 'store.collections.added', { count: photoIds.length, name: updated.name })
    }));
  },
  removePhotosFromCollection: async (id, photoIds) => {
    if (!photoIds.length) return;
    const updated = await removePhotosFromCollectionRecord(id, photoIds);
    if (!updated) return;
    const nextCollections = get().collections.map(c => (c.id === id ? updated : c));
    await Promise.all(photoIds.map(pid => cleanupOrphanedOriginal(pid, nextCollections)));
    set({ collections: nextCollections });
  },
  savedFilters: readSavedFilters(),
  saveCurrentFiltersAsPreset: name => {
    const trimmed = name.trim();
    if (!trimmed) return null;
    const state = get();
    // Nu salvam un preset "gol" (fara niciun filtru secundar activ) — n-ar
    // face nimic la reaplicare, doar ar aglomera lista degeaba.
    const hasSomethingToSave = !!state.personFilter || !!state.colorLabelFilter || !!state.sceneTagFilter ||
      !!state.cameraFilter || !!state.projectFilter || !!state.searchText || state.minRating > 0;
    if (!hasSomethingToSave) return null;
    const preset: SavedFilterPreset = {
      id: crypto.randomUUID(), name: trimmed, createdAt: Date.now(),
      personFilter: state.personFilter, colorLabelFilter: state.colorLabelFilter, sceneTagFilter: state.sceneTagFilter,
      cameraFilter: state.cameraFilter, projectFilter: state.projectFilter, searchText: state.searchText, minRating: state.minRating
    };
    const next = [...state.savedFilters, preset];
    writeSavedFilters(next);
    set({ savedFilters: next });
    return preset;
  },
  applySavedFilterPreset: id => {
    const preset = get().savedFilters.find(p => p.id === id);
    if (!preset) return;
    set({
      personFilter: preset.personFilter, colorLabelFilter: preset.colorLabelFilter, sceneTagFilter: preset.sceneTagFilter,
      cameraFilter: preset.cameraFilter, projectFilter: preset.projectFilter, searchText: preset.searchText, minRating: preset.minRating
    });
  },
  deleteSavedFilterPreset: id => {
    const next = get().savedFilters.filter(p => p.id !== id);
    writeSavedFilters(next);
    set({ savedFilters: next });
  },
  searchText: '',
  dateFrom: null,
  dateTo: null,
  minRating: 0,
  detailId: null,
  compareGroupId: null,
  editingPhotoId: null,
  editAutoApplyRequested: false,
  personsOpen: false,
  menuOpen: false,
  insightsOpen: false,
  // Grila (cu CullGauge + progresul "Analiza AI X/N") e ecranul principal la
  // pornire SI in timpul importului — feedback direct de la utilizator: cu
  // Workspace implicit (varianta veche, comentariul de mai sus), importul
  // sarea direct in lupa (vizibil mai greu/lent cu poze in curs de streaming)
  // fara sa mai poata vedea progresul general, iar Workspace ramanea greu de
  // parasit pana la final. Lupa ramane un mod optional, pornit explicit din
  // grila (butonul Focus) sau din statisticul "de verificat" (startQuickReview).
  workspaceMode: false,
  batchOpsOpen: false,
  paletteOpen: false,
  shortcutsOpen: false,
  theme: readStoredTheme(),
  setTheme: theme => { applyTheme(theme); set({ theme }); },
  locale: readStoredLocale(),
  setLocale: locale => { writeStoredLocale(locale); applyLocale(locale); set({ locale }); },
  projectName: readStoredProjectName(),
  setProjectName: name => { writeProjectName(name); set({ projectName: name }); },
  watermarkText: readStoredWatermarkText(),
  setWatermarkText: text => { writeWatermarkText(text); set({ watermarkText: text }); },
  applyEditsInGallery: readApplyEditsInGallery(),
  setApplyEditsInGallery: value => { writeApplyEditsInGallery(value); set({ applyEditsInGallery: value }); },
  booted: false,
  aiDegraded: false,
  aiBackend: '',
  notice: null,
  history: [],
  multiSelectIds: new Set(),
  multiSelectAnchor: null,
  selectMode: false,
  batchHistory: [],
  fieldBatchHistory: [],
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

  renameTemplate: readStoredRenameTemplate(),
  setRenameTemplate: template => { writeStoredRenameTemplate(template); set({ renameTemplate: template }); },
  lastImportStats: null,
  monthlyUsage: readMonthlyUsage(),
  statsOpen: false,
  setStatsOpen: open => set({ statsOpen: open }),
  contactSheetOpen: false,
  setContactSheetOpen: open => set({ contactSheetOpen: open }),
  presentationOpen: false,
  setPresentationOpen: open => set({ presentationOpen: open }),

  exportBackup: async () => {
    const data = await buildBackup();
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    const result = await downloadBlob(backupFileName(), blob);
    if (result.cancelled) return;
    writeLastBackupAt(Date.now());
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
        // restoreBackup() a scris deja setarile in localStorage (daca backup-ul le avea) —
        // le re-citim aici ca sa reflecte imediat in UI, fara reload de pagina
        ...(result.settingsRestored ? {
          gridSort: readGridSort(),
          gridDensity: readGridDensity(),
          genre: readStoredGenre(),
          applyEditsInGallery: readApplyEditsInGallery(),
          watermarkText: readStoredWatermarkText(),
          projectName: readStoredProjectName(),
          renameTemplate: readStoredRenameTemplate()
        } : {}),
        notice: t(locale, 'store.backup.restored', { persons: result.personsRestored, models: result.modelsRestored }) +
          (result.decisionsTotal > 0
            ? t(locale, 'store.backup.restored.withDecisions', { matched: result.decisionsMatched, total: result.decisionsTotal })
            : t(locale, 'store.backup.restored.noDecisions')) +
          (result.settingsRestored ? t(locale, 'store.backup.restored.withSettings') : '')
      });
    } catch (err) {
      set({ notice: t(locale, 'store.backup.restoreFailed', { error: err instanceof Error ? err.message : String(err) }) });
    }
  },

  importClientFeedback: async (file: File) => {
    const locale = get().locale;
    try {
      const data = await parseClientFeedbackFile(file);
      const currentPhotos = get().photos;
      const byId = new Map(currentPhotos.map(p => [p.id, p]));
      const byFileName = new Map<string, PhotoView[]>();
      for (const p of currentPhotos) {
        const bucket = byFileName.get(p.fileName);
        if (bucket) bucket.push(p); else byFileName.set(p.fileName, [p]);
      }
      // potrivire pe id (stabil intre export si import — pozele raman in DB,
      // nu trec printr-un reimport ca la backup), cu fallback pe nume de
      // fisier doar cand id-ul nu se mai gaseste (ex. poza stearsa si
      // reimportata intre timp, primeste un id nou)
      const matches: { id: string; decision: 'like' | 'dislike' }[] = [];
      const seen = new Set<string>();
      for (const entry of data.photos) {
        const direct = byId.get(entry.id);
        const targets = direct ? [direct] : (byFileName.get(entry.fileName) ?? []);
        for (const target of targets) {
          if (seen.has(target.id)) continue;
          seen.add(target.id);
          matches.push({ id: target.id, decision: entry.decision });
        }
      }
      if (!matches.length) {
        set({ notice: t(locale, 'store.clientFeedback.noMatch') });
        return;
      }
      await db.transaction('rw', [db.photos], async () => {
        for (const m of matches) await db.photos.update(m.id, { clientFeedback: m.decision });
      });
      const views = await reloadPhotoViews();
      set({ photos: views });
      // antrenam ContextEngine exact ca la o decizie normala a fotografului
      // (train(), vezi setStatus) — secvential (nu in paralel, acelasi motiv
      // documentat langa runAutoCull: SGD-ul global nu e sigur de antrenat concurent)
      // si FARA toast per poza (la fel ca actiunile in masa, vezi setStatus)
      for (const m of matches) await train(m.id, m.decision === 'like');
      set({ notice: t(locale, 'store.clientFeedback.imported', { matched: matches.length, total: data.photos.length }) });
    } catch (err) {
      set({ notice: t(locale, 'store.clientFeedback.failed', { error: err instanceof Error ? err.message : String(err) }) });
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
    const applyEdits = get().applyEditsInGallery;
    const selected = get().photos.filter(p => p.status === 'selected');
    if (!selected.length) { set({ notice: t(locale, 'store.clientGallery.noSelection') }); return; }
    try {
      const thumbnails = await Promise.all(selected.map(p => db.thumbnails.get(p.id)));
      const items = (await Promise.all(selected.map(async (p, i) => {
        const raw = thumbnails[i]?.blob;
        if (!raw) return undefined;
        // "doar daca se vrea" — implicit galeria arata miniatura neatinsa; coacem
        // ajustarile de baza (EditPanel) DOAR cand fotograful a activat explicit
        // acest lucru, ca sa nu surprindem un export cu poze aratand diferit fata
        // de ce se vede in restul aplicatiei fara sa fie o decizie constienta.
        const thumbnail = applyEdits && p.edits ? await applyAdjustmentsToBlob(raw, p.edits) : raw;
        return { id: p.id, fileName: p.fileName, thumbnail };
      }))).filter((it): it is { id: string; fileName: string; thumbnail: Blob } => !!it);
      const title = get().projectName ? t(locale, 'store.clientGallery.title', { project: get().projectName }) : t(locale, 'store.clientGallery.titleDefault');
      const subtitle = t(locale, 'store.clientGallery.subtitle', { count: items.length, date: new Date().toLocaleDateString() });
      const html = await buildClientGalleryHtml(items, title, get().watermarkText.trim() || undefined, subtitle);
      const blob = new Blob([html], { type: 'text/html' });
      const result = await downloadBlob(`lumin-culler-galerie-client-${new Date().toISOString().slice(0, 10)}.html`, blob);
      if (result.cancelled) return;
      set({ notice: t(locale, 'store.clientGallery.generated', { count: items.length }) });
    } catch (err) {
      set({ notice: t(locale, 'store.clientGallery.failed', { error: err instanceof Error ? err.message : String(err) }) });
    }
  },

  cancelImport: () => {
    if (!activeCancelToken) return;
    activeCancelToken.cancelled = true;
    set({ importCancelling: true });
  },

  boot: async () => {
    if (get().booted) return;
    try {
      const [views, persons, history, collections] = await Promise.all([
        reloadPhotoViews(),
        db.persons.toArray(),
        db.history.orderBy('ts').toArray(),
        loadCollections()
      ]);
      set({ photos: views, persons, history, collections, booted: true });
    } catch (err) {
      // Deschiderea IndexedDB poate esua (schema stricata, VersionError dupa un update
      // al aplicatiei, storage blocat de politici de dispozitiv) — bug real gasit de
      // auditul QA: fara acest catch, o respingere neprinsa lasa `booted` mereu false si
      // grila goala, nedistinctibil in UI de "nu a importat nimeni nimic inca" (un
      // utilizator putea crede ca a pierdut toata biblioteca importata anterior).
      set({ notice: t(get().locale, 'store.boot.failed', { error: err instanceof Error ? err.message : String(err) }) });
    }
  },

  runImport: async (files: File[], handles?: (FileSystemFileHandleLike | undefined)[]) => {
    // Bug real gasit de auditul QA: fara aceasta garda, un al doilea import
    // pornit inainte ca primul sa se termine suprascria activeCancelToken —
    // "Anuleaza" nu mai putea opri decat importul cel mai recent, primul
    // continuand la nesfarsit fara nicio cale din UI de a-l opri, iar
    // `progress` (o singura bara/contor) sarea imprevizibil intre done/total-ul
    // celor doua importuri nelegate. Un al doilea import trebuie sa astepte,
    // nu sa concureze cu primul pe aceeasi stare globala.
    if (activeCancelToken) {
      set({ notice: t(get().locale, 'store.import.alreadyRunning') });
      return;
    }
    set({ progress: { done: 0, total: files.length, fileName: '', phase: 'incarcare' }, importCancelling: false });
    let warning: string | undefined;
    let done = 0;
    const startedAt = Date.now();
    // separat de `startedAt` (folosit pentru lastImportStats, care include si
    // faza 'incarcare' de dinainte de bucla) — vrem rata reala doar din faza
    // 'analiza', altfel primele tick-uri ar subestima rata si ar umfla ETA-ul
    let analysisStartedAt: number | null = null;
    const cancelToken = createCancelToken();
    activeCancelToken = cancelToken;
    // Bug real gasit de auditul QA (raportat de utilizator: "abia incarca poze"
    // la 500+ poze): onPhoto ruleaza per-poza, din workeri paraleli care termina
    // in tick-uri separate — React nu poate grupa automat aceste update-uri
    // (batching-ul nu trece de un await). Un set() per poza reconstruia INTREG
    // array-ul `photos` de fiecare data, invalidand cache-ul din filtered()/
    // secondaryFiltered() (comparatie c.photos === photos) si retrigger-uind
    // cele 8 treceri complete din `counts` (App.tsx) — costul cumulat pe
    // parcursul unui import creste aproape patratic cu numarul de poze.
    // Bufferizam si aplicam in loturi (la fiecare PHOTO_FLUSH_BATCH poze SAU
    // la fiecare PHOTO_FLUSH_INTERVAL_MS, ce vine primul) — cardurile tot apar
    // treptat (senzatia de progres "live" nu se pierde), doar reconstruirea
    // array-ului se intampla de un ordin de marime mai rar.
    let pendingPhotos: PhotoView[] = [];
    let flushTimer: ReturnType<typeof setTimeout> | null = null;
    const flushPendingPhotos = () => {
      if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
      if (!pendingPhotos.length) return;
      const batch = pendingPhotos;
      pendingPhotos = [];
      set(state => ({ photos: [...state.photos, ...batch] }));
    };
    const PHOTO_FLUSH_BATCH = 15;
    const PHOTO_FLUSH_INTERVAL_MS = 200;
    try {
      await importFiles(
        files,
        progress => {
          warning = progress.warning; done = progress.done;
          let etaSeconds: number | undefined;
          if (progress.phase === 'analiza') {
            if (analysisStartedAt === null) analysisStartedAt = Date.now();
            const elapsedSec = (Date.now() - analysisStartedAt) / 1000;
            const remaining = progress.total - progress.done;
            // sub 1s scursa sau 0 poze gata => rata nu inseamna inca nimic (ar
            // da un ETA fals de precis din 1-2 tick-uri) — asteptam date reale
            if (elapsedSec > 1 && progress.done > 0 && remaining > 0) {
              etaSeconds = (elapsedSec / progress.done) * remaining;
            }
          }
          set({ progress: { ...progress, etaSeconds } });
        },
        item => {
          pendingPhotos.push(toView(item.photo, item.analysis));
          if (pendingPhotos.length >= PHOTO_FLUSH_BATCH) { flushPendingPhotos(); return; }
          if (!flushTimer) flushTimer = setTimeout(flushPendingPhotos, PHOTO_FLUSH_INTERVAL_MS);
        },
        cancelToken,
        get().genre,
        get().projectName,
        handles
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
      // flush necesar pe ORICE cale de iesire (succes, eroare, anulare) — altfel
      // ultimele poze bufferizate (deja scrise in IndexedDB de processOne) ar
      // ramane invizibile in UI pana la un reload, desi nu s-au pierdut din DB.
      flushPendingPhotos();
      if (activeCancelToken === cancelToken) activeCancelToken = null;
      set({ importCancelling: false });
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
    // fara asta, dupa un import reusit fara avertismente, utilizatorul nu primea
    // NICIO confirmare vizibila ca s-a intamplat ceva — bara de progres disparea
    // pur si simplu, fara mesaj, indiferent daca importul reusise sau nu; doar
    // erorile/avertismentele aveau notificare, nu si succesul simplu, comun
    const doneNotice = done > 0 ? t(get().locale, 'store.import.done', { count: done }) : undefined;
    set(state => ({
      progress: null,
      notice: warning ?? usageNotice ?? doneNotice ?? state.notice,
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
    const isRealChange = (status === 'selected' || status === 'rejected') && status !== previousStatus;
    // Feedback haptic pentru ORICE decizie (tastatura, butoane tap, swipe) — bug real gasit
    // de auditul QA: inainte, doar gestul de swipe din DetailView vibra; utilizatorii care
    // apasa butoanele mari Selecteaza/Respinge (probabil majoritatea pe telefon, swipe-ul
    // cere mai multa precizie) nu primeau niciodata confirmarea haptica.
    if (isRealChange) {
      vibrate(status === 'selected' ? 14 : [12, 40, 12]);
    }
    await db.photos.update(id, { status });
    set(state => ({ photos: state.photos.map(p => (p.id === id ? { ...p, status } : p)) }));
    const { quotaError } = await syncOriginal(id, status);
    if (quotaError) set({ notice: quotaNotice(get().locale) });
    if (status === 'selected' || status === 'rejected') {
      const { topShift } = await train(id, status === 'selected');
      // Cerinta directa a utilizatorului: un mic toast IMEDIAT dupa o corectie
      // reala ("Am invatat: X"), distinct de panoul agregat "Preferinte AI"
      // (InsightsPanel, deschis manual) — vezi ContextEngine.recordCorrection
      // pentru cand chiar exista un topShift (doar la un dezacord real AI/
      // utilizator, cu o schimbare de pondere suficient de mare). Scop DELIBERAT
      // restrans la aceasta cale (decizia P/X unica, cea mai frecventa
      // interactie) — actiunile in masa/de grup NU trec prin setStatus, deci
      // nu pot inunda utilizatorul cu un toast per poza dintr-un lot de sute.
      // Nu suprascriem un avertisment de cota (mai urgent), si nu aratam nimic
      // pentru o re-confirmare a aceluiasi status (isRealChange).
      if (topShift && isRealChange && !quotaError) {
        set({ notice: t(get().locale, 'store.learned.toast', { label: topShift.label }) });
      }
    }
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

  setColorLabel: async (id, label) => {
    await db.photos.update(id, { colorLabel: label });
    set(state => ({ photos: state.photos.map(p => (p.id === id ? { ...p, colorLabel: label } : p)) }));
  },

  setEditAdjustments: async (id, adjustments) => {
    const neutral = isNeutral(adjustments);
    // absent (nu {toate 0}) pe neutru — coerent cu restul campurilor optionale
    // (colorLabel 'none', genre absent) si evita sa "poluam" fiecare poza cu un
    // obiect gol dupa un simplu Reseteaza fara nicio ajustare reala facuta
    await db.photos.update(id, { edits: neutral ? undefined : adjustments });
    set(state => ({
      photos: state.photos.map(p => (p.id === id ? { ...p, edits: neutral ? undefined : adjustments } : p))
    }));
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
    const { history, batchHistory, fieldBatchHistory, locale } = get();
    const lastSingleTs = history.length ? history[history.length - 1].ts : -1;
    const lastBatchTs = batchHistory.length ? batchHistory[batchHistory.length - 1].ts : -1;
    const lastFieldTs = fieldBatchHistory.length ? fieldBatchHistory[fieldBatchHistory.length - 1].ts : -1;
    if (lastSingleTs === -1 && lastBatchTs === -1 && lastFieldTs === -1) { set({ notice: t(locale, 'store.undo.nothing') }); return; }

    if (lastFieldTs > lastSingleTs && lastFieldTs > lastBatchTs) {
      const { event, rest } = popBatchHistory(fieldBatchHistory);
      if (!event) return;
      set({ fieldBatchHistory: rest });
      const field = event.field;
      await Promise.all(event.changes.map(c => {
        switch (field) {
          case 'rating': return db.photos.update(c.photoId, { rating: c.previousValue as number });
          case 'colorLabel': return db.photos.update(c.photoId, { colorLabel: c.previousValue as ColorLabel });
          case 'captionOverride': return db.photos.update(c.photoId, { captionOverride: c.previousValue as string | undefined });
          case 'keywordsOverride': return db.photos.update(c.photoId, { keywordsOverride: c.previousValue as string[] | undefined });
        }
      }));
      const changed = new Map(event.changes.map(c => [c.photoId, c.previousValue]));
      if (field === 'captionOverride' || field === 'keywordsOverride') {
        // iptcCaption/iptcKeywords in PhotoView cad pe valoarea parsata din
        // fisier cand nu exista suprascriere (vezi toView) — o revenire la
        // "fara suprascriere" (previousValue undefined) trebuie sa refaca
        // exact acel fallback, nu doar sa goleasca afisajul.
        const ids = event.changes.map(c => c.photoId);
        const analyses = await db.analyses.bulkGet(ids);
        const analysisById = new Map(ids.map((id, i) => [id, analyses[i]]));
        set(state => ({
          photos: state.photos.map(p => {
            if (!changed.has(p.id)) return p;
            const prev = changed.get(p.id);
            const analysis = analysisById.get(p.id);
            return field === 'captionOverride'
              ? { ...p, iptcCaption: (prev as string | undefined) ?? analysis?.iptcCaption }
              : { ...p, iptcKeywords: (prev as string[] | undefined) ?? analysis?.iptcKeywords };
          })
        }));
      } else {
        set(state => ({
          photos: state.photos.map(p => {
            if (!changed.has(p.id)) return p;
            const prev = changed.get(p.id);
            return field === 'rating'
              ? { ...p, rating: (prev as number | undefined) ?? 0 }
              : { ...p, colorLabel: prev as ColorLabel | undefined };
          })
        }));
      }
      set({ notice: t(locale, 'store.undo.batch', { label: event.label, count: event.changes.length }) });
      return;
    }

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
    const { quotaError } = await applyBulkStatusChanges(
      targets.map(p => ({ id: p.id, status: 'rejected' as const })),
      () => false
    );
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
    // Bug real gasit de auditul QA (bug/low): un Array.find() pe intreaga lista
    // in interiorul buclei (si al buclei imbricate de rejectIds) era O(n) per
    // cautare — O(M*n) in total pentru M membri de serie, real O(n^2) cand
    // majoritatea bibliotecii e grupata in serii (exact scenariul burst/sport/
    // nunta pe care aplicatia il tinteste). `photos` nu se schimba in timpul
    // buclei (set() vine abia dupa), deci un singur Map construit o data e
    // sigur si suficient.
    const photosById = new Map(get().photos.map(p => [p.id, p]));
    const changes: { photoId: string; previousStatus: PhotoRecord['status'] }[] = [];
    const statusChanges: { id: string; status: PhotoRecord['status'] }[] = [];
    for (const g of resolutions) {
      const current = photosById.get(g.keepId);
      if (current?.status !== 'selected') {
        changes.push({ photoId: g.keepId, previousStatus: current?.status ?? 'pending' });
        statusChanges.push({ id: g.keepId, status: 'selected' });
      }
      for (const rejectId of g.rejectIds) {
        const rec = photosById.get(rejectId);
        if (rec?.status === 'rejected') continue; // deja rezolvat, sarim (evita re-antrenare redundanta)
        changes.push({ photoId: rejectId, previousStatus: rec?.status ?? 'pending' });
        statusChanges.push({ id: rejectId, status: 'rejected' });
      }
    }
    const { quotaError } = await applyBulkStatusChanges(statusChanges, status => status === 'selected');
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
    const { quotaError } = await applyBulkStatusChanges(
      [
        ...selectIds.map(id => ({ id, status: 'selected' as const })),
        ...rejectIds.map(id => ({ id, status: 'rejected' as const }))
      ],
      status => status === 'selected'
    );
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

  /**
   * NU antreneaza ContextEngine (train()) — spre deosebire de celelalte
   * operatii in masa. Aici noua stare vine DIN modelul curent (newStatus
   * derivat direct din prediction.score cu acelasi prag ca la import), deci
   * "aiDecision" din train() ar fi mereu identic cu "userDecision" prin
   * constructie — un gradient de eroare zero, fara semnal real de invatare,
   * care ar creste artificial sampleCount si ar polua statisticile de
   * normalizare Welford cu aceeasi analiza numarata a doua oara.
   */
  rescorePhotos: async () => {
    const locale = get().locale;
    const photos = get().photos;
    const changes: { photoId: string; previousStatus: PhotoRecord['status'] }[] = [];
    const updates = new Map<string, { aiScore: number; aiFactors: { feature: string; contribution: number }[]; status: PhotoRecord['status'] }>();
    let quotaError = false;

    // Predictiile (fara efecte secundare — vezi comentariul de mai sus, rescorePhotos
    // nu antreneaza modelul) si scrierile in DB ruleaza in paralel per poza, nu secvential
    // ca inainte — bug de scalabilitate real gasit de auditul QA: re-analiza pe o
    // biblioteca de 500+ poze facea sute de dute-vino DB secvential, blocand UI-ul cateva
    // secunde bune, exact clasa de bug deja reparata pentru applyBulkStatusChanges.
    await Promise.all(photos.map(async p => {
      const [analysis, photoRecord] = await Promise.all([db.analyses.get(p.id), db.photos.get(p.id)]);
      if (!analysis || !photoRecord) return;
      const prediction = await contextEngine.predict(analysis, photoRecord.genre);
      const newStatus = decidePhotoStatus(prediction.score, analysis);
      await db.analyses.update(p.id, { aiScore: prediction.score, aiFactors: prediction.topFactors });
      if (newStatus !== photoRecord.status) {
        changes.push({ photoId: p.id, previousStatus: photoRecord.status });
        await db.photos.update(p.id, { status: newStatus });
        const res = await syncOriginal(p.id, newStatus);
        if (res.quotaError) quotaError = true;
      }
      updates.set(p.id, { aiScore: prediction.score, aiFactors: prediction.topFactors, status: newStatus });
    }));

    set(state => ({
      photos: state.photos.map(p => {
        const u = updates.get(p.id);
        return u ? { ...p, aiScore: u.aiScore, aiFactors: u.aiFactors, status: u.status } : p;
      }),
      batchHistory: changes.length
        ? pushBatchHistory(state.batchHistory, makeBatchEvent(t(locale, 'store.batchEvent.rescore', { count: changes.length }), changes))
        : state.batchHistory,
      notice: quotaError ? quotaNotice(locale) : t(locale, 'store.rescore.notice', { total: photos.length, changed: changes.length })
    }));
    return { total: photos.length, changed: changes.length };
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
    const { quotaError } = await applyBulkStatusChanges(
      ids.map(id => ({ id, status })),
      s => (s === 'selected' || s === 'rejected') ? s === 'selected' : null
    );
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
    // Bug real gasit de auditul QA: editarile in masa de mai jos (rating/
    // eticheta de culoare/descriere/cuvinte cheie) suprascriau valorile FARA
    // nicio urma de undo — Ctrl+Z fie nu gasea nimic de anulat, fie anula din
    // greseala o alta actiune neconexa aflata deja pe `batchHistory`.
    // Capturam valorile ANTERIOARE direct din PhotoRecord (nu din PhotoView
    // derivat) ca sa le putem scrie identic inapoi la undo().
    const prevRecords = await db.photos.bulkGet(ids);
    const changes = ids.map((id, i) => ({ photoId: id, previousValue: prevRecords[i]?.rating ?? 0 }));
    await Promise.all(ids.map(id => db.photos.update(id, { rating: clamped })));
    const idSet = new Set(ids);
    const locale = get().locale;
    set(state => ({
      photos: state.photos.map(p => (idSet.has(p.id) ? { ...p, rating: clamped } : p)),
      multiSelectIds: new Set(),
      multiSelectAnchor: null,
      fieldBatchHistory: pushBatchHistory(
        state.fieldBatchHistory,
        makeFieldBatchEvent(t(locale, 'store.batchEvent.bulkRating', { count: ids.length }), 'rating', changes)
      ),
      notice: t(locale, 'store.bulkRating.notice', {
        count: ids.length,
        rating: clamped > 0 ? t(locale, 'store.bulkRating.stars', { n: clamped }) : t(locale, 'store.bulkRating.cleared')
      })
    }));
  },

  bulkSetColorLabelForSelection: async label => {
    const ids = Array.from(get().multiSelectIds);
    if (!ids.length) return;
    const prevRecords = await db.photos.bulkGet(ids);
    const changes = ids.map((id, i) => ({ photoId: id, previousValue: prevRecords[i]?.colorLabel ?? 'none' as ColorLabel }));
    await Promise.all(ids.map(id => db.photos.update(id, { colorLabel: label })));
    const idSet = new Set(ids);
    const locale = get().locale;
    set(state => ({
      photos: state.photos.map(p => (idSet.has(p.id) ? { ...p, colorLabel: label } : p)),
      multiSelectIds: new Set(),
      multiSelectAnchor: null,
      fieldBatchHistory: pushBatchHistory(
        state.fieldBatchHistory,
        makeFieldBatchEvent(t(locale, 'store.batchEvent.bulkColorLabel', { count: ids.length }), 'colorLabel', changes)
      ),
      notice: t(locale, 'store.bulkColorLabel.notice', { count: ids.length, label: t(locale, `colorLabel.${label}`) })
    }));
  },

  bulkSetCaptionForSelection: async caption => {
    const ids = Array.from(get().multiSelectIds);
    if (!ids.length) return;
    const prevRecords = await db.photos.bulkGet(ids);
    const changes = ids.map((id, i) => ({ photoId: id, previousValue: prevRecords[i]?.captionOverride }));
    await Promise.all(ids.map(id => db.photos.update(id, { captionOverride: caption })));
    const idSet = new Set(ids);
    const locale = get().locale;
    set(state => ({
      photos: state.photos.map(p => (idSet.has(p.id) ? { ...p, iptcCaption: caption } : p)),
      multiSelectIds: new Set(),
      multiSelectAnchor: null,
      fieldBatchHistory: pushBatchHistory(
        state.fieldBatchHistory,
        makeFieldBatchEvent(t(locale, 'store.batchEvent.bulkCaption', { count: ids.length }), 'captionOverride', changes)
      ),
      notice: t(locale, 'store.bulkCaption.notice', { count: ids.length })
    }));
  },

  bulkSetKeywordsForSelection: async keywords => {
    const ids = Array.from(get().multiSelectIds);
    if (!ids.length) return;
    const prevRecords = await db.photos.bulkGet(ids);
    const changes = ids.map((id, i) => ({ photoId: id, previousValue: prevRecords[i]?.keywordsOverride }));
    await Promise.all(ids.map(id => db.photos.update(id, { keywordsOverride: keywords })));
    const idSet = new Set(ids);
    const locale = get().locale;
    set(state => ({
      photos: state.photos.map(p => (idSet.has(p.id) ? { ...p, iptcKeywords: keywords } : p)),
      multiSelectIds: new Set(),
      multiSelectAnchor: null,
      fieldBatchHistory: pushBatchHistory(
        state.fieldBatchHistory,
        makeFieldBatchEvent(t(locale, 'store.batchEvent.bulkKeywords', { count: ids.length }), 'keywordsOverride', changes)
      ),
      notice: t(locale, 'store.bulkKeywords.notice', { count: ids.length })
    }));
  },

  setFilter: f => set({ filter: f }),
  startQuickReview: () => {
    set({ filter: 'review' });
    get().setWorkspaceMode(true);
  },
  setPersonFilter: name => set({ personFilter: name }),
  colorLabelFilter: null,
  setColorLabelFilter: label => set({ colorLabelFilter: label }),
  sceneTagFilter: null,
  setSceneTagFilter: tag => set({ sceneTagFilter: tag }),
  cameraFilter: null,
  setCameraFilter: camera => set({ cameraFilter: camera }),
  setSearchText: text => set({ searchText: text }),
  setDateRange: (from, to) => set({ dateFrom: from, dateTo: to }),
  setMinRating: rating => set({ minRating: rating }),
  clearAdvancedFilters: () => set({ searchText: '', dateFrom: null, dateTo: null, minRating: 0 }),
  clearAllFilters: () => set({
    personFilter: null, colorLabelFilter: null, sceneTagFilter: null, cameraFilter: null,
    projectFilter: null, collectionFilter: null,
    searchText: '', dateFrom: null, dateTo: null, minRating: 0
  }),
  openDetail: id => set({ detailId: id }),
  openCompare: groupId => set({ compareGroupId: groupId }),
  openEdit: (id, opts) => set({ editingPhotoId: id, editAutoApplyRequested: !!opts?.autoApply }),

  stepDetail: dir => {
    const { detailId } = get();
    const list = get().filtered();
    if (!detailId || !list.length) return;
    const idx = list.findIndex(p => p.id === detailId);
    // detailId poate sa nu mai fie in lista filtrata curenta (ex. utilizatorul a
    // schimbat filtrul cat timp Detail/Workspace era deschis pe o poza din afara
    // noului filtru) — bug real gasit de auditul QA: fara aceasta garda,
    // (idx + dir + list.length) % list.length cadea mereu pe 0 pentru dir=1,
    // sarind silentios la PRIMA poza din lista in loc de un "next" sensibil.
    if (idx === -1) { set({ detailId: list[0].id }); return; }
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
    // Bug real gasit de auditul QA: cand o poza de referinta continea mai
    // multe fete (o poza de grup/familie, plauzibil daca utilizatorul nu e
    // atent la ce alege), codul alegea silentios fata cea mai mare, fara
    // nicio confirmare — un strain aflat intamplator mai aproape de camera
    // putea ajunge inrolat sub numele gresit, cauzand recunoasteri false-
    // pozitive ulterioare. Nu construim aici o interfata de decupare/alegere
    // (ar fi un fix mult mai mare ca domeniu) — dar facem alegerea VIZIBILA,
    // ca utilizatorul sa poata verifica/corecta imediat daca a fost gresita.
    let multiface = 0;
    for (const file of files.slice(0, MAX_PERSON_REFERENCE_FILES)) {
      try {
        const bitmap = await createImageBitmap(file, { resizeWidth: 1024 } as ImageBitmapOptions);
        const result = await analysisPool.computeEnrollmentEmbedding(bitmap);
        if (result?.embedding.length) {
          embeddings.push(result.embedding);
          if (result.faceCount > 1) multiface++;
        }
      } catch (err) {
        console.error('Inrolare esuata:', err);
      }
    }
    if (!embeddings.length) {
      return { ok: false, message: 'Nicio fata detectata in pozele de referinta. Alege poze clare, frontale.' };
    }
    const skipped = Math.max(0, files.length - MAX_PERSON_REFERENCE_FILES);
    const skippedSuffix = skipped > 0 ? ` (${skipped} poze ignorate, plafon ${MAX_PERSON_REFERENCE_FILES} per inrolare)` : '';
    const multifaceSuffix = multiface > 0
      ? ` Atentie: ${multiface} ${multiface === 1 ? 'poza a continut' : 'poze au continut'} mai multe fete — s-a folosit automat cea mai mare din cadru; verifica daca e persoana corecta.`
      : '';
    const trimmedName = name.trim();
    const existing = get().persons.find(p => p.name.trim().toLowerCase() === trimmedName.toLowerCase());
    let person: KnownPerson;
    let message: string;
    if (existing) {
      // pastram doar cele mai RECENTE MAX_PERSON_EMBEDDINGS referinte — trasaturile
      // vechi de acum multe luni conteaza mai putin decat cele actuale la recunoastere
      const merged = [...existing.embeddings, ...embeddings].slice(-MAX_PERSON_EMBEDDINGS);
      person = { ...existing, embeddings: merged, updatedAt: Date.now() };
      message = `${trimmedName}: +${embeddings.length} referinte noi adaugate la profilul existent (total ${merged.length}).${skippedSuffix}${multifaceSuffix}`;
    } else {
      person = { id: crypto.randomUUID(), name: trimmedName, embeddings, updatedAt: Date.now() };
      message = trimmedName + ': ' + embeddings.length + ' referinte salvate.' + skippedSuffix + multifaceSuffix;
    }
    await db.persons.put(person);
    const persons = await db.persons.toArray();
    await analysisPool.setKnownPersons(persons);
    set({ persons });
    return { ok: true, message };
  },

  removePerson: async id => {
    // db.persons.delete + relabelAnalyses erau doua scrieri separate, neatomice —
    // bug real gasit de auditul QA: o inchidere a aplicatiei intre ele lasa fete
    // in db.analyses care mai pointau spre un personId deja sters (desincronizare
    // permanenta, la fel ca non-atomicitatea deja reparata pentru restoreBackup).
    await db.transaction('rw', [db.persons, db.analyses], async () => {
      await db.persons.delete(id);
      await relabelAnalyses(new Map([[id, null]]));
    });
    const [persons, photos] = await Promise.all([db.persons.toArray(), reloadPhotoViews()]);
    await analysisPool.setKnownPersons(persons).catch(() => {});
    set({ persons, photos });
  },

  removePersons: async ids => {
    if (!ids.length) return;
    await db.transaction('rw', [db.persons, db.analyses], async () => {
      await db.persons.bulkDelete(ids);
      await relabelAnalyses(new Map(ids.map(id => [id, null])));
    });
    const [persons, photos] = await Promise.all([db.persons.toArray(), reloadPhotoViews()]);
    await analysisPool.setKnownPersons(persons).catch(() => {});
    set({ persons, photos });
  },

  mergePersons: async (ids, keepName) => {
    const toMerge = get().persons.filter(p => ids.includes(p.id));
    if (toMerge.length < 2) return;
    // vezi selectMergedEmbeddings mai sus pentru motivul pentru care nu mai e o
    // simpla concatenare + tail-slice (bug real gasit de auditul QA)
    const merged = selectMergedEmbeddings(toMerge.map(p => p.embeddings), MAX_PERSON_EMBEDDINGS);
    const survivor: KnownPerson = { id: toMerge[0].id, name: keepName.trim() || toMerge[0].name, embeddings: merged, updatedAt: Date.now() };
    // Aceleasi 3 scrieri (persons.put, persons.bulkDelete, relabelAnalyses) intr-o
    // singura tranzactie — o intrerupere la mijloc putea lasa supravietuitorul scris
    // dar profilurile unite nesterse, sau fete inca legate de un id deja disparut.
    await db.transaction('rw', [db.persons, db.analyses], async () => {
      await db.persons.put(survivor);
      await db.persons.bulkDelete(toMerge.slice(1).map(p => p.id));
      // re-eticheteaza RETROACTIV pozele deja analizate: fiecare id unit (inclusiv
      // id-ul supravietuitor, in caz ca numele s-a schimbat la unire) trece la
      // identitatea finala — altfel doua profiluri care fragmentau aceeasi
      // persoana raman fragmentate si pe pozele deja etichetate (vezi comentariul
      // de la relabelAnalyses).
      await relabelAnalyses(new Map(toMerge.map(p => [p.id, { id: survivor.id, name: survivor.name }])));
    });
    const [persons, photos] = await Promise.all([db.persons.toArray(), reloadPhotoViews()]);
    await analysisPool.setKnownPersons(persons).catch(() => {});
    set({ persons, photos });
  },

  exportPersonProfiles: async ids => {
    const selected = get().persons.filter(p => ids.includes(p.id));
    if (!selected.length) return;
    const data = buildPersonProfilesExport(selected);
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    const result = await downloadBlob(personProfilesFileName(selected), blob);
    if (result.cancelled) return;
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

    // re-eticheteaza RETROACTIV exact fetele din cluster (identificate prin
    // faceIndex, stabil - nu prin embedding, care s-ar putea sa nu compare
    // egal ca referinta intre interogari separate) in analizele deja
    // existente. NU recalculam scorul AI/statusul deja decis pentru aceste
    // poze (ar necesita re-rularea ContextEngine si ar putea schimba decizii
    // deja luate de utilizator) — doar identificarea (nume/numar cunoscuti),
    // care conteaza pentru afisare si export.
    // db.persons.put + actualizarile din db.analyses sunt intr-o singura
    // tranzactie — separate, o intrerupere la mijloc putea salva persoana noua
    // fara sa re-eticheteze nicio fata deja analizata (sau invers).
    const photoIds = Array.from(new Set(members.map(m => m.photoId)));
    await db.transaction('rw', [db.persons, db.analyses], async () => {
      await db.persons.put(person);
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
    });

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

  dialogRequest: null,
  askConfirm: (message, opts) => new Promise<boolean>(resolve => {
    set({ dialogRequest: { kind: 'confirm', message, ...opts, resolve } });
  }),
  askPrompt: (message, defaultValue, opts) => new Promise<string | null>(resolve => {
    set({ dialogRequest: { kind: 'prompt', message, defaultValue, ...opts, resolve } });
  }),
  resolveDialog: value => {
    const req = get().dialogRequest;
    set({ dialogRequest: null });
    // castul e necesar: `resolve` difera intre 'confirm' (boolean) si 'prompt' (string | null),
    // dar apelantul (componenta ConfirmDialog) stie deja, din req.kind, ce tip de valoare trimite.
    (req?.resolve as ((v: boolean | string | null) => void) | undefined)?.(value);
  },
  // Bug real gasit de auditul QA: GroupCompare (ca si DetailView) nu e montat
  // cat timp Workspace e activ, dar — spre deosebire de detailId — compareGroupId
  // nu era niciodata resetat la intoarcerea in grila, deci o comparare de serie
  // deschisa inainte de a intra in Workspace reaparea NEASTEPTAT la revenire,
  // fara ca utilizatorul sa fi cerut asta. Acelasi tipar ca detailId mai sus:
  // pastrat cat timp Workspace e activ (nerandat oricum), golit la intoarcere.
  setWorkspaceMode: on => set({ workspaceMode: on, detailId: on ? get().detailId : null, compareGroupId: on ? get().compareGroupId : null }),
  setBatchOpsOpen: open => set({ batchOpsOpen: open }),
  setPaletteOpen: open => set({ paletteOpen: open }),
  setShortcutsOpen: open => set({ shortcutsOpen: open }),
  setNotice: message => set({ notice: message }),
  clearNotice: () => set({ notice: null }),

  clearAll: async () => {
    await Promise.all([
      db.photos.clear(), db.thumbnails.clear(), db.previews.clear(), db.originals.clear(), db.fileHandles.clear(),
      db.analyses.clear(), db.history.clear(), db.collections.clear()
    ]);
    originalFiles.clear();
    originalHandles.clear();
    clearPreviewUrlCache();
    // Foldere personalizate golite ODATA CU sesiunea (cerinta directa a
    // utilizatorului) — spre deosebire de persoane, care raman intentionat pe
    // "Goleste sesiunea" (identitati durabile, invatate din poze anterioare):
    // un folder ca "Poze pentru Instagram" e legat de continutul concret al
    // acelei sesiuni, nu o taxonomie menita sa supravietuiasca peste sedinte
    // foto complet nelegate viitoare.
    // Bug real gasit de auditul QA: multiSelectIds/multiSelectAnchor/selectMode
    // ramaneau nesterse aici — bara de selectie in masa continua sa arate "N
    // selectate" peste o grila goala, iar orice actiune din ea devenea un
    // no-op tacut (db.photos.update pe un id inexistent nu arunca eroare in
    // Dexie). batchHistory/fieldBatchHistory raman de asemenea neatinse pe
    // varianta veche — un Ctrl+Z ulterior ar fi aratat un mesaj "revenit lot
    // X" fara niciun efect, referindu-se la poze care nu mai exista.
    set({
      photos: [], collections: [], collectionFilter: null,
      detailId: null, compareGroupId: null, editingPhotoId: null, history: [],
      batchHistory: [], fieldBatchHistory: [],
      multiSelectIds: new Set(), multiSelectAnchor: null, selectMode: false
    });
  },

  clearAllIncludingPersons: async () => {
    await Promise.all([
      db.photos.clear(), db.thumbnails.clear(), db.previews.clear(), db.originals.clear(), db.fileHandles.clear(),
      db.analyses.clear(), db.history.clear(),
      db.persons.clear(), db.corrections.clear(), db.collections.clear(),
      contextEngine.reset()
    ]);
    originalFiles.clear();
    originalHandles.clear();
    clearPreviewUrlCache();
    await analysisPool.setKnownPersons([]).catch(() => {});
    set({
      photos: [], persons: [], collections: [], collectionFilter: null,
      detailId: null, compareGroupId: null, editingPhotoId: null, history: [],
      batchHistory: [], fieldBatchHistory: [],
      multiSelectIds: new Set(), multiSelectAnchor: null, selectMode: false
    });
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
      const locale = get().locale;
      const result = await exportOriginalFiles(selected.map(p => {
        const meta = p.project ? getProjectMetadata(p.project) : {};
        return {
          id: p.id,
          fileName: p.fileName,
          personNames: p.groupId ? (groupUnion.get(p.groupId) ?? p.personNames) : p.personNames,
          faceCount: p.faceCount,
          strangerCount: p.strangerCount,
          sceneType: p.sceneType,
          sceneTags: p.sceneTags,
          capturedAt: p.capturedAt,
          client: meta.client,
          event: meta.event,
          location: meta.location,
          edits: p.edits
        };
      }), { renameTemplate: get().renameTemplate, locale });
      if (result.cancelled) return;
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

  /**
   * Exporta TOATE pozele dintr-un folder personalizat (cerinta directa a
   * utilizatorului — "nu apare posibilitatea sa export foldere"), indiferent
   * de status (spre deosebire de exportSelection, care exporta doar
   * status==='selected'): apartenenta la un folder e deja o alegere
   * explicita a utilizatorului, un semnal la fel de puternic ca statusul.
   * Aceeasi grupare pe subfoldere persoana/scena ca exportSelection —
   * folderul personalizat decide DOAR ce poze intra in export, nu inlocuieste
   * acea organizare interna.
   */
  exportCollection: async id => {
    const locale = get().locale;
    const collection = get().collections.find(c => c.id === id);
    const allPhotos = get().photos;
    const memberSet = new Set(collection?.memberIds ?? []);
    const members = allPhotos.filter(p => memberSet.has(p.id));
    if (!members.length) { set({ notice: t(locale, 'collections.export.empty') }); return; }
    try {
      const groupUnion = computeGroupPersonUnion(allPhotos);
      const result = await exportOriginalFiles(members.map(p => {
        const meta = p.project ? getProjectMetadata(p.project) : {};
        return {
          id: p.id,
          fileName: p.fileName,
          personNames: p.groupId ? (groupUnion.get(p.groupId) ?? p.personNames) : p.personNames,
          faceCount: p.faceCount,
          strangerCount: p.strangerCount,
          sceneType: p.sceneType,
          sceneTags: p.sceneTags,
          capturedAt: p.capturedAt,
          client: meta.client,
          event: meta.event,
          location: meta.location,
          edits: p.edits
        };
      }), {
        renameTemplate: get().renameTemplate, locale,
        zipBaseName: 'lumin-culler-' + (collection?.name ?? 'folder').replace(/[\\/:*?"<>|]/g, '-')
      });
      if (result.cancelled) return;
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
      set({ notice: t(locale, 'store.exportSelection.failed', { error: String(err) }) });
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
    // downloadBlob incearca intai File System Access API (showSaveFilePicker) — vezi
    // comentariul din core/export/directoryPicker.ts pentru bug-ul real pe care il evita.
    await downloadBlob('selectie-lumin-' + new Date().toISOString().slice(0, 10) + '.json', blob);
  },

  exportSessionReport: async () => {
    const projectName = get().projectName;
    // Bug real gasit de auditul QA: boot() incarca TOATA biblioteca persistata
    // (nu doar sesiunea curenta), iar acest raport agrega intreaga colectie
    // `photos`, desi antetul se afiseaza explicit ca "Proiect: {projectName}" —
    // un raport titrat pentru un anumit proiect putea include totaluri/procente
    // din poze apartinand altor proiecte, mai vechi, ramase in biblioteca
    // locala. PhotoRecord.project e populat pe fiecare poza la import (vezi
    // ProjectsPanel), deci scoping-ul e posibil direct, fara sesiune separata.
    const scoped = projectName.trim() ? get().photos.filter(p => p.project === projectName) : get().photos;
    const stats = computeLibraryStats(scoped);
    const earliestImportedAt = scoped.length ? Math.min(...scoped.map(p => p.importedAt)) : null;
    const text = buildSessionReportText({
      stats, projectName, earliestImportedAt, generatedAt: Date.now()
    });
    const blob = new Blob([text], { type: 'text/plain' });
    await downloadBlob('raport-sesiune-lumin-' + new Date().toISOString().slice(0, 10) + '.txt', blob);
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
            // cuvintele-cheie IPTC reale (parsate din fisier sau suprascrise manual, editare
            // in masa) trec inaintea celor derivate automat de AI — dedupe cu Set pastreaza
            // prima aparitie, deci un cuvant-cheie IPTC identic cu unul AI nu se repeta
            ...new Set([
              ...(p.iptcKeywords ?? []),
              ...deriveXmpKeywords(personNames, p.sceneSemantic, p.sceneTags),
              deriveAiScoreKeyword(p.aiScore),
              ...(p.groupId ? [deriveSeriesKeyword(p.groupId)] : []),
              ...(meta.client ? [t(locale, 'store.xmpKeyword.client', { value: meta.client })] : []),
              ...(meta.event ? [t(locale, 'store.xmpKeyword.event', { value: meta.event })] : []),
              ...(meta.location ? [t(locale, 'store.xmpKeyword.location', { value: meta.location })] : [])
            ])
          ],
          aiScore: p.aiScore,
          aiFactors: explainFactors(p.aiFactors, locale).map(f => `${f.label} (${f.positive ? '+' : '-'})`),
          groupId: p.groupId,
          client: meta.client,
          event: meta.event,
          location: meta.location,
          caption: p.iptcCaption
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

  bestInGroupIds: () => computeBestInGroupIds(get().photos),

  filtered: () => {
    const { photos, filter, personFilter, colorLabelFilter, sceneTagFilter, projectFilter, collectionFilter, collections, cameraFilter, searchText, locale, dateFrom, dateTo, minRating, gridSort } = get();
    const c = filteredCache;
    if (
      c && c.photos === photos && c.filter === filter && c.personFilter === personFilter &&
      c.colorLabelFilter === colorLabelFilter && c.sceneTagFilter === sceneTagFilter &&
      c.cameraFilter === cameraFilter && c.projectFilter === projectFilter &&
      c.collectionFilter === collectionFilter && c.collections === collections &&
      c.searchText === searchText && c.locale === locale && c.dateFrom === dateFrom && c.dateTo === dateTo &&
      c.minRating === minRating && c.gridSortKey === gridSort.key && c.gridSortDir === gridSort.dir
    ) {
      return c.result;
    }
    let base: PhotoView[];
    switch (filter) {
      case 'selected': base = photos.filter(p => p.status === 'selected'); break;
      // "de verificat" incepe sortat dupa cat de aproape e scorul de UN prag
      // (select sau reject) — pozele aproape de prag sunt decizii rapide/usoare,
      // cele din mijlocul benzii (aproape de scor 50) sunt cele cu adevarat
      // ambigue si raman la coada, ca sa treci intai prin cele multe si usoare.
      case 'review':
        base = photos.filter(p => p.status === 'review')
          .sort((a, b) => reviewProximity(a.aiScore) - reviewProximity(b.aiScore));
        break;
      case 'rejected': base = photos.filter(p => p.status === 'rejected'); break;
      case 'blinks': base = selectBlinks(photos); break;
      case 'goldenHour': base = photos.filter(p => p.goldenHourDetected); break;
      case 'highlights': base = selectHighlights(photos); break;
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
    // filtru dupa eticheta de culoare — combinabil cu restul, la fel ca personFilter
    if (colorLabelFilter) base = base.filter(p => (p.colorLabel ?? 'none') === colorLabelFilter);
    // filtru dupa eticheta de scena/obiect (COCO-80, ex. "dog", "cake") — combinabil cu restul
    if (sceneTagFilter) base = base.filter(p => p.sceneTags?.includes(sceneTagFilter));
    // filtru dupa aparatul foto (EXIF cameraModel) — util la evenimente filmate cu 2+ aparate
    // (ex. fotograf principal + secund la o nunta), combinabil cu restul
    if (cameraFilter) base = base.filter(p => p.cameraModel === cameraFilter);
    // filtru dupa proiect — vezi ProjectsPanel (fara proiect ales = grupul "Fara proiect")
    if (projectFilter) {
      base = projectFilter === NO_PROJECT_KEY
        ? base.filter(p => !p.project)
        : base.filter(p => p.project === projectFilter);
    }
    // filtru dupa folder personalizat — vezi CollectionsPanel; apartenenta traieste
    // pe CollectionRecord.memberIds, nu pe PhotoView, deci cautam prin Set, nu prin camp direct.
    if (collectionFilter) {
      const memberIds = new Set(collections.find(c => c.id === collectionFilter)?.memberIds ?? []);
      base = base.filter(p => memberIds.has(p.id));
    }
    // cautare text — dupa numele fisierului SAU dupa etichetele de scena/obiect
    // detectate de AI (traduse, fara diacritice — vezi matchesSearch mai sus)
    const q = normalizeForSearch(searchText.trim());
    if (q) base = base.filter(p => matchesSearch(p, q, locale));
    // interval de data (capturedAt) — poze fara data cunoscuta sunt excluse
    // doar daca s-a cerut explicit un capat de interval (altfel raman vizibile)
    if (dateFrom !== null) base = base.filter(p => (p.capturedAt ?? 0) >= dateFrom);
    if (dateTo !== null) base = base.filter(p => (p.capturedAt ?? 0) <= dateTo);
    // rating minim — 0 = fara filtru
    if (minRating > 0) base = base.filter(p => p.rating >= minRating);
    // sortarea utilizatorului (plan 3.2.1) — filtrele "Serii" si "De verificat"
    // isi pastreaza propria ordine (grupare pe serie, respectiv proximitate
    // fata de prag — vezi reviewProximity mai sus), altfel s-ar suprascrie
    if (filter !== 'series' && filter !== 'review') {
      base = [...base].sort((a, b) => {
        const cmp = compareBy(gridSort.key, a, b);
        return gridSort.dir === 'asc' ? cmp : -cmp;
      });
    }
    filteredCache = {
      photos, filter, personFilter, colorLabelFilter, sceneTagFilter, cameraFilter, projectFilter,
      collectionFilter, collections,
      searchText, locale, dateFrom, dateTo, minRating, gridSortKey: gridSort.key, gridSortDir: gridSort.dir,
      result: base
    };
    return base;
  },

  /**
   * Bug real gasit de auditul QA: badge-urile de numar din randul principal
   * de filtre (App.tsx, `counts`) se calculau din TOATA biblioteca `photos`,
   * ignorand orice filtru SECUNDAR activ (persoana/eticheta/scena/camera/
   * proiect/cautare/data/rating) — conținutul real al grilei (filtered(),
   * mai sus) le combina corect, dar pastila "Selectate" arata mereu numarul
   * pe toata biblioteca, chiar si cu un filtru de persoana activ care ar
   * arata mult mai putine. Extras separat de filtered() (nu reutilizabil
   * direct: acolo switch-ul pe `filter` ESTE tocmai axa pe care vrem sa
   * numaram aici, deci trebuie sarit).
   */
  secondaryFiltered: () => {
    const { photos, personFilter, colorLabelFilter, sceneTagFilter, cameraFilter, projectFilter, collectionFilter, collections, searchText, locale, dateFrom, dateTo, minRating } = get();
    const c = secondaryFilteredCache;
    if (
      c && c.photos === photos && c.personFilter === personFilter &&
      c.colorLabelFilter === colorLabelFilter && c.sceneTagFilter === sceneTagFilter &&
      c.cameraFilter === cameraFilter && c.projectFilter === projectFilter &&
      c.collectionFilter === collectionFilter && c.collections === collections &&
      c.searchText === searchText && c.locale === locale && c.dateFrom === dateFrom && c.dateTo === dateTo &&
      c.minRating === minRating
    ) {
      return c.result;
    }
    let base = photos;
    if (personFilter) base = base.filter(p => p.personNames.includes(personFilter));
    if (colorLabelFilter) base = base.filter(p => (p.colorLabel ?? 'none') === colorLabelFilter);
    if (sceneTagFilter) base = base.filter(p => p.sceneTags?.includes(sceneTagFilter));
    if (cameraFilter) base = base.filter(p => p.cameraModel === cameraFilter);
    if (projectFilter) {
      base = projectFilter === NO_PROJECT_KEY
        ? base.filter(p => !p.project)
        : base.filter(p => p.project === projectFilter);
    }
    if (collectionFilter) {
      const memberIds = new Set(collections.find(c2 => c2.id === collectionFilter)?.memberIds ?? []);
      base = base.filter(p => memberIds.has(p.id));
    }
    const q = normalizeForSearch(searchText.trim());
    if (q) base = base.filter(p => matchesSearch(p, q, locale));
    if (dateFrom !== null) base = base.filter(p => (p.capturedAt ?? 0) >= dateFrom);
    if (dateTo !== null) base = base.filter(p => (p.capturedAt ?? 0) <= dateTo);
    if (minRating > 0) base = base.filter(p => p.rating >= minRating);
    secondaryFilteredCache = {
      photos, personFilter, colorLabelFilter, sceneTagFilter, cameraFilter, projectFilter,
      collectionFilter, collections, searchText, locale, dateFrom, dateTo, minRating, result: base
    };
    return base;
  },

  groupOf: groupId =>
    get().photos.filter(p => p.groupId === groupId).sort((a, b) => b.aiScore - a.aiScore)
}));
