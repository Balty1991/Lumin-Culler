/**
 * state/store.ts
 * Managementul starii (Zustand) — separat de UI. Include fluxul de comparare
 * a seriilor: alegi cea mai buna poza dintr-un grup de cadre similare.
 */
import { create } from 'zustand';
import { db, type AnalysisRecord, type PhotoRecord, type KnownPerson, type ColorLabel, type CollectionRecord } from '../core/db';
import { recordPhotosUsed, remainingFreePhotos, isPremium, canEnrollAnotherPersonFree, FREE_PHOTOS_PER_MONTH, isCapEnforced, isPremiumFeatureLocked, FREE_ENROLLED_PERSONS, isPurchasable, photosUsedInRollingMonth, subscribeEntitlement, refreshEntitlementAtStartup } from '../core/entitlement';
import {
  loadCollections, createCollection as createCollectionRecord, renameCollection as renameCollectionRecord,
  deleteCollection as deleteCollectionRecord, addPhotosToCollection as addPhotosToCollectionRecord,
  removePhotosFromCollection as removePhotosFromCollectionRecord
} from '../core/collections';
import { readSavedFilters, writeSavedFilters, type SavedFilterPreset } from './savedFilters';
import { applyAdjustmentsToBlob, isNeutral, type EditAdjustments } from '../core/imageAdjust';
import { readApplyEditsInGallery, writeApplyEditsInGallery } from './applyEditsPreference';
import { readProMode, writeProMode } from './proMode';
import { readActiveFilter, writeActiveFilter } from './activeFilter';
import { findSimilarPhotos } from '../core/similarPhotos';
import { featuresForReasons } from '../core/decisionReasons';
import { subjectTags } from '../core/descriptionTags';
import { describeImageNative, startImageDescriptionDownload, imageDescriptionStatus } from '../core/nativeImageDescription';
import type { QuickScanResult } from '../core/quickDuplicateScan';
import { clearPreviewUrlCache } from '../core/previewUrlCache';
import { clearThumbUrlCache } from '../core/thumbUrlCache';
import { readGroupByPeople, writeGroupByPeople } from './groupByPeople';
import {
  importFiles, originalFiles, originalHandles, createCancelToken, SELECT_THRESHOLD, REJECT_THRESHOLD, decidePhotoStatus,
  readLibraryScores, type ImportProgress, type ImportCancelToken, type ImportOutcomeReport
} from '../core/importPipeline';
import { deriveThresholds, type Thresholds } from '../core/scoreThresholds';
import { pickMostUncertain } from '../core/uncertainty';
import { selectDecisionInversions } from './decisionInversions';
import { summarizeSession, type SessionOutcome } from '../core/sessionOutcome';
import type { FileSystemFileHandleLike } from '../core/filePicker';
import { readEconomicMode, writeEconomicMode } from '../core/performanceSettings';
import { vibrate } from '../ui/haptics';
import { exportOriginalFiles, computeGroupPersonUnion } from '../core/exportPhotos';
import { exportXMPSidecars, deriveXmpKeywords, deriveAiScoreKeyword, deriveSeriesKeyword } from '../core/export/xmpGenerator';
import { analysisPool } from '../core/workerPool';
import { contextEngine, deriveContextKey, explainFactors, type WeightShift } from '../core/learning/ContextEngine';
import { dateSearchWords } from './searchDateWords';
import { findNearestPlace, formatPlace, getLoadedPlaceIndex, loadPlaceIndex } from '../core/placeNames';
import { hasRealGps } from '../core/gpsCoordinates';
import { pickBestInGroup } from '../core/groupSelection';
import {
  pushHistory, popHistory, MAX_HISTORY, type HistoryEvent,
  pushBatchHistory, popBatchHistory, type BatchHistoryEvent, type FieldBatchHistoryEvent
} from './history';
import { selectBulkRejectTargets, resolveGroups, selectTopPercent, selectHighlights, selectBlinks, selectBlurry, selectDeletableRejected, isUserDecided } from './batchOps';
import {
  isNativeMediaLibraryAvailable, deleteNativePhotos, readGalleryOverview, readGalleryDateRange, pickPhotosInRange,
  readGalleryFolders, pickPhotosInFolder, getPhotosAccess, readNativePhotoLocations
} from '../core/nativeMediaLibrary';
import {
  computeNextPeriod, computeRemainingPeriod, readCoveredUntil, writeCoveredUntil, listAllPeriods, readPeriodMonths,
  writePeriodMonths, periodMonthsToMs, computeGalleryCoveragePercent, readImportedFolderIds, writeImportedFolderIds,
  resetSupervisorProgress,
  type GalleryPeriod, type GalleryPeriodEntry, type PeriodMonths
} from './gallerySupervisor';
import { readStoredTheme, applyTheme, type Theme } from './theme';
import { readStoredAccent, applyAccent, type AccentTheme } from './accentTheme';
import { readWelcomeSeen, writeWelcomeSeen } from './welcomeOnboarding';
import { readExcludedFolderIds, writeExcludedFolderIds } from './galleryFolders';
import { readProtectedPersons, writeProtectedPersons, excludeProtected } from './protectedPersons';
import { readStageStats } from '../core/stageTiming';
import { summariseFeedback } from '../core/aiFeedback';
import { recordImportOutcome, summariseOutcomes } from '../core/importOutcome';
import { keepScreenAwake } from '../core/wakeLock';
import { createActiveElapsed, type ActiveElapsed } from '../core/activeElapsed';
import { recordImportDay } from './streak';
import { stabilizeEta } from '../core/etaEstimate';
import { readAccessibleMode, applyAccessibleMode } from '../core/accessibleMode';
import { readSmartNotificationEnabled, writeSmartNotificationEnabled } from './smartNotification';
import { requestNotificationAccess } from '../core/nativeNotifications';
import {
  readZenMode, writeZenMode,
  readZenAutoDeleteObvious, writeZenAutoDeleteObvious,
  readZenAskOnUncertain, writeZenAskOnUncertain
} from '../core/zenMode';
import { resolveGroupsWithConfidence } from './zenResolve';
import { readStoredProjectName, writeProjectName } from './projectName';
import { readStoredWatermarkText, writeWatermarkText } from './watermarkText';
import { readStoredGenre, writeStoredGenre } from './genre';
import { readGridDensity, writeGridDensity, type GridDensity } from './gridDensity';
import { readGridSort, writeGridSort, compareBy, type GridSort } from './gridSort';
import { readStoredRenameTemplate, writeStoredRenameTemplate } from '../core/renameTemplate';
import { recordUsage, readMonthlyUsage } from './usage';
import { getProjectMetadata } from './projectMetadata';
import { buildPersonProfilesExport, personProfilesFileName, parsePersonProfilesFile } from '../core/personProfileTransfer';
import { readStoredLocale, writeStoredLocale, applyLocale, t, plural, type Locale } from '../i18n';
import { translateSceneTag, normalizeForSearch } from '../core/sceneTagLabels';
import { relatedSceneTags } from '../core/searchSynonyms';
import { cuvinteDinText, seGasesteAproape } from '../core/searchFuzzy';
import { buildBackup, backupFileName, parseBackupFile, restoreBackup } from '../core/backupService';
import { writeLastBackupAt } from './backupReminder';
import { buildClientGalleryHtml } from '../core/export/clientGallery';
import { parseClientFeedbackFile } from '../core/export/clientFeedback';
import { downloadBlob } from '../core/export/directoryPicker';
import { buildSessionReportText } from '../core/export/sessionReport';
import { computeLibraryStats } from '../core/stats';
import {
  getOrCreateVaultCollection, setVaultPin as coreSetVaultPin, verifyVaultPin,
  clearVaultPin as coreClearVaultPin, isVaultUnlockedInSession, setVaultUnlockedInSession, hasVaultPin
} from '../core/vault';

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
  /**
   * Subiectul e clar, chiar daca restul cadrului nu e — adica profunzime mica
   * intentionata, nu miscare. Fara el, un portret cu fundal frumos topit ar
   * ajunge in "Mișcate" langa pozele chiar ratate. Vine din analiza deja
   * citita aici, deci nu costa nicio interogare in plus.
   */
  subjectInFocus?: boolean;
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
  /** Cat de departe de locul real poate fi coordonata, dupa aparat (metri). Absenta la majoritatea telefoanelor. */
  gpsAccuracyM?: number;
  gpsLatitude?: number;
  gpsLongitude?: number;
  /** Metadate IPTC-IIM (segment Photoshop APP13) — vezi core/iptcParser.ts. */
  iptcByline?: string;
  decisionReasons?: string[];
  decisionNote?: string;
  aiDescription?: string;
  iptcCaption?: string;
  iptcHeadline?: string;
  iptcCredit?: string;
  iptcSource?: string;
  iptcCopyright?: string;
  iptcCity?: string;
  iptcCountry?: string;
  iptcKeywords?: string[];
  aiFactors: { feature: string; contribution: number }[];
  /** Cat de putin se poate baza cineva pe aiScore pentru ACEASTA poza — vezi AnalysisRecord.aiUncertainty. */
  aiUncertainty?: number;
  /** Cat din aiScore vine din gustul tau, nu din manual — vezi AnalysisRecord.aiPersonalDelta. */
  aiPersonalDelta?: number;
  personNames: string[];
  /** Persoanele cunoscute recunoscute in ACEASTA poza, cu similaritatea (0..1) cea mai buna dintre fetele care le corespund — "confidence score" (plan 3.2.3). */
  personMatches: { name: string; similarity: number }[];
  groupId?: string;
  capturedAt?: number;
  /** Dimensiunea fisierului original (bytes) — vezi PhotoRecord.sizeBytes; absent la poze importate inainte de acest camp. */
  sizeBytes?: number;
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
  /** Fractiune din cadru acoperita de text OCR (doar Android nativ) — vezi AnalysisRecord.textCoverage si core/documentShield.ts. */
  textCoverage?: number;
  /** Placeholder minuscul blurat, disponibil sincron — vezi PhotoRecord.lqip. Absent pe importuri vechi. */
  lqip?: string;
  /** Ajustari de baza non-destructive (expunere/contrast/...) — vezi core/imageAdjust.ts si PhotoRecord.edits. Absent = fara ajustari. */
  edits?: EditAdjustments;
  /** Alegerea clientului importata din "galeria client cu feedback" — vezi PhotoRecord.clientFeedback. Absent = niciun feedback importat. */
  clientFeedback?: 'like' | 'dislike';
  /** URI content:// nativ Android al fisierului original — vezi PhotoRecord.mediaUri. Absent = stergerea din stocare (deleteRejectedPhotos) nu e posibila pentru aceasta poza. */
  mediaUri?: string;
}

/** Pentru ce functie s-a lovit omul de poarta Premium — vezi gatePremium. */
export type PremiumReason = 'locations' | 'vault' | 'contactSheet' | 'presentation' | 'xmp' | 'persons' | 'cap';

export type FilterKey = 'all' | 'selected' | 'candidate' | 'review' | 'rejected' | 'series' | 'blinks' | 'blurry' | 'goldenHour' | 'highlights';

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
  /** Cand setat, Prezentarea ruleaza EXACT aceasta lista de poze (in loc de selectia
      multipla/pozele "selectate"/filtrul curent) — folosit de "Recap lunar" (Meniu),
      care alege cele mai bune poze din ultimele 30 de zile, indiferent de filtrul activ.
      Golit la inchiderea Prezentarii, ca urmatoarea deschidere normala (din grila) sa
      revina la comportamentul obisnuit. */
  presentationPhotoIds: string[] | null;
  setPresentationPhotoIds: (ids: string[] | null) => void;
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
  locationsOpen: boolean;
  /** Deschide ecranul Premium in locul functiei cerute cand nu esti abonat. `true` = a preluat actiunea. */
  /**
   * Deschide panoul Premium si spune DE CE s-a deschis.
   *
   * Portile contextuale existau deja in sapte locuri (locatii, dosar privat,
   * plansa de contact, prezentare, XMP, a doua persoana, plafonul de 150) — se
   * declanseaza fix cand omul intinde mana dupa functia respectiva. Ce lipsea
   * era legatura: panoul se deschidea identic de fiecare data, cu aceeasi lista
   * de sase functii. Cine apasa "Plansa de contact" primea un catalog, si
   * trebuia sa se caute singur in el, exact in momentul in care intrebarea lui
   * era cat se poate de precisa.
   */
  gatePremium: (reason?: PremiumReason) => boolean;
  /** Functia pentru care s-a deschis ultima data panoul; null cand a fost deschis din meniu. */
  premiumReason: PremiumReason | null;
  /**
   * Oglinda REACTIVA a drepturilor din core/entitlement.ts.
   *
   * De ce exista, cand entitlement.ts raspunde deja la aceleasi intrebari:
   * functiile de acolo citesc localStorage SINCRON, deci React n-are cum sa
   * afle ca raspunsul s-a schimbat. Bug real gasit la audit — un utilizator
   * care cumpara abonamentul (sau il avea deja cumparat pe alt telefon, si
   * refreshEntitlement() il descopera la pornire) ramanea cu lacatele pe ecran
   * pana cand cu totul altceva provoca o re-randare. Adica exact omul care
   * tocmai platise continua sa vada "Premium".
   *
   * Se actualizeaza singura: syncEntitlement() e abonata la entitlement.ts (vezi
   * subscribeEntitlement), deci orice schimbare ajunge aici fara ca apelantii
   * sa fie nevoiti sa stie ca trebuie s-o ceara.
   */
  premium: boolean;
  /** Exista o cale reala de plata pe acest dispozitiv (Play a confirmat un produs cumparabil). */
  premiumPurchasable: boolean;
  /** O functie rezervata abonatilor e blocata ACUM — varianta reactiva a isPremiumFeatureLocked(). */
  premiumLocked: boolean;
  /** Cate poze au fost scoase (exportate sau sterse) in ultimele 30 de zile. */
  photosUsedThisWindow: number;
  /** Reciteste drepturile din entitlement.ts in stare. Apelata de abonament, nu direct. */
  syncEntitlement: () => void;
  setLocationsOpen: (open: boolean) => void;
  tiktokSortOpen: boolean;
  setTiktokSortOpen: (open: boolean) => void;
  /** Cand nenul, sortarea rapida arata DOAR aceste poze (ex. "Sorteaza acum ce ai adus" — vezi openTiktokSortForIds), nu toata coada. Golit la fiecare deschidere normala (fara scop) sau dupa ce a fost folosit. */
  tiktokSortScopeIds: string[] | null;
  /** Pozele aduse la ultimul import prin supervizorul galeriei — sursa pentru "Sorteaza acum ce ai adus" (CTA aparuta imediat dupa un import reusit). null daca n-a fost niciun import inca sau CTA-ul a fost deja folosit. */
  lastSupervisorImportIds: string[] | null;
  /** Deschide sortarea rapida DIRECT pe pozele indicate (ex. tocmai aduse de supervizor), nu pe toata coada. */
  openTiktokSortForIds: (ids: string[]) => void;
  /**
   * "Verifică ce nu știu sigur" — deschide sortarea rapida cu pozele pe care
   * motorul le-a decis SINGUR, dar aproape la limita (vezi core/uncertainty.ts).
   * Intoarce cate au fost gasite; 0 inseamna ca n-a ramas nicio decizie
   * indoielnica, si spune asta printr-o notificare in loc sa deschida gol.
   */
  openUncertainReview: () => Promise<number>;
  /** Deschide sortarea rapida peste pozele respinse care par respinse din greseala (vezi state/decisionInversions.ts). Intoarce cate a gasit. */
  openDecisionInversions: () => Promise<number>;
  /**
   * Rezultatul ultimului lot, aratat O SINGURA DATA imediat dupa import — vezi
   * core/sessionOutcome.ts. null = nimic de raportat sau deja inchis de utilizator.
   */
  sessionOutcome: SessionOutcome | null;
  dismissSessionOutcome: () => void;
  /** Cautare vizuala pe ecran intreg (plan modernizare) — reutilizeaza searchText/sceneTagFilter, doar UI dedicat. */
  searchPanelOpen: boolean;
  setSearchPanelOpen: (open: boolean) => void;
  /** Grupurile serie/duplicat existente (groupId), prezentate ca o lista de revizuit, nu una cate una din grila. */
  duplicatesPanelOpen: boolean;
  /** Coada de salvare: cadre respinse/nedecise care se pot repara — vezi core/rescueQueue.ts. */
  rescueQueueOpen: boolean;
  setRescueQueueOpen: (open: boolean) => void;
  /** Ce nu pare amintire: capturi de ecran si documente — vezi core/smartInbox.ts. */
  smartInboxOpen: boolean;
  setSmartInboxOpen: (open: boolean) => void;
  /** Momentele (sesiuni de fotografiat separate de pauze), cu 1-3 cadre propuse din fiecare — vezi core/momentStacks.ts. */
  momentsOpen: boolean;
  setMomentsOpen: (open: boolean) => void;
  /**
   * "Mod profesional": arata in meniu si functiile de dupa triaj (XMP, contact
   * sheet, galerie client, watermark, proiecte, gen fotografic, locatii).
   * Oprit implicit — vezi state/proMode.ts pentru de ce.
   */
  proMode: boolean;
  setProMode: (on: boolean) => void;
  /** Copiile identice gasite inainte de analiza, pentru ecranul de progres. Null pana se termina scanarea. */
  quickScan: QuickScanResult | null;
  setDuplicatesPanelOpen: (open: boolean) => void;
  /** "Protectie documente" — coada de poze care par documente/capturi (vezi core/documentShield.ts), de revizuit una cate una. */
  documentShieldOpen: boolean;
  setDocumentShieldOpen: (open: boolean) => void;
  /** Dosarul privat (vezi core/vault.ts) — folder ascuns din Albume, deblocat cu PIN local (nu biometrie: niciun plugin nu exista inca). */
  vaultOpen: boolean;
  setVaultOpen: (open: boolean) => void;
  /** Deblocat DOAR pentru sesiunea curenta (nu persistat) — un reload cere din nou PIN-ul. */
  vaultUnlocked: boolean;
  setupVault: (pin: string) => Promise<void>;
  unlockVault: (pin: string) => Promise<boolean>;
  lockVault: () => void;
  /** Dezactiveaza vaultul: sterge PIN-ul SI muta toate pozele inapoi in galerie normala (folderul ramane, dar isPrivate devine false). */
  disableVault: () => Promise<void>;
  moveToVault: (photoIds: string[]) => Promise<void>;
  removeFromVault: (photoIds: string[]) => Promise<void>;
  createCollection: (name: string) => Promise<CollectionRecord | null>;
  renameCollection: (id: string, name: string) => Promise<void>;
  deleteCollection: (id: string) => Promise<void>;
  /** Adauga fotografiile date (implicit selectia multipla curenta) intr-un folder — vezi core/collections.ts. */
  addPhotosToCollection: (id: string, photoIds: string[]) => Promise<void>;
  /**
   * Face un folder dintr-o grupa de pe ecranul Locatii (cerinta directa a
   * utilizatorului: "sa poti crea folder pe locatii"). Intoarce folderul, sau
   * null daca n-avea ce sa puna in el.
   */
  createCollectionFromLocation: (name: string, photoIds: string[]) => Promise<CollectionRecord | null>;
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
  /**
   * Ecranul Acasa (plan modernizare, cerinta directa a utilizatorului): implicit
   * arata DOAR HomeDashboard, curat, ca in mockup — grila clasica (CullGauge +
   * filtre + carduri) ramane accesibila, dar ascunsa pana e ceruta explicit
   * (butonul "Vezi toate pozele"), nu mai e stivuita sub dashboard din start.
   */
  homeGridOpen: boolean;
  setHomeGridOpen: (open: boolean) => void;
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
  accentTheme: AccentTheme;
  setAccentTheme: (accent: AccentTheme) => void;
  accessibleMode: boolean;
  setAccessibleMode: (on: boolean) => void;
  /** "Notificare inteligenta" (vezi state/smartNotification.ts) — opt-in, cere permisiune de notificare cand e pornita. */
  smartNotificationsEnabled: boolean;
  setSmartNotificationsEnabled: (on: boolean) => void;
  zenMode: boolean;
  setZenMode: (on: boolean) => void;
  zenAutoDeleteObvious: boolean;
  setZenAutoDeleteObvious: (on: boolean) => void;
  zenAskOnUncertain: boolean;
  setZenAskOnUncertain: (on: boolean) => void;
  zenPanelOpen: boolean;
  /** Manualul aplicatiei — vezi ui/GuidePanel.tsx. */
  guideOpen: boolean;
  setZenPanelOpen: (open: boolean) => void;
  setGuideOpen: (open: boolean) => void;
  /** "Aspect" — tema + accent, ecran dedicat (vezi ui/AppearancePanel.tsx). */
  appearanceOpen: boolean;
  setAppearanceOpen: (open: boolean) => void;
  /** "Premium" — previzualizare onesta a planului, fara mecanism de plata (vezi ui/PremiumPanel.tsx). */
  premiumOpen: boolean;
  setPremiumOpen: (open: boolean) => void;
  /** Foaia "unde trimit pozele păstrate" (vezi ui/ExportDestinations.tsx). */
  exportDestinationsOpen: boolean;
  setExportDestinationsOpen: (open: boolean) => void;
  /**
   * Ecranul de bun venit e inca deschis? Traieste in store, nu doar in
   * WelcomeOnboarding, pentru ca si ALTE lucruri trebuie sa stie: bannerele
   * (memorii, instalare, backup, supervizorul galeriei) stau intr-un
   * .banner-stack cu z-index de toast, deci se desenau PESTE ecranul de bun
   * venit, exact peste comutatorul de limba si butonul de inchidere (bug
   * raportat cu captura). Nimic nu trebuie sa concureze cu primul ecran.
   */
  welcomeSeen: boolean;
  dismissWelcome: () => void;
  /** Vezi state/zenResolve.ts — ruleaza automat dupa import cand zenMode e activ (store.ts, runImport). */
  runZenResolve: () => Promise<{ resolved: number; uncertain: number; deleted: number }>;
  /**
   * "Cate poze ai in galerie" (Acasa, plan modernizare) — null = inca nu s-a
   * cerut (utilizatorul nu a apasat butonul dedicat inca). Vezi
   * core/nativeMediaLibrary.ts:readGalleryOverview — NEVALIDAT pe device real.
   */
  galleryOverview: { granted: boolean; totalCount: number } | null;
  loadGalleryOverview: () => Promise<void>;
  /**
   * "Supervizorul galeriei" (cerinta directa a utilizatorului: import ghidat
   * pe perioade cronologice de ~2 luni, cele mai vechi intai, cu recomandarea
   * urmatoarei perioade dupa fiecare aducere) — vezi state/gallerySupervisor.ts
   * si core/nativeMediaLibrary.ts (NEVALIDAT pe device real).
   */
  galleryDateRange: { granted: boolean; earliestMs?: number; latestMs?: number } | null;
  loadGalleryDateRange: () => Promise<void>;
  /** Pana unde s-a "acoperit" deja galeria (cursor persistat) — reactiv in store, nu doar in localStorage, ca UI-ul sa se actualizeze imediat dupa fiecare perioada adusa. */
  supervisorCoveredUntil: number | null;
  /** Lungimea unei perioade (1/2/3 luni — "mai scurte si mai lungi... in functie de cat timp disponibil are utilizatorul"), persistata. */
  supervisorPeriodMonths: PeriodMonths;
  setSupervisorPeriodMonths: (months: PeriodMonths) => void;
  /** Perioada urmatoare de recomandat — null daca intervalul inca nu s-a incarcat, sau s-a ajuns deja la zi. */
  supervisorNextPeriod: () => GalleryPeriod | null;
  /** Toate perioadele (calendaristic) de la cea mai veche poza pana acum, fiecare marcata daca a fost deja acoperita — pentru selectorul manual. */
  supervisorAllPeriods: () => GalleryPeriodEntry[];
  /** "Tot ce a ramas", de la cursor pana acum, intr-un singur pas ("inclusiv butonul toata perioada" — cerinta directa). null daca s-a ajuns deja la zi. */
  supervisorRemainingPeriod: () => GalleryPeriod | null;
  /** Cat din TOATA galeria telefonului (de la cea mai veche poza pana acum) a fost deja acoperita de supervizor — 0-100, distinct de "% organizata" (care masoara doar deciziile luate peste pozele deja aduse in aplicatie). */
  supervisorCoveragePercent: () => number;
  supervisorImporting: boolean;
  /** Aduce o perioada ANUME (selectata manual sau recomandata) si avanseaza cursorul (fara sa-l dea niciodata inapoi). */
  importGalleryPeriod: (period: GalleryPeriod) => Promise<void>;
  /** Sare peste o perioada FARA sa o aduca — avanseaza cursorul ca si cum ar fi fost acoperita, ca supervizorul sa nu o mai recomande. */
  skipGalleryPeriod: (period: GalleryPeriod) => void;
  /** Panoul complet (lungime perioada, selector calendaristic, foldere) — vezi GallerySupervisorPanel.tsx. Redeschis oricand din Meniu, chiar daca bannerul de pe Acasa a fost inchis pentru ziua curenta. */
  supervisorPanelOpen: boolean;
  setSupervisorPanelOpen: (open: boolean) => void;
  /** Foldere din galerie (bucket-uri MediaStore) — alternativa la segmentarea cronologica. */
  galleryFolders: { granted: boolean; folders: { id: string; name: string; count: number }[] } | null;
  loadGalleryFolders: () => Promise<void>;
  /** Foldere deja aduse macar o data — persistat, ca "Toate folderele" sa nu le mai propuna implicit (idee proprie: evita re-aducerea acelorasi poze la fiecare tap). */
  supervisorImportedFolderIds: Set<string>;
  /**
   * Foldere pe care utilizatorul le-a scos DEFINITIV din triaj (Screenshots,
   * WhatsApp Images si ce mai alege el). Diferit de `supervisorImportedFolderIds`,
   * care inseamna doar "deja adus o data": excluderea inseamna "nu mi le
   * propune niciodata". Persistate, si reversibile din acelasi ecran.
   */
  excludedFolderIds: Set<string>;
  /**
   * Persoane pe care operatiile automate nu au voie sa le respinga. Protectia e
   * fata de AUTOMATIZARE, nu fata de utilizator: el poate respinge oricand
   * manual. Vezi state/protectedPersons.ts.
   */
  protectedPersons: Set<string>;
  toggleProtectedPerson: (name: string) => void;
  toggleFolderExcluded: (bucketId: string) => void;
  /** Aduce DIRECT toate pozele dintr-un folder (fara selector manual). */
  importGalleryFolder: (bucketId: string) => Promise<void>;
  /** Aduce toate folderele NEACOPERITE deodata ("si la foldere, la fel" — cerinta directa; extindere proprie: sare peste cele deja aduse). */
  importAllGalleryFolders: () => Promise<void>;
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
  runImport: (files: File[], handles?: (FileSystemFileHandleLike | undefined)[], mediaUris?: (string | undefined)[]) => Promise<void>;
  setStatus: (id: string, status: PhotoRecord['status']) => Promise<void>;
  /**
   * DE CE ai decis asa: motive apasate (care antreneaza) plus, optional, o nota
   * scrisa (care nu antreneaza — vezi core/decisionReasons.ts).
   */
  explainDecision: (photoId: string, reasonIds: string[], note: string) => Promise<void>;
  /** Poza pentru care e deschis panoul "De ce ai decis asa?" — null = inchis. */
  explainPhotoId: string | null;
  setExplainPhotoId: (photoId: string | null) => void;
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
  /** Aplica editarile unei poze tuturor celorlalte cadre NEEDITATE din lista data. */
  applyEditsToMoment: (sourceId: string, ids: string[]) => Promise<{ applied: number }>;
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
  /** Panoul de copii identice (acelasi fisier salvat de mai multe ori) — vezi core/exactDuplicates.ts. */
  exactDupesOpen: boolean;
  setExactDupesOpen: (open: boolean) => void;
  /** Respinge copiile in plus, pastrand una din fiecare. Reversibil cu Ctrl+Z, ca orice operatie in masa. */
  rejectExactDuplicates: (ids: string[]) => Promise<{ affected: number }>;
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
  /**
   * Sterge REAL, de pe telefon, pozele deja RESPINSE care au un URI nativ
   * retinut la import (PhotoRecord.mediaUri) — vezi core/nativeMediaLibrary.ts
   * si state/batchOps.ts:selectDeletableRejected. Foloseste tehnic API-ul de
   * Cos de gunoi al Android (MediaStore.createTrashRequest, nu stergere brutala),
   * dar utilizatorul e informat ca stergere DEFINITIVA — confirmat pe device
   * real ca nu toate aplicatiile de Galerie arata fisierele trecute in cos de
   * o alta aplicatie, deci recuperarea nu e garantata (vezi comentariul din
   * MediaLibraryPlugin.kt). Doar Android nativ (API 30+); pe web/PWA sau
   * pentru poze fara mediaUri (importate prin <input type="file">, sau
   * inainte de aceasta functie), nu are ce sterge — apelantul (BatchOpsPanel)
   * trebuie sa arate distinct cate poze au fost efectiv sterse fata de cate
   * au ramas doar respinse.
   */
  deleteRejectedPhotos: () => Promise<{ deleted: number; skipped: number; cancelled: boolean }>;
  /** Comuta o singura poza in/din selectia in masa — Ctrl/Cmd+Click sau, cat timp selectia nu e goala, orice click simplu pe card. */
  toggleMultiSelect: (id: string) => void;
  /** Selecteaza tot intervalul dintre ultimul anchor si `id`, in ordinea data (lista filtrata curenta) — Shift+Click. */
  rangeMultiSelect: (id: string, orderedIds: string[]) => void;
  /** Forteaza o poza in/afara selectiei (spre deosebire de toggleMultiSelect) — folosit la "vopsirea" prin drag peste mai multe carduri. */
  setMultiSelected: (id: string, on: boolean) => void;
  setSelectMode: (on: boolean) => void;
  /**
   * Duce utilizatorul in grila, cu `ids` deja selectate.
   *
   * Bug real gasit la auditul in browser: panourile care "trimit in grila"
   * (Nu par amintiri, Momente) puneau selectia si inchideau panoul, dar
   * ramaneau pe ecranul Acasa — unde grila e ASCUNSA pana la un click pe
   * "Vezi toate pozele". Utilizatorul apasa "Verifica grupul" si nu se
   * intampla nimic vizibil, desi selectia exista. Punem toti pasii intr-un
   * singur loc, ca urmatorul panou care trimite in grila sa nu-l uite iar pe
   * al treilea.
   */
  revealInGrid: (ids: string[]) => void;
  /** "Arata-mi altele ca asta" — vezi core/similarPhotos.ts. */
  showSimilarTo: (photoId: string) => Promise<void>;
  /** Descriere scrisa de Gemini Nano, pe telefon — vezi core/nativeImageDescription.ts. */
  describePhoto: (photoId: string) => Promise<void>;
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
  /** `expandMetrics` — deschide direct cu foaia de metrici desfasurata (butonul din sortarea rapida cere metricile, nu poza). */
  openDetail: (id: string | null, opts?: { expandMetrics?: boolean }) => void;
  /** Consumat o singura data de DetailView la montare; vezi openDetail. */
  detailExpandMetrics: boolean;
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
  /** `destination` vine din foaia de destinatii (ui/ExportDestinations.tsx); absent = comportamentul de dinainte. */
  exportSelection: (destination?: 'auto' | 'folder' | 'apps') => Promise<void>;
  exportManifest: () => Promise<void>;
  /** Sumar text (nr. poze, scor mediu, durata sesiunii) pentru documentare/facturare fata de client. */
  exportSessionReport: () => Promise<void>;
  exportXMP: () => Promise<void>;
  /** Genereaza si descarca o galerie HTML statica cu pozele selectate, pentru feedback de la client. */
  exportClientGallery: () => Promise<void>;
  filtered: () => PhotoView[];
  /** Id-urile pozelor "cele mai bune" din propriul grup — vezi computeBestInGroupIds, pentru badge-ul "Best of series". */
  /** Gruparea bibliotecii pe subiect, in "Toate" — vezi state/libraryGroups.ts. */
  groupByPeople: boolean;
  setGroupByPeople: (on: boolean) => void;
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
    mediaUri: photo.mediaUri,
    aiScore: analysis?.aiScore ?? 0,
    sceneType: analysis?.sceneType ?? 'detail',
    contextKey: analysis ? deriveContextKey(analysis, photo.genre) : 'detail',
    faceCount: analysis?.faceCount ?? 0,
    knownFaceCount: analysis?.knownFaceCount ?? 0,
    strangerCount: analysis?.strangerCount ?? 0,
    bestSmile: analysis?.bestSmile ?? 0,
    allEyesOpen: analysis?.allEyesOpen ?? true,
    sharpness: analysis?.sharpness ?? 0,
    subjectInFocus: analysis?.subjectInFocus,
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
    gpsAccuracyM: analysis?.gpsAccuracyM,
    gpsLatitude: analysis?.gpsLatitude,
    gpsLongitude: analysis?.gpsLongitude,
    iptcByline: analysis?.iptcByline,
    // suprascrierea manuala (editare in masa) precede valoarea parsata din fisier, fara sa o modifice
    decisionReasons: photo.decisionReasons,
    decisionNote: photo.decisionNote,
    aiDescription: analysis?.aiDescription,
    iptcCaption: photo.captionOverride ?? analysis?.iptcCaption,
    iptcHeadline: analysis?.iptcHeadline,
    iptcCredit: analysis?.iptcCredit,
    iptcSource: analysis?.iptcSource,
    iptcCopyright: analysis?.iptcCopyright,
    iptcCity: analysis?.iptcCity,
    iptcCountry: analysis?.iptcCountry,
    iptcKeywords: photo.keywordsOverride ?? analysis?.iptcKeywords,
    aiFactors: analysis?.aiFactors ?? [],
    aiUncertainty: analysis?.aiUncertainty,
    aiPersonalDelta: analysis?.aiPersonalDelta,
    personNames: analysis
      ? Array.from(new Set(analysis.faces.map(f => f.personName).filter((n): n is string => !!n)))
      : [],
    personMatches: analysis ? bestMatchPerName(analysis.faces) : [],
    groupId: photo.groupId,
    capturedAt: photo.capturedAt,
    sizeBytes: photo.sizeBytes,
    genre: photo.genre,
    project: photo.project,
    goldenHourDetected: analysis?.goldenHourDetected,
    dominantColors: analysis?.dominantColors,
    sceneSemantic: analysis?.sceneSemantic,
    sceneTags: analysis?.sceneTags,
    textCoverage: analysis?.textCoverage
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

// Trebuie sa ramana identic cu RECOGNITION_THRESHOLD din faceAnalysis.worker.ts —
// worker-ul nu poate fi importat aici (ar trage Comlink/@vladmandic/human in
// thread-ul principal doar pentru o constanta), asa ca pragul e duplicat, ca
// si cosineSimilarity din core/faceClustering.ts pentru acelasi motiv.
const RETROACTIVE_MATCH_THRESHOLD = 0.55;

function faceCosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
}

/**
 * Bug real gasit de auditul QA: addPerson/importPersonProfiles apelau doar
 * analysisPool.setKnownPersons(persons), care actualizeaza lista de persoane
 * cunoscute DOAR pentru analize VIITOARE (poze importate de-acum inainte).
 * Pozele deja analizate inainte de inrolare (majoritatea bibliotecii, in
 * cazul obisnuit) ramaneau cu personId null pentru vecie — desi embeddingul
 * fiecarei fete e deja salvat in db.analyses (FaceInsight.embedding), deci
 * re-potrivirea nu necesita nicio re-analiza, doar o comparatie cosinus.
 * Ating doar fetele INCA neidentificate (personId null) — o fata deja
 * atribuita altei persoane nu e retrasa aici, la fel ca relabelFaces. Extrasa
 * separat de rematchPersonInExistingAnalyses ca sa fie testabila unitar fara
 * IndexedDB reala, la fel ca relabelFaces/relabelAnalyses mai sus.
 */
export function matchFacesToPerson(analysis: AnalysisRecord, person: KnownPerson): boolean {
  if (!person.embeddings.length) return false;
  let changed = false;
  for (const face of analysis.faces) {
    if (face.personId || !face.embedding?.length) continue;
    let best = 0;
    for (const ref of person.embeddings) {
      const sim = faceCosineSimilarity(face.embedding, ref);
      if (sim > best) best = sim;
    }
    if (best >= RETROACTIVE_MATCH_THRESHOLD) {
      face.personId = person.id;
      face.personName = person.name;
      face.similarity = Math.round(best * 100) / 100;
      changed = true;
    }
  }
  if (changed) {
    analysis.knownFaceCount = analysis.faces.filter(f => f.personId).length;
    analysis.strangerCount = analysis.faces.filter(f => !f.personId).length;
  }
  return changed;
}

async function rematchPersonInExistingAnalyses(person: KnownPerson): Promise<void> {
  const all = await db.analyses.toArray();
  const updates = all.filter(analysis => matchFacesToPerson(analysis, person));
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

/**
 * Ce "spune" un rating despre poza, ca semnal de antrenare: 4-5 stele = da,
 * 1-2 = nu, 3 = nimic (mijloc explicit), 0 = nimic (fara rating dat, nu o
 * judecata). Exportata pentru test.
 */
export function ratingDecision(rating: number): boolean | null {
  if (rating >= 4) return true;
  if (rating === 1 || rating === 2) return false;
  return null;
}

/**
 * Invatarea dintr-o serie rezolvata de om: PERECHI de preferinta, nu etichete.
 *
 * Bug real, gasit la analiza motorului: alegerea unui cadru dintr-o serie era
 * codificata ca N decizii absolute independente — "B e buna, A e proasta,
 * C e proasta". Dar omul n-a spus niciodata ca A e proasta; a spus ca B a
 * batut-o pe A. A putea fi o poza excelenta care a pierdut la mustata, iar
 * modelul invata din ea, cu convingere, exact pe dos. Si se intampla fix pe
 * interactiunea in jurul careia e construita aplicatia.
 *
 * Vezi ContextEngine.recordPreference pentru ce se schimba matematic.
 */
async function trainPreference(winnerId: string, loserIds: string[]): Promise<void> {
  if (!loserIds.length) return;
  const [winnerAnalysis, winnerPhoto] = await Promise.all([db.analyses.get(winnerId), db.photos.get(winnerId)]);
  if (!winnerAnalysis) return;
  const loserAnalyses = await db.analyses.bulkGet(loserIds);
  const losers = loserAnalyses
    .map((analysis, i) => (analysis ? { photoId: loserIds[i], analysis } : null))
    .filter((x): x is { photoId: string; analysis: AnalysisRecord } => x !== null);
  if (!losers.length) return;
  await contextEngine.recordPreference({
    winner: { photoId: winnerId, analysis: winnerAnalysis },
    losers,
    genre: winnerPhoto?.genre
  });
}

async function train(
  id: string,
  userDecision: boolean,
  /** Trasaturile numite de om ca motiv — vezi core/decisionReasons.ts. */
  reasonFeatures?: string[]
): Promise<{ topShift: WeightShift | null }> {
  const [analysis, photo] = await Promise.all([db.analyses.get(id), db.photos.get(id)]);
  if (!analysis) return { topShift: null };
  const aiDecision = analysis.aiScore >= 65;
  const locale = useStore.getState().locale;
  return contextEngine.recordCorrection({
    photoId: id, analysis, aiDecision, userDecision, genre: photo?.genre, locale,
    ...(reasonFeatures?.length ? { reasonFeatures } : {})
  });
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

/**
 * Sufix informativ, NECONDITIONAT de blocare — atasat notificarii de export
 * cand plafonul lunar gratuit (vezi core/entitlement.ts) tocmai a fost atins
 * sau depasit. Nu exista inca niciun mecanism real de plata (Google Play
 * Billing) — acest mesaj doar anunta, nu opreste exportul curent si nu
 * blocheaza pe urmatorul.
 */
function freeExportCapNotice(locale: Locale): string {
  if (isPremium() || remainingFreePhotos() > 0) return '';
  return ' ' + t(locale, 'store.exportSelection.freeCapReached', { limit: FREE_PHOTOS_PER_MONTH });
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
// Acelasi motiv ca mai sus, pentru accentul ales — spre deosebire de tema
// deschisa/inchisa (care are propriul script anti-FOUC in theme-init.js,
// pentru ca schimba tot fundalul paginii), o schimbare de accent e suficient
// de subtila incat un flash de-o fractiune de secunda pana ruleaza acest
// modul nu justifica un al doilea script separat.
applyAccent(readStoredAccent());
applyAccessibleMode(readAccessibleMode());

/**
 * Cautarea text (filtered()/secondaryFiltered()) potriveste ACUM si dupa
 * etichetele de scena/obiect detectate de AI (COCO-80, traduse in romana —
 * vezi core/sceneTagLabels.ts), nu doar numele fisierului — feedback direct
 * de la utilizator: cauta "pisica" si asteapta sa gaseasca pozele in care AI-ul
 * a detectat o pisica, nu doar fisiere cu "pisica" in nume (aproape niciodata
 * cazul). normalizeForSearch scoate diacriticele din ambele parti, ca "pisica"
 * tastat fara "ă" tot sa gaseasca "pisică".
 */
/**
 * Numele localitatii pentru niste coordonate, cu cache pe coordonata rotunjita.
 *
 * Rotunjirea la 3 zecimale (~100 m) e ce face diferenta: pozele dintr-o iesire
 * au coordonate apropiate, dar nu identice, si fara cache fiecare ar cere o
 * cautare proprie in lista de localitati, la fiecare litera tastata. Cu ea, o
 * plimbare intreaga costa cateva cautari, nu cateva sute.
 *
 * Intoarce null cat timp lista de localitati nu s-a incarcat (se incarca la
 * deschiderea cautarii — vezi setSearchPanelOpen): cautarea merge fara
 * localitati pana atunci, nu asteapta dupa ele.
 */
const placeNameCache = new Map<string, string | null>();
function cachedPlaceName(latitude: number, longitude: number, locale: Locale): string | null {
  if (!hasRealGps(latitude, longitude)) return null;
  const index = getLoadedPlaceIndex();
  if (!index) return null;
  const key = `${locale}|${latitude.toFixed(3)}|${longitude.toFixed(3)}`;
  const hit = placeNameCache.get(key);
  if (hit !== undefined) return hit;
  const place = findNearestPlace(index, latitude, longitude);
  const name = place ? formatPlace(place, locale, near => t(locale, 'locations.near', { place: near })) : null;
  placeNameCache.set(key, name);
  return name;
}

/**
 * Potrivirea UNUI singur cuvant, in oricare dintre campurile pozei.
 *
 * Vezi matchesSearch mai jos pentru de ce e separata: o cautare de mai multe
 * cuvinte cere ca FIECARE cuvant sa se potriveasca undeva, nu neaparat in
 * acelasi camp.
 */
function matchesToken(p: PhotoView, normalizedQuery: string, locale: Locale): boolean {
  // Numele fisierului si etichetele de scena erau SINGURELE campuri cautate.
  // Doua consecinte reale, amandoua raportate sau gasite la revizie:
  //
  //  - cautarea dupa numele unei persoane inrolate nu gasea nimic, desi
  //    aplicatia stie exact in ce poze apare;
  //  - "zapada" dadea 0 rezultate pe o biblioteca plina de zapada, pentru ca
  //    modelul etichetase acele poze "ice"/"sky"/"branch", niciodata "snow".
  //    Cautarea era corecta; vocabularul masinii nu e vocabularul omului.
  if (normalizeForSearch(p.fileName).includes(normalizedQuery)) return true;
  if (p.personNames.some(n => normalizeForSearch(n).includes(normalizedQuery))) return true;
  if (p.iptcCaption && normalizeForSearch(p.iptcCaption).includes(normalizedQuery)) return true;
  // Descrierea scrisa de model, cand exista. Ultima dintre campurile de text
  // dinadins: e singura care n-a fost scrisa de un om, deci o potrivire in ea
  // valoreaza mai putin decat una in numele fisierului sau in legenda IPTC.
  if (p.aiDescription && normalizeForSearch(p.aiDescription).includes(normalizedQuery)) return true;
  // Nota scrisa de om cand a explicat o decizie. Motorul n-o poate citi, dar
  // omul si-o poate cauta — si de multe ori tocmai ea e singurul loc unde scrie
  // de ce o poza anume nu i-a placut.
  if (p.decisionNote && normalizeForSearch(p.decisionNote).includes(normalizedQuery)) return true;
  if ((p.iptcKeywords ?? []).some(k => normalizeForSearch(k).includes(normalizedQuery))) return true;
  if (p.project && normalizeForSearch(p.project).includes(normalizedQuery)) return true;
  const camera = [p.cameraMake, p.cameraModel, p.lensModel].filter(Boolean).join(' ');
  if (camera && normalizeForSearch(camera).includes(normalizedQuery)) return true;
  const tags = p.sceneTags ?? [];
  if (tags.some(tag => normalizeForSearch(translateSceneTag(tag, locale)).includes(normalizedQuery))) return true;
  // Ultima plasa: conceptele invecinate cu ce a scris utilizatorul. Vezi
  // core/searchSynonyms.ts pentru de ce nu e un dictionar de sinonime.
  const related = relatedSceneTags(normalizedQuery);
  if (related.size && tags.some(tag => related.has(tag))) return true;
  // Cand a fost facuta ("iulie", "2026", "29 iul") si unde ("Rosiori") — doua
  // dintre primele lucruri dupa care cauta cineva, si singurele doua care mai
  // lipseau din lista de mai sus.
  if (dateSearchWords(p.capturedAt, locale).includes(normalizedQuery)) return true;
  if (p.gpsLatitude !== undefined && p.gpsLongitude !== undefined) {
    const place = cachedPlaceName(p.gpsLatitude, p.gpsLongitude, locale);
    if (place && normalizeForSearch(place).includes(normalizedQuery)) return true;
  }
  // Ultima plasa, incercata DOAR dupa ce tot ce e de sus a dat gres: acelasi
  // cuvant, scris cu o singura greseala. Vezi core/searchFuzzy.ts — acopera
  // deopotriva tastarea ("nunat") si cealalta forma a cuvantului
  // ("copii"/"copil"), fiindca in scris amandoua inseamna aceeasi diferenta.
  //
  // Ordinea conteaza: o potrivire exacta nu trebuie sa coste niciodata
  // parcurgerea de mai jos, iar o cautare care nu gaseste nimic e singurul caz
  // in care merita platita.
  return seGasesteAproape(normalizedQuery, cuvinteleCautabile(p, locale));
}

/**
 * Cuvintele din care e facuta o poza, pentru potrivirea aproximativa.
 *
 * Aceleasi campuri ca mai sus, puse cap la cap o singura data. Rezultatul se
 * tine minte pe poza: la o cautare, functia asta ar fi chemata pentru fiecare
 * cuvant al intrebarii, pe fiecare poza din biblioteca, la fiecare apasare de
 * tasta — iar campurile nu se schimba intre ele.
 */
const cuvinteCache = new WeakMap<PhotoView, { locale: Locale; cuvinte: Set<string> }>();

function cuvinteleCautabile(p: PhotoView, locale: Locale): Set<string> {
  const pastrat = cuvinteCache.get(p);
  if (pastrat && pastrat.locale === locale) return pastrat.cuvinte;
  const bucati = [
    p.fileName,
    ...p.personNames,
    p.iptcCaption ?? '',
    p.aiDescription ?? '',
    p.decisionNote ?? '',
    ...(p.iptcKeywords ?? []),
    p.project ?? '',
    ...(p.sceneTags ?? []).map(tag => translateSceneTag(tag, locale))
  ];
  const cuvinte = cuvinteDinText(normalizeForSearch(bucati.join(' ')));
  cuvinteCache.set(p, { locale, cuvinte });
  return cuvinte;
}

/**
 * Cautarea, asa cum scrie omul: mai multe cuvinte.
 *
 * Pana acum tot ce scria utilizatorul mergea ca un SINGUR sir catre fiecare
 * camp. "ana iulie" cauta literal secventa "ana iulie" undeva — si nu o gasea
 * niciodata, fiindca numele persoanei sta intr-un camp si luna in altul.
 * Aplicatia stia amandoua lucrurile despre acea poza si tot raspundea "niciun
 * rezultat". Asta e chiar cazul pentru care exista cautarea.
 *
 * Acum: fiecare cuvant trebuie sa se potriveasca undeva, nu toate in acelasi
 * loc. "ana iulie" = pozele in care apare Ana SI care sunt din iulie.
 * "rosiori nunta", "mare 2026", "canon apus" — la fel.
 *
 * Fraza intreaga se incearca PRIMA, si nu doar din economie: un nume de fisier
 * ("sedinta foto ana.jpg") sau un nume de persoana din doua cuvinte ("Ana
 * Maria") trebuie sa se potriveasca asa cum e scris, inainte sa spargem in
 * bucati. Un cuvant singur trece exact pe acelasi drum ca inainte — nimic din
 * comportamentul de pana acum nu se schimba.
 */
function matchesSearch(p: PhotoView, normalizedQuery: string, locale: Locale): boolean {
  if (matchesToken(p, normalizedQuery, locale)) return true;
  const cuvinte = normalizedQuery.split(/\s+/).filter(Boolean);
  if (cuvinte.length < 2) return false;
  return cuvinte.every(cuvant => matchesToken(p, cuvant, locale));
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
 * Cat de greu e cazul, pe o scara comuna 0..1 — mic = decizie limpede.
 *
 * Foloseste incertitudinea per poza cand exista, si distanta pana la prag ca
 * rezerva pentru pozele analizate inainte de acea functie. Rezerva e adusa pe
 * aceeasi scara ca incertitudinea (banda dintre praguri are latimea 30, iar
 * mijlocul ei, la 15, e cazul cel mai greu), ca cele doua sa poata sta
 * amestecate in aceeasi sortare fara ca una din ele sa castige mereu.
 */
export function reviewDifficulty(p: PhotoView): number {
  if (p.aiUncertainty !== undefined && Number.isFinite(p.aiUncertainty)) return p.aiUncertainty;
  const halfBand = (SELECT_THRESHOLD - REJECT_THRESHOLD) / 2;
  return Math.max(0, Math.min(1, reviewProximity(p.aiScore) / halfBand));
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
  vaultUnlocked: boolean;
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
  vaultUnlocked: boolean;
  result: PhotoView[];
} | null = null;

/**
 * Pozele pe care au voie sa le atinga operatiile in masa si exporturile.
 *
 * Bug gasit la audit, si e unul de INCREDERE, nu de comoditate: `moveToVault`
 * nu schimba `status`, iar ascunderea dosarului privat traia exclusiv in
 * filtered()/secondaryFiltered(). Toate celelalte operatii citeau `photos`
 * brut, deci:
 *
 *  - "Exporta selectia" scotea in ZIP si o poza privata marcata candva
 *    "Selectata", fara s-o arate si fara s-o numere;
 *  - "Galerie pentru client" o punea intr-un HTML trimis clientului;
 *  - "Sterge pozele respinse" o putea sterge FIZIC de pe telefon, desi omul
 *    n-o vedea in niciun ecran si in niciun contor.
 *
 * Regula, de acum: nicio operatie pornita din alta parte nu atinge continutul
 * dosarului privat, nici macar cand e deblocat in sesiunea curenta. Ce ai
 * ascuns deliberat se atinge doar din ecranul lui (VaultPanel), unde vezi exact
 * ce faci. Deblocarea serveste privitului, nu maturatului.
 */
function outsideVault(photos: PhotoView[], collections: CollectionRecord[]): PhotoView[] {
  const vault = collections.find(c => c.isPrivate);
  if (!vault?.memberIds.length) return photos;
  const hidden = new Set(vault.memberIds);
  return photos.filter(p => !hidden.has(p.id));
}

export const useStore = create<AppState>((set, get) => ({
  photos: [],
  persons: [],
  collections: [],
  progress: null,
  importCancelling: false,
  // Nu 'all': Android omoara WebView-ul aplicatiilor din fundal, Capacitor
  // reincarca pagina la revenire, si fara asta omul se intorcea de fiecare data
  // in alt loc decat il lasase. Vezi state/activeFilter.ts.
  filter: readActiveFilter(),
  personFilter: null,
  projectFilter: null,
  setProjectFilter: project => set({ projectFilter: project }),
  projectsOpen: false,
  setProjectsOpen: open => set({ projectsOpen: open }),
  collectionFilter: null,
  setCollectionFilter: collectionId => set({ collectionFilter: collectionId }),
  collectionsOpen: false,
  setCollectionsOpen: open => set({ collectionsOpen: open }),
  locationsOpen: false,
  /**
   * Poarta unica pentru functiile rezervate abonatilor.
   *
   * Aici, si nu in fiecare buton: aceleasi functii au cate 2-5 intrari diferite
   * (meniu, ecranul Acasa, foaia de export, paleta de comenzi, protectia
   * documentelor), iar o poarta pusa pe butoane inseamna ca prima intrare uitata
   * devine portita. Intoarce `true` cand a preluat ea actiunea — apelantul nu
   * mai face nimic.
   */
  gatePremium: reason => {
    if (!isPremiumFeatureLocked()) return false;
    set({ premiumOpen: true, premiumReason: reason ?? null });
    return true;
  },
  premiumReason: null,
  premium: isPremium(),
  premiumPurchasable: isPurchasable(),
  premiumLocked: isPremiumFeatureLocked(),
  photosUsedThisWindow: photosUsedInRollingMonth(),
  syncEntitlement: () => {
    const next = {
      premium: isPremium(),
      premiumPurchasable: isPurchasable(),
      premiumLocked: isPremiumFeatureLocked(),
      photosUsedThisWindow: photosUsedInRollingMonth()
    };
    const cur = get();
    // Comparatie inainte de set(): entitlement.ts anunta si dupa fiecare export,
    // iar un set() cu aceleasi valori ar re-randa degeaba toata grila.
    if (
      cur.premium === next.premium && cur.premiumPurchasable === next.premiumPurchasable &&
      cur.premiumLocked === next.premiumLocked && cur.photosUsedThisWindow === next.photosUsedThisWindow
    ) return;
    set(next);
  },
  setLocationsOpen: open => { if (open && get().gatePremium('locations')) return; set({ locationsOpen: open }); },
  tiktokSortOpen: false,
  // Deschiderea "normala" (fara scop explicit) porneste mereu pe toata coada,
  // nu pe ramasitele unui scop anterior (ex. dupa "Sorteaza acum ce ai adus").
  setTiktokSortOpen: open => set(open ? { tiktokSortOpen: true, tiktokSortScopeIds: null } : { tiktokSortOpen: false }),
  tiktokSortScopeIds: null,
  lastSupervisorImportIds: null,
  openTiktokSortForIds: ids => set({ tiktokSortOpen: true, tiktokSortScopeIds: ids, lastSupervisorImportIds: null }),

  sessionOutcome: null,
  dismissSessionOutcome: () => set({ sessionOutcome: null }),

  openDecisionInversions: async () => {
    const ids = selectDecisionInversions(
      get().photos.map(p => ({ id: p.id, groupId: p.groupId, status: p.status, aiScore: p.aiScore }))
    );
    if (!ids.length) {
      set({ notice: t(get().locale, 'store.decisionInversions.none') });
      return 0;
    }
    get().openTiktokSortForIds(ids);
    return ids.length;
  },

  openUncertainReview: async () => {
    const locale = get().locale;
    // Pozele pe care le-ai judecat deja tu: o corectie e inregistrata la
    // FIECARE decizie manuala (vezi ContextEngine.recordCorrection), deci logul
    // de corectii e exact lista "am spus deja ce cred despre asta".
    const decided = new Set((await db.corrections.toArray()).map(c => c.photoId));
    const ids = pickMostUncertain(
      get().photos.map(p => ({ id: p.id, aiScore: p.aiScore, status: p.status })),
      decided
    );
    if (!ids.length) {
      set({ notice: t(locale, 'store.uncertainReview.none') });
      return 0;
    }
    get().openTiktokSortForIds(ids);
    return ids.length;
  },
  searchPanelOpen: false,
  setSearchPanelOpen: open => {
    // Lista de localitati se incarca la deschiderea cautarii, nu la pornirea
    // aplicatiei: e un fisier pe care majoritatea sesiunilor nu-l ating deloc.
    if (open) void loadPlaceIndex();
    set({ searchPanelOpen: open });
  },
  duplicatesPanelOpen: false,
  setDuplicatesPanelOpen: open => set({ duplicatesPanelOpen: open }),
  rescueQueueOpen: false,
  setRescueQueueOpen: open => set({ rescueQueueOpen: open }),
  smartInboxOpen: false,
  setSmartInboxOpen: open => set({ smartInboxOpen: open }),
  momentsOpen: false,
  setMomentsOpen: open => set({ momentsOpen: open }),
  proMode: readProMode(),
  setProMode: on => {
    writeProMode(on);
    // Meniul chiar se schimba sub deget, dar intrarile care apar/dispar sunt
    // mai sus in lista, deci utilizatorul care apasa comutatorul (aflat jos, la
    // Setari) nu vede nimic miscandu-se si crede ca butonul nu face nimic.
    set({ proMode: on, notice: t(get().locale, on ? 'store.proMode.on' : 'store.proMode.off') });
  },
  quickScan: null,
  exactDupesOpen: false,
  setExactDupesOpen: open => set({ exactDupesOpen: open }),
  documentShieldOpen: false,
  setDocumentShieldOpen: open => set({ documentShieldOpen: open }),
  vaultOpen: false,
  // Poarta e DOAR pe crearea dosarului, nu pe deschiderea lui. Un abonament
  // expirat n-are voie sa incuie pe cineva in afara propriilor poze: alea sunt
  // deja acolo, ascunse din galerie, si singura cale spre ele e ecranul asta.
  // Cine are deja un dosar intra mereu; cine vrea sa-si faca unul, se aboneaza.
  setVaultOpen: open => { if (open && !hasVaultPin() && get().gatePremium('vault')) return; set({ vaultOpen: open }); },
  vaultUnlocked: isVaultUnlockedInSession(),
  setupVault: async pin => {
    await coreSetVaultPin(pin);
    setVaultUnlockedInSession(true);
    set({ vaultUnlocked: true });
  },
  unlockVault: async pin => {
    const ok = await verifyVaultPin(pin);
    if (ok) { setVaultUnlockedInSession(true); set({ vaultUnlocked: true }); }
    return ok;
  },
  lockVault: () => { setVaultUnlockedInSession(false); set({ vaultUnlocked: false }); },
  disableVault: async () => {
    const vault = get().collections.find(c => c.isPrivate);
    if (vault && vault.memberIds.length) await get().removeFromVault(vault.memberIds);
    coreClearVaultPin();
    setVaultUnlockedInSession(false);
    set({ vaultUnlocked: false });
  },
  moveToVault: async photoIds => {
    if (!photoIds.length) return;
    const vault = await getOrCreateVaultCollection();
    const updated = await addPhotosToCollectionRecord(vault.id, photoIds);
    if (!updated) return;
    // acelasi motiv ca addPhotosToCollection mai jos: fara originalul persistat,
    // o poza neselectata mutata in vault n-ar avea ce exporta ulterior din el
    await Promise.all(photoIds.map(pid => persistOriginalForCollectionMember(pid)));
    // Mutarea ASCUNDE poza din grila principala (vezi filtered() — colectia
    // privata e filtrata cat timp nu e deblocata in sesiune). Fara un mesaj,
    // gestul arata ca o disparitie inexplicabila, mai ales cand vine din meniul
    // contextual, unde nu se deschide niciun panou care sa confirme ce s-a
    // intamplat.
    const locale = get().locale;
    set(state => ({
      collections: state.collections.some(c => c.id === vault.id)
        ? state.collections.map(c => (c.id === vault.id ? updated : c))
        : [...state.collections, updated],
      notice: t(locale, plural(photoIds.length, 'store.vault.moved.one', 'store.vault.moved.other'), { count: photoIds.length })
    }));
  },
  removeFromVault: async photoIds => {
    if (!photoIds.length) return;
    const vault = get().collections.find(c => c.isPrivate);
    if (!vault) return;
    const updated = await removePhotosFromCollectionRecord(vault.id, photoIds);
    if (!updated) return;
    const nextCollections = get().collections.map(c => (c.id === vault.id ? updated : c));
    await Promise.all(photoIds.map(pid => cleanupOrphanedOriginal(pid, nextCollections)));
    set({ collections: nextCollections });
  },
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
  /**
   * Un folder per loc, dintr-un buton.
   *
   * Refoloseste un folder cu EXACT acelasi nume in loc sa faca al doilea: cine
   * apasa a doua oara pe "Roșiori de Vede, România" vrea acelasi folder, nu
   * inca unul identic langa el. Dosarul privat (isPrivate) e sarit deliberat la
   * cautarea dupa nume — n-are voie sa primeasca poze pe furis, dintr-un buton
   * care nu spune nicaieri "vault".
   *
   * Cand toate pozele erau deja acolo nu se scrie nimic si nu se minte cu
   * "N poze adaugate": se spune ca folderul exista deja.
   */
  createCollectionFromLocation: async (name, photoIds) => {
    const trimmed = name.trim();
    if (!trimmed || !photoIds.length) return null;
    const existing = get().collections.find(c => !c.isPrivate && c.name === trimmed);
    const target = existing ?? await get().createCollection(trimmed);
    if (!target) return null;
    const already = new Set(target.memberIds);
    const fresh = photoIds.filter(id => !already.has(id));
    if (!fresh.length) {
      set({ notice: t(get().locale, 'store.locations.folder.exists', { name: trimmed }) });
      return target;
    }
    await get().addPhotosToCollection(target.id, fresh);
    return get().collections.find(c => c.id === target.id) ?? target;
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
  homeGridOpen: false,
  setHomeGridOpen: open => set({ homeGridOpen: open }),
  batchOpsOpen: false,
  paletteOpen: false,
  shortcutsOpen: false,
  theme: readStoredTheme(),
  setTheme: theme => { applyTheme(theme); set({ theme }); },
  accentTheme: readStoredAccent(),
  setAccentTheme: accent => { applyAccent(accent); set({ accentTheme: accent }); },
  accessibleMode: readAccessibleMode(),
  setAccessibleMode: on => { applyAccessibleMode(on); set({ accessibleMode: on }); },
  smartNotificationsEnabled: readSmartNotificationEnabled(),
  setSmartNotificationsEnabled: on => {
    writeSmartNotificationEnabled(on);
    set({ smartNotificationsEnabled: on });
    const locale = get().locale;
    if (!on) { set({ notice: t(locale, 'store.smartNotifications.off') }); return; }

    // Bug real raportat de utilizator: "setări care nu schimbă nimic după
    // activare". Permisiunea se cerea deja aici, dar RASPUNSUL era ignorat —
    // daca sistemul o refuza (sau era deja refuzata), comutatorul ramanea
    // pornit si nu se intampla niciodata nimic, fara ca nimeni sa spuna de ce.
    // Acum fiecare cale de iesire raspunde ceva.
    //
    // A doua raportare, de pe telefon: raspunsul era "Browserul de aici nu poate
    // trimite notificari" — un cuvant care nu inseamna nimic pentru cineva care
    // a instalat o aplicatie din Play Store, la o setare care chiar nu facea
    // nimic acolo (WebView-ul Android n-are Notification API). Pe Android
    // notificarea trece acum prin sistem, printr-un plugin propriu
    // (core/nativeNotifications.ts). Iar cand platforma chiar nu poate,
    // comutatorul se stinge singur in loc sa ramana aprins degeaba.
    set({ notice: t(locale, 'store.smartNotifications.asking') });
    void requestNotificationAccess().then(access => {
      if (access === 'granted') {
        set({ notice: t(get().locale, 'store.smartNotifications.on') });
        return;
      }
      if (access === 'unsupported') {
        writeSmartNotificationEnabled(false);
        set({
          smartNotificationsEnabled: false,
          notice: t(get().locale, 'store.smartNotifications.unsupported')
        });
        return;
      }
      set({ notice: t(get().locale, 'store.smartNotifications.blocked') });
    });
  },
  zenMode: readZenMode(),
  setZenMode: on => {
    writeZenMode(on);
    // Modul Zen lucreaza abia la URMATORUL import (vezi runImport) — fara acest
    // raspuns, comutatorul parea ca nu face nimic, pentru ca efectul lui nu are
    // cum sa se vada in clipa apasarii.
    set({ zenMode: on, notice: t(get().locale, on ? 'store.zenMode.on' : 'store.zenMode.off') });
  },
  zenAutoDeleteObvious: readZenAutoDeleteObvious(),
  setZenAutoDeleteObvious: on => { writeZenAutoDeleteObvious(on); set({ zenAutoDeleteObvious: on }); },
  zenAskOnUncertain: readZenAskOnUncertain(),
  setZenAskOnUncertain: on => { writeZenAskOnUncertain(on); set({ zenAskOnUncertain: on }); },
  zenPanelOpen: false,
  setZenPanelOpen: open => set({ zenPanelOpen: open }),
  guideOpen: false,
  setGuideOpen: open => set({ guideOpen: open }),
  appearanceOpen: false,
  setAppearanceOpen: open => set({ appearanceOpen: open }),
  premiumOpen: false,
  // premiumReason: null la deschiderea DIN MENIU. Fara asta, cine loveste o
  // poarta (sa zicem, plansa de contact), inchide panoul, si il redeschide mai
  // tarziu din meniu, ar fi intampinat de un raspuns la o intrebare pe care n-a
  // mai pus-o. Portile isi seteaza motivul ele, prin gatePremium.
  setPremiumOpen: open => set(open ? { premiumOpen: true, premiumReason: null } : { premiumOpen: false }),
  exportDestinationsOpen: false,
  setExportDestinationsOpen: open => set({ exportDestinationsOpen: open }),
  welcomeSeen: readWelcomeSeen(),
  dismissWelcome: () => { writeWelcomeSeen(); set({ welcomeSeen: true }); },
  runZenResolve: async () => {
    const { zenAutoDeleteObvious, zenAskOnUncertain, locale } = get();
    const resolutions = resolveGroupsWithConfidence(outsideVault(get().photos, get().collections));
    const confident = resolutions.filter(r => r.confident);
    const uncertain = resolutions.filter(r => !r.confident);
    if (!confident.length) {
      if (zenAskOnUncertain && uncertain.length > 0) {
        set({ notice: t(locale, 'store.zenResolve.uncertainOnly', { count: uncertain.length }) });
      }
      return { resolved: 0, uncertain: uncertain.length, deleted: 0 };
    }

    const photosById = new Map(get().photos.map(p => [p.id, p]));
    const changes: { photoId: string; previousStatus: PhotoRecord['status'] }[] = [];
    const statusChanges: { id: string; status: PhotoRecord['status'] }[] = [];
    for (const g of confident) {
      const current = photosById.get(g.keepId);
      if (current?.status !== 'selected') {
        changes.push({ photoId: g.keepId, previousStatus: current?.status ?? 'pending' });
        statusChanges.push({ id: g.keepId, status: 'selected' });
      }
      for (const rejectId of g.rejectIds) {
        const rec = photosById.get(rejectId);
        if (rec?.status === 'rejected') continue;
        changes.push({ photoId: rejectId, previousStatus: rec?.status ?? 'pending' });
        statusChanges.push({ id: rejectId, status: 'rejected' });
      }
    }
    const { quotaError } = await applyBulkStatusChanges(statusChanges, status => status === 'selected');
    const keepIds = new Set(confident.map(g => g.keepId));
    const rejectIds = new Set(confident.flatMap(g => g.rejectIds));
    set(state => ({
      photos: state.photos.map(p => {
        if (keepIds.has(p.id)) return { ...p, status: 'selected' };
        if (rejectIds.has(p.id)) return { ...p, status: 'rejected' };
        return p;
      }),
      batchHistory: pushBatchHistory(state.batchHistory, makeBatchEvent(t(locale, 'store.batchEvent.zenResolve'), changes))
    }));

    // "Sterge automat duplicatele evidente, fara sa te intrebe" (mockup) — Android
    // tot arata propriul dialog de confirmare la stergere (MediaStore.createDeleteRequest
    // NU poate fi ocolit, la fel ca la deleteRejectedPhotos), doar aplicatia nu mai
    // adauga un al doilea dialog peste el. SCOPED strict la respinsele deciziei
    // curente de Mod Zen (rejectIds) — NU la toate pozele deja respinse in
    // biblioteca, ca sa nu stearga surprinzator ceva respins manual mai demult.
    let deletedCount = 0;
    if (zenAutoDeleteObvious && rejectIds.size > 0 && isNativeMediaLibraryAvailable()) {
      const justRejected = get().photos.filter(p => rejectIds.has(p.id) && !!p.mediaUri);
      if (justRejected.length) {
        try {
          const result = await deleteNativePhotos(justRejected.map(p => p.mediaUri!));
          if (!result.cancelled) {
            const ids = justRejected.map(p => p.id);
            const idSet = new Set(ids);
            await Promise.all([
              db.photos.bulkDelete(ids), db.thumbnails.bulkDelete(ids), db.previews.bulkDelete(ids),
              db.originals.bulkDelete(ids), db.fileHandles.bulkDelete(ids), db.analyses.bulkDelete(ids)
            ]);
            for (const id of ids) { originalFiles.delete(id); originalHandles.delete(id); }

            // Bug gasit la audit: se goleau cele 6 tabele, dar nu si apartenenta
            // la foldere — un folder din care s-au sters poze continua sa le
            // numere. Aceeasi omisiune ca pe calea manuala de stergere.
            const zenCollections = await Promise.all(
              get().collections.map(async c =>
                c.memberIds.some(pid => idSet.has(pid))
                  ? (await removePhotosFromCollectionRecord(c.id, ids)) ?? c
                  : c
              )
            );
            clearPreviewUrlCache();
            clearThumbUrlCache();
            deletedCount = ids.length;
            set(state => ({ photos: state.photos.filter(p => !idSet.has(p.id)), collections: zenCollections }));
          }
        } catch {
          // esec de stergere nativa aici nu trebuie sa blocheze restul rezultatului Mod Zen
          // (statusurile deja s-au aplicat) — acelasi compromis ca deleteRejectedPhotos.
        }
      }
    }

    const notice = quotaError
      ? quotaNotice(locale)
      : (zenAskOnUncertain && uncertain.length > 0)
        ? t(locale, 'store.zenResolve.notice', { count: confident.length, uncertain: uncertain.length })
        : t(locale, 'store.zenResolve.noticeSimple', { count: confident.length });
    set({ notice });

    return { resolved: confident.length, uncertain: uncertain.length, deleted: deletedCount };
  },
  galleryOverview: null,
  loadGalleryOverview: async () => {
    if (!isNativeMediaLibraryAvailable()) return;
    try {
      const result = await readGalleryOverview();
      set({ galleryOverview: result });
    } catch (err) {
      // esec de citire (plugin indisponibil, eroare MediaStore) — ramane null,
      // apelantul (UI) trateaza null identic cu "inca nu s-a cerut"
      console.warn('Nu am putut citi galeria:', err);
    }
  },
  galleryDateRange: null,
  loadGalleryDateRange: async () => {
    if (!isNativeMediaLibraryAvailable()) return;
    try {
      const result = await readGalleryDateRange();
      set({ galleryDateRange: result });
    } catch (err) {
      console.warn('Nu am putut citi intervalul de date al galeriei:', err);
    }
  },
  supervisorCoveredUntil: readCoveredUntil(),
  supervisorPeriodMonths: readPeriodMonths(),
  setSupervisorPeriodMonths: months => { writePeriodMonths(months); set({ supervisorPeriodMonths: months }); },
  supervisorNextPeriod: () => {
    const range = get().galleryDateRange;
    if (!range?.granted || range.earliestMs === undefined) return null;
    return computeNextPeriod({
      earliestMs: range.earliestMs, nowMs: Date.now(), coveredUntilMs: get().supervisorCoveredUntil,
      periodMs: periodMonthsToMs(get().supervisorPeriodMonths)
    });
  },
  supervisorAllPeriods: () => {
    const range = get().galleryDateRange;
    if (!range?.granted || range.earliestMs === undefined) return [];
    return listAllPeriods({
      earliestMs: range.earliestMs, nowMs: Date.now(), coveredUntilMs: get().supervisorCoveredUntil,
      periodMs: periodMonthsToMs(get().supervisorPeriodMonths)
    });
  },
  supervisorRemainingPeriod: () => {
    const range = get().galleryDateRange;
    if (!range?.granted || range.earliestMs === undefined) return null;
    return computeRemainingPeriod({ earliestMs: range.earliestMs, nowMs: Date.now(), coveredUntilMs: get().supervisorCoveredUntil });
  },
  supervisorCoveragePercent: () => {
    const range = get().galleryDateRange;
    if (!range?.granted || range.earliestMs === undefined) return 0;
    return computeGalleryCoveragePercent({ earliestMs: range.earliestMs, nowMs: Date.now(), coveredUntilMs: get().supervisorCoveredUntil });
  },
  supervisorImporting: false,
  importGalleryPeriod: async period => {
    if (get().supervisorImporting) return;
    // Cu acces PARTIAL, cererea de permisiune nu mai are ce declansa: sistemul
    // nu reafiseaza dialogul pentru READ_MEDIA_IMAGES odata ce utilizatorul a
    // ales "doar pozele selectate", deci apelul nativ ar astepta un raspuns
    // care nu vine. Iesim inainte, cu singurul mesaj care ajuta aici — drumul
    // spre Setari (vezi ui/PhotosAccessNotice.tsx, care il si ofera).
    if ((await getPhotosAccess()) === 'limited') {
      set({ notice: t(get().locale, 'gallerySupervisor.noAccess') });
      return;
    }
    set({ supervisorImporting: true });
    const locale = get().locale;
    const beforeIds = new Set(get().photos.map(p => p.id));
    // Citirea din galerie e INAINTE de runImport, care isi ia propria blocare —
    // pe un lot mare tine minute bune, iar ecranul se stingea taman atunci.
    // Blocarea e refcontorizata (core/wakeLock.ts), deci suprapunerea e sigura.
    const releaseWakeLock = keepScreenAwake();
    try {
      // Fara asta, citirea a 839 de poze dura minute intregi cu ecranul gol
      // si utilizatorul credea ca aplicatia e blocata (raportat cu captura).
      const read = await pickPhotosInRange(period.start, period.end, (done, total) =>
        set({ progress: { done, total, fileName: '', phase: 'citire' } })
      );
      // Citirea s-a terminat: runImport isi pune propriul progres mai jos, iar
      // pe caile fara import (acces refuzat, perioada goala) nu trebuie sa ramana
      // o bara inghetata pe ecran.
      set({ progress: null });
      // Acces refuzat/partial: NU avansam cursorul si spunem exact ce s-a
      // intamplat. Bug real raportat de utilizator: "Adu pozele" parea ca nu
      // face nimic, minute intregi, fara niciun mesaj — pentru ca "n-am avut
      // voie sa citesc" era tratat identic cu "perioada e goala". In plus,
      // perioada ramanea marcata acoperita, deci pozele din ea nu mai erau
      // propuse niciodata.
      if (!read.granted) {
        set({ notice: t(locale, 'gallerySupervisor.noAccess') });
        return;
      }
      const picked = read.photos;
      // Cursorul avanseaza DUPA o citire reusita (chiar daca perioada era goala —
      // nimic de adus acolo, dar tot "acoperita") — o eroare de citire (permisiune
      // refuzata, plugin indisponibil) NU trebuie sa avanseze cursorul, ca aceeasi
      // perioada sa ramana recomandata data viitoare. Math.max: o perioada aleasa
      // manual, MAI VECHE decat cursorul curent (re-sortare, cu confirmare in UI —
      // vezi GallerySupervisorPanel.tsx), nu trebuie sa DEA INAPOI cursorul si sa
      // "descopere" ca nesortate perioade mai noi, deja acoperite.
      const nextCovered = Math.max(get().supervisorCoveredUntil ?? period.end, period.end);
      writeCoveredUntil(nextCovered);
      set({ supervisorCoveredUntil: nextCovered });
      if (picked.length) {
        await get().runImport(picked.map(p => p.file), undefined, picked.map(p => p.uri));
        // "Sorteaza acum ce ai adus" (idee proprie) — diferenta fata de starea
        // dinainte de import, ca sa stim exact ce a fost adus ACUM, nu tot ce e
        // in coada de sortare (poate exista deja alt continut nesortat).
        const newIds = get().photos.filter(p => !beforeIds.has(p.id)).map(p => p.id);
        if (newIds.length) set({ lastSupervisorImportIds: newIds });
      } else {
        set({ notice: t(locale, 'gallerySupervisor.periodEmpty') });
      }
    } catch (err) {
      set({ notice: t(locale, 'gallerySupervisor.failed', { error: String(err) }) });
    } finally {
      releaseWakeLock();
      set({ supervisorImporting: false });
    }
  },
  skipGalleryPeriod: period => {
    // Aceeasi logica de non-regresie ca importGalleryPeriod, dar fara nicio
    // citire/import — cursorul avanseaza ca si cum perioada ar fi fost adusa.
    const nextCovered = Math.max(get().supervisorCoveredUntil ?? period.end, period.end);
    writeCoveredUntil(nextCovered);
    set({ supervisorCoveredUntil: nextCovered });
  },
  supervisorPanelOpen: false,
  setSupervisorPanelOpen: open => set({ supervisorPanelOpen: open }),
  galleryFolders: null,
  loadGalleryFolders: async () => {
    if (!isNativeMediaLibraryAvailable()) return;
    try {
      const result = await readGalleryFolders();
      set({ galleryFolders: result });
    } catch (err) {
      console.warn('Nu am putut citi folderele galeriei:', err);
    }
  },
  supervisorImportedFolderIds: readImportedFolderIds(),
  excludedFolderIds: readExcludedFolderIds(),
  protectedPersons: readProtectedPersons(),
  toggleProtectedPerson: name => {
    const next = new Set(get().protectedPersons);
    if (next.has(name)) next.delete(name); else next.add(name);
    writeProtectedPersons(next);
    set({ protectedPersons: next });
  },
  toggleFolderExcluded: bucketId => {
    const next = new Set(get().excludedFolderIds);
    if (next.has(bucketId)) next.delete(bucketId); else next.add(bucketId);
    writeExcludedFolderIds(next);
    set({ excludedFolderIds: next });
  },
  importGalleryFolder: async bucketId => {
    if (get().supervisorImporting) return;
    set({ supervisorImporting: true });
    const locale = get().locale;
    const beforeIds = new Set(get().photos.map(p => p.id));
    const releaseWakeLock = keepScreenAwake();
    try {
      const read = await pickPhotosInFolder(bucketId, (done, total) =>
        set({ progress: { done, total, fileName: '', phase: 'citire' } })
      );
      set({ progress: null });
      if (!read.granted) {
        set({ notice: t(locale, 'gallerySupervisor.noAccess') });
        return;
      }
      const picked = read.photos;
      const coveredFolders = new Set(get().supervisorImportedFolderIds).add(bucketId);
      writeImportedFolderIds(coveredFolders);
      set({ supervisorImportedFolderIds: coveredFolders });
      if (picked.length) {
        await get().runImport(picked.map(p => p.file), undefined, picked.map(p => p.uri));
        const newIds = get().photos.filter(p => !beforeIds.has(p.id)).map(p => p.id);
        if (newIds.length) set({ lastSupervisorImportIds: newIds });
      } else {
        set({ notice: t(locale, 'gallerySupervisor.periodEmpty') });
      }
    } catch (err) {
      set({ notice: t(locale, 'gallerySupervisor.failed', { error: String(err) }) });
    } finally {
      releaseWakeLock();
      set({ supervisorImporting: false });
    }
  },
  importAllGalleryFolders: async () => {
    if (get().supervisorImporting) return;
    const coveredFolders = get().supervisorImportedFolderIds;
    // Extindere proprie fata de cerinta initiala ("si la foldere, la fel"):
    // sare peste folderele deja aduse macar o data, ca "Toate folderele" sa
    // nu re-aduca aceleasi poze de fiecare data — un folder deja acoperit
    // ramane totusi accesibil individual din lista, cu confirmare (vezi
    // GallerySupervisorPanel.tsx).
    // ...si peste cele excluse definitiv de utilizator. Fara asta, "Toate
    // folderele" aducea si Screenshots, si WhatsApp Images — adica exact
    // traficul pentru care nimeni nu vrea sa ia decizii cadru cu cadru.
    const excluded = get().excludedFolderIds;
    const folders = (get().galleryFolders?.folders ?? [])
      .filter(f => !coveredFolders.has(f.id) && !excluded.has(f.id));
    if (!folders.length) return;
    set({ supervisorImporting: true });
    const locale = get().locale;
    const beforeIds = new Set(get().photos.map(p => p.id));
    const releaseWakeLock = keepScreenAwake();
    try {
      // Cate un apel per folder, in paralel — fiecare folder al galeriei e independent,
      // acelasi motiv pentru care pickPhotosInFolder/pickPhotosInRange trateaza deja
      // fiecare poza individual (Promise.allSettled) fara sa opreasca tot lotul la o eroare.
      // Un contor comun peste toate folderele: fiecare apel raporteaza propriul
      // total, iar utilizatorul trebuie sa vada inaintarea intregii operatii.
      let readDone = 0;
      const results = await Promise.all(folders.map(f => pickPhotosInFolder(f.id, () =>
        set({ progress: { done: ++readDone, total: 0, fileName: '', phase: 'citire' } })
      )));
      set({ progress: null });
      // Un singur refuz de acces opreste tot: daca nu putem citi galeria, a
      // marca fie si un singur folder drept adus ar ascunde pozele lui pentru
      // totdeauna din "Toate folderele".
      if (results.some(r => !r.granted)) {
        set({ notice: t(locale, 'gallerySupervisor.noAccess') });
        return;
      }
      const picked = results.flatMap(r => r.photos);
      const nextCovered = new Set(coveredFolders);
      folders.forEach(f => nextCovered.add(f.id));
      writeImportedFolderIds(nextCovered);
      set({ supervisorImportedFolderIds: nextCovered });
      if (picked.length) {
        await get().runImport(picked.map(p => p.file), undefined, picked.map(p => p.uri));
        const newIds = get().photos.filter(p => !beforeIds.has(p.id)).map(p => p.id);
        if (newIds.length) set({ lastSupervisorImportIds: newIds });
      } else {
        set({ notice: t(locale, 'gallerySupervisor.periodEmpty') });
      }
    } catch (err) {
      set({ notice: t(locale, 'gallerySupervisor.failed', { error: String(err) }) });
    } finally {
      releaseWakeLock();
      set({ supervisorImporting: false });
    }
  },
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
  setContactSheetOpen: open => { if (open && get().gatePremium('contactSheet')) return; set({ contactSheetOpen: open }); },
  presentationOpen: false,
  setPresentationOpen: open => { if (open && get().gatePremium('presentation')) return; set({ presentationOpen: open }); },
  presentationPhotoIds: null,
  setPresentationPhotoIds: ids => set({ presentationPhotoIds: ids }),

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
    const selected = outsideVault(get().photos, get().collections).filter(p => p.status === 'selected');
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
    // Abonamentul se reverifica la fiecare pornire: poate fi expirat, anulat,
    // rambursat sau cumparat pe alt dispozitiv de la ultima deschidere. Nu se
    // asteapta dupa el — restul pornirii nu depinde de retea.
    // ...cu reincercari: un singur apel pierdut la pornirea la rece lasa
    // `isPurchasable()` fals o sesiune intreaga, adica toate functiile platite
    // deschise (bug raportat de utilizator). Vezi refreshEntitlementAtStartup.
    void refreshEntitlementAtStartup();
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

  runImport: async (files: File[], handles?: (FileSystemFileHandleLike | undefined)[], mediaUris?: (string | undefined)[]) => {
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
    set({ progress: { done: 0, total: files.length, fileName: '', phase: 'incarcare' }, importCancelling: false, quickScan: null });
    // Ecranul ramane aprins cat dureaza importul: altfel se stingea singur dupa
    // 30s-1min de inactivitate, sistemul suspenda WebView-ul si analiza se
    // oprea la jumatate (vezi core/wakeLock.ts pentru ce NU rezolva asta).
    const releaseWakeLock = keepScreenAwake();
    let warning: string | undefined;
    /** Bilantul in cifre al lotului, raportat de pipeline pe ultimul apel — vezi core/importOutcome.ts. */
    let outcomeReport: ImportOutcomeReport | undefined;
    let done = 0;
    const startedAt = Date.now();
    // separat de `startedAt` (folosit pentru lastImportStats, care include si
    // faza 'incarcare' de dinainte de bucla) — vrem rata reala doar din faza
    // 'analiza', altfel primele tick-uri ar subestima rata si ar umfla ETA-ul
    // Numara doar timpul in PRIM-PLAN: cu aplicatia minimizata, Android suspenda
    // WebView-ul si nu se proceseaza nimic, iar timpul acela bagat in medie
    // umfla estimarea in loc s-o scada (raportat de utilizator, cu doua capturi:
    // 155/839 "~23m ramase", apoi 162/839 "~41m ramase"). Vezi core/activeElapsed.ts.
    let analysisClock: ActiveElapsed | null = null;
    /** Ultima valoare ARATATA, nu ultima calculata — vezi core/etaEstimate.ts pentru de ce difera. */
    let shownEtaSeconds: number | undefined;
    const onAnalysisVisibility = () =>
      analysisClock?.setVisible(document.visibilityState === 'visible', Date.now());
    document.addEventListener('visibilitychange', onAnalysisVisibility);
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
    /** Id-urile pozelor din ACEST lot — rezultatul de la final se raporteaza doar despre ele, nu despre toata biblioteca. */
    const importedIds: string[] = [];
    let flushTimer: ReturnType<typeof setTimeout> | null = null;
    const flushPendingPhotos = () => {
      if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
      if (!pendingPhotos.length) return;
      const batch = pendingPhotos;
      pendingPhotos = [];
      set(state => ({ photos: [...state.photos, ...batch] }));
    };
    // Raportate o singura data de importFiles, doar cand plasa de siguranta chiar
    // a mutat un prag — vezi core/scoreThresholds.ts.
    let adaptedThresholds: Thresholds | undefined;
    const PHOTO_FLUSH_BATCH = 15;
    const PHOTO_FLUSH_INTERVAL_MS = 200;
    // Coordonatele GPS, citite NATIV inainte de analiza — un singur apel pentru
    // tot lotul. Nu pot fi luate din bytes-ii pozei: Android 10+ le sterge din
    // EXIF-ul servit aplicatiei (vezi core/nativeMediaLibrary.ts
    // readNativePhotoLocations si comentariul din importPipeline.ts:processOne).
    // Fara ele, "Locatii" ar arata totul intr-o singura grupa fara locatie — bug real
    // raportat de utilizator. Harta e goala pe web/PWA, la import prin
    // <input type="file"> (fara mediaUri) sau daca permisiunea e refuzata;
    // importul merge mai departe identic in toate cazurile.
    // Conditionat, nu neconditionat: fara niciun URI nativ (web/PWA, import prin
    // <input type="file">) nu exista ce intreba, iar un `await` degeaba ar muta
    // apelul importFiles de mai jos intr-un microtask urmator — adica ar schimba
    // ordinea observabila a unui import care pana acum pornea sincron.
    const knownUris = (mediaUris ?? []).filter((u): u is string => !!u);
    const mediaLocations = knownUris.length ? await readNativePhotoLocations(knownUris) : undefined;
    try {
      await importFiles(
        files,
        progress => {
          warning = progress.warning; done = progress.done;
          if (progress.outcome) outcomeReport = progress.outcome;
          // Cifra din primele secunde — vezi core/quickDuplicateScan.ts. Se
          // pastreaza dupa ce progresul dispare: e prima si singura informatie
          // concreta pe care o primeste utilizatorul cat timp analiza ruleaza.
          if (progress.quickScan) set({ quickScan: progress.quickScan });
          if (progress.thresholds) adaptedThresholds = progress.thresholds;
          let etaSeconds: number | undefined;
          if (progress.phase === 'analiza') {
            if (analysisClock === null) {
              analysisClock = createActiveElapsed(document.visibilityState === 'visible', Date.now());
            }
            const elapsedSec = analysisClock.elapsedMs(Date.now()) / 1000;
            const remaining = progress.total - progress.done;
            // sub 1s scursa sau 0 poze gata => rata nu inseamna inca nimic (ar
            // da un ETA fals de precis din 1-2 tick-uri) — asteptam date reale
            if (elapsedSec > 1 && progress.done > 0 && remaining > 0) {
              // Rata medie de pana acum, trecuta apoi prin filtrul de afisare
              // (rotunjire + cresterile mici ignorate) — vezi core/etaEstimate.ts.
              shownEtaSeconds = stabilizeEta(shownEtaSeconds, (elapsedSec / progress.done) * remaining);
              etaSeconds = shownEtaSeconds;
            }
          }
          set({ progress: { ...progress, etaSeconds } });
        },
        item => {
          importedIds.push(item.photo.id);
          pendingPhotos.push(toView(item.photo, item.analysis));
          if (pendingPhotos.length >= PHOTO_FLUSH_BATCH) { flushPendingPhotos(); return; }
          if (!flushTimer) flushTimer = setTimeout(flushPendingPhotos, PHOTO_FLUSH_INTERVAL_MS);
        },
        cancelToken,
        get().genre,
        get().projectName,
        handles,
        mediaUris,
        mediaLocations
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
      document.removeEventListener('visibilitychange', onAnalysisVisibility);
      if (activeCancelToken === cancelToken) activeCancelToken = null;
      set({ importCancelling: false });
      releaseWakeLock();
    }
    // reincarca statusurile si groupId-urile persistate dupa gruparea seriilor
    const fresh = await db.photos.toArray();
    const byId = new Map(fresh.map(p => [p.id, p]));
    const aiDegraded = !analysisPool.isAccelerated;
    // Rezultatul lotului, din statusurile DEJA recitite mai sus (dupa gruparea
    // seriilor, deci reflecta si demovarile facute de ea) — nicio interogare in
    // plus. Restrans la pozele acestui import: `photoIds` sunt exact ele.
    const batch = importedIds.map(id => byId.get(id)).filter((p): p is PhotoRecord => !!p);
    const scoreById = new Map(get().photos.map(p => [p.id, p.aiScore]));
    const sessionOutcome = summarizeSession({
      // `batch.length`, NU `done`. Bug real raportat de utilizator: dupa un
      // import anulat la 52/437, cardul anunta "36 din 56 poze" si "ti-am lasat
      // 20 de verificat", cand de verificat erau 3. `done` e contorul barei de
      // progres — numara si pozele sarite sau esuate, si continua sa creasca
      // pana la anulare. `batch` sunt pozele care chiar au ajuns in baza, deci
      // singurele despre care avem dreptul sa raportam ceva.
      imported: batch.length,
      autoDecided: batch.filter(p => p.status === 'selected' || p.status === 'rejected').length,
      seriesFound: new Set(batch.map(p => p.groupId).filter(Boolean)).size,
      // Cate ies la limita, ca butonul de verificare sa NU apara cand n-are ce
      // arata. Setul de "deja decise de tine" e gol pe buna dreptate: pozele
      // astea tocmai au fost importate, deci nu exista nicio corectie pe ele.
      //
      // Scorul se ia din `photos` (starea deja incarcata, sincron dupa
      // flushPendingPhotos), nu din `batch`: aiScore sta in db.analyses, iar o
      // citire de acolo ar aduce si embedding-urile — zeci de MB pentru un
      // simplu numar. Statusul, in schimb, se ia din `batch`, care e recitit
      // dupa gruparea seriilor si deci mai proaspat.
      uncertain: pickMostUncertain(
        batch.map(p => ({ id: p.id, aiScore: scoreById.get(p.id) ?? 0, status: p.status })),
        new Set<string>(),
        Number.MAX_SAFE_INTEGER
      ).length,
      durationMs: Date.now() - startedAt
    });
    // Contor pur STATISTIC de poze analizate luna aceasta (il arata ecranul
    // Statistici). Nu mai exista niciun prag legat de el, si nici notificare la
    // depasire — vezi state/usage.ts.
    //
    // Bug real gasit la audit: aici se anunta "ai trecut de pragul orientativ de
    // 750 al nivelului gratuit", in timp ce modelul chiar aplicat de aplicatie
    // (core/entitlement.ts) spune exact pe dos — triajul e gratuit la nesfarsit,
    // oricate poze, iar plafonul de 150 e doar pe pozele SCOASE din aplicatie.
    // Deci aceluiasi utilizator i se aratau doua "niveluri gratuite" diferite,
    // cu doua cifre diferite, dintre care unul nu exista. Cine importa 800 de
    // poze credea ca a consumat ceva, desi importul e si ramane nelimitat.
    const monthlyUsage = recordUsage(done);
    // fara asta, dupa un import reusit fara avertismente, utilizatorul nu primea
    // NICIO confirmare vizibila ca s-a intamplat ceva — bara de progres disparea
    // pur si simplu, fara mesaj, indiferent daca importul reusise sau nu; doar
    // erorile/avertismentele aveau notificare, nu si succesul simplu, comun
    // Ziua asta ramane marcata ca zi cu import chiar daca pozele dispar mai
    // tarziu (Goleste sesiunea, stergerea respinselor) — vezi state/streak.ts.
    if (done > 0) recordImportDay();
    // Ce s-a intamplat la importul asta, pastrat dupa ce dispare notificarea.
    // `imported` se ia din `batch` (pozele chiar ajunse in baza), nu din
    // raportul pipeline-ului: e acelasi numar pe care il raporteaza si cardul
    // de sesiune, deci cele doua ecrane nu se pot contrazice.
    if (outcomeReport) {
      recordImportOutcome({
        ts: Date.now(),
        total: outcomeReport.total,
        imported: batch.length,
        failed: outcomeReport.failed,
        skipped: outcomeReport.skipped,
        reasons: outcomeReport.reasons
      });
    }
    const doneNotice = done > 0
      ? t(get().locale, plural(done, 'store.import.done.one', 'store.import.done.other'), { count: done })
        + (adaptedThresholds
            ? ' ' + t(get().locale, 'store.import.thresholdsAdapted', { select: adaptedThresholds.select, reject: adaptedThresholds.reject })
            : '')
      : undefined;
    set(state => ({
      progress: null,
      notice: warning ?? doneNotice ?? state.notice,
      aiDegraded,
      aiBackend: analysisPool.detectedBackend,
      lastImportStats: done > 0 ? { count: done, durationMs: Date.now() - startedAt } : state.lastImportStats,
      sessionOutcome,
      monthlyUsage,
      photos: state.photos.map(p => {
        const rec = byId.get(p.id);
        return rec ? { ...p, status: rec.status, groupId: rec.groupId } : p;
      })
    }));
    // "Mod Zen": rezolva automat grupurile clare dupa import, in loc sa astepte
    // un click pe "Rezolva toate seriile" — vezi runZenResolve/zenResolve.ts
    // pentru distinctia intre grupuri "confidente" (rezolvate) si "incerte"
    // (doar semnalate). Doar cand au intrat poze noi (done > 0) — altfel un
    // import gol/anulat n-are ce rezolva.
    if (done > 0 && get().zenMode) {
      await get().runZenResolve();
    }
  },

  explainPhotoId: null,
  setExplainPhotoId: photoId => set({ explainPhotoId: photoId }),

  explainDecision: async (photoId, reasonIds, note) => {
    const photo = get().photos.find(p => p.id === photoId);
    if (!photo) return;
    const trimmed = note.trim();

    await db.photos.update(photoId, {
      ...(reasonIds.length ? { decisionReasons: reasonIds } : { decisionReasons: undefined }),
      ...(trimmed ? { decisionNote: trimmed } : { decisionNote: undefined })
    });

    // Motivele apasate re-antreneaza aceeasi decizie, de data asta cu vina pusa
    // unde a spus omul. Nota scrisa nu intra aici, si nu din lene: n-avem pe
    // telefon nimic care sa citeasca romana si s-o transforme intr-o pondere.
    const locale = get().locale;
    let learned: string | null = null;
    if (reasonIds.length && (photo.status === 'selected' || photo.status === 'rejected')) {
      const { topShift } = await train(photoId, photo.status === 'selected', featuresForReasons(reasonIds));
      learned = topShift?.label ?? null;
    }

    set(state => ({
      photos: state.photos.map(p => p.id === photoId
        ? { ...p, decisionReasons: reasonIds.length ? reasonIds : undefined, decisionNote: trimmed || undefined }
        : p),
      notice: learned
        ? t(locale, 'store.explain.learned', { factor: learned })
        : t(locale, 'store.explain.saved')
    }));
  },

  setStatus: async (id, status) => {
    const previousStatus = get().photos.find(p => p.id === id)?.status;
    // `candidate` intra si el aici: e o decizie a omului, deci merita aceeasi
    // confirmare haptica. NU intra insa in ramura de invatare de mai jos —
    // "o tin deoparte" nu e o judecata absoluta despre poza, si a o antrena ca
    // pastrare ar invata motorul exact ce omul a refuzat sa spuna.
    const isRealChange = isUserDecided(status) && status !== previousStatus;
    // Feedback haptic pentru ORICE decizie (tastatura, butoane tap, swipe) — bug real gasit
    // de auditul QA: inainte, doar gestul de swipe din DetailView vibra; utilizatorii care
    // apasa butoanele mari Selecteaza/Respinge (probabil majoritatea pe telefon, swipe-ul
    // cere mai multa precizie) nu primeau niciodata confirmarea haptica.
    if (isRealChange) {
      vibrate(status === 'selected' ? 14 : status === 'candidate' ? [10, 30, 10] : [12, 40, 12]);
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
    // Stelele antreneaza si ele motorul. Pana acum invata DOAR din
    // Selecteaza/Respinge, desi un 5 e cea mai clara parere pe care o dai
    // despre o poza, iar 1 stea la fel, in celalalt sens. Doar extremele:
    // 3 stele e literalmente "asa si asa", n-ar trebui sa impinga in nicio
    // directie, iar 0 inseamna "fara rating", nu "poza slaba".
    const decision = ratingDecision(clamped);
    if (decision !== null) await train(id, decision);
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
   * Aplica ACELEASI ajustari tuturor celorlalte cadre din acelasi moment.
   *
   * Un fix aprobat pe un cadru e aproape sigur bun si pe restul cadrelor din
   * aceeasi lumina: aceeasi expunere gresita, acelasi cer ars. Pana acum
   * trebuia repetat manual, cadru cu cadru, iar la 18 cadre nimeni nu o face.
   *
   * Doar cadrele care NU au deja editari proprii: o corectie facuta manual de
   * utilizator pe un cadru anume nu are voie sa fie stearsa de o aplicare in
   * lot. Reversibil ca orice operatie in masa.
   */
  applyEditsToMoment: async (sourceId, ids) => {
    const source = get().photos.find(p => p.id === sourceId);
    if (!source?.edits) return { applied: 0 };
    const targets = get().photos.filter(p => ids.includes(p.id) && p.id !== sourceId && isNeutral(p.edits));
    if (!targets.length) return { applied: 0 };
    const edits = source.edits;
    await Promise.all(targets.map(p => db.photos.update(p.id, { edits })));
    const targetIds = new Set(targets.map(p => p.id));
    const locale = get().locale;
    set(state => ({
      photos: state.photos.map(p => (targetIds.has(p.id) ? { ...p, edits } : p)),
      notice: t(locale, 'edit.appliedToMoment', { count: targets.length })
    }));
    return { applied: targets.length };
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
    }
    // O singura data pentru toata seria, si ca PERECHI — vezi trainPreference.
    await trainPreference(keepId, members.filter(m => m.id !== keepId).map(m => m.id));
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
    }
    // Fiecare pastrat a batut fiecare respins din aceeasi serie. Intre doi
    // pastrati nu exista comparatie: omul nu i-a departajat, deci nici noi.
    const rejectedIds = members.filter(m => !keepSet.has(m.id)).map(m => m.id);
    for (const keptId of keepIds) await trainPreference(keptId, rejectedIds);
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
    const learnedWeight = await contextEngine.learnedWeight();
    return pickBestInGroup(members.map((m, i) => {
      const a = analyses[i];
      return {
        id: m.id,
        aiScore: a?.aiScore ?? m.aiScore,
        sharpness: a?.sharpness ?? m.sharpness,
        exposure: a?.exposure ?? m.exposure,
        compositionScore: a?.compositionScore,
        faceCount: m.faceCount,
        bestSmile: m.bestSmile,
        groupSmileRatio: m.groupSmileRatio,
        allEyesOpen: m.allEyesOpen,
        groupEyesOpenRatio: m.groupEyesOpenRatio,
        groupAwkwardRatio: m.groupAwkwardRatio ?? a?.groupAwkwardRatio,
        subjectInFocus: a?.subjectInFocus,
        highlightClipping: a?.highlightClipping,
        avgEyeContact: a?.avgEyeContact
      };
    }), learnedWeight);
  },

  /**
   * Ca si keepOnlyInGroup, actiunea are propria confirmare explicita in UI
   * (BatchOpsPanel), cu numarul exact afisat inainte de aplicare — dar acum
   * e si reversibila dintr-o data cu Ctrl+Z (batchHistory), nu doar protejata
   * de confirm() la aplicare.
   */
  bulkRejectBelow: async (threshold) => {
    // Protectia se aplica DUPA ce operatia si-a ales tintele — un singur filtru,
    // in acelasi loc, in loc sa fie strecurat in fiecare selector si uitat la
    // urmatorul adaugat. Vezi state/protectedPersons.ts.
    const targets = excludeProtected(selectBulkRejectTargets(outsideVault(get().photos, get().collections), threshold), get().protectedPersons);
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

  /**
   * Copiile in plus ale aceleiasi poze — vezi core/exactDuplicates.ts pentru cum
   * se stabileste ca sunt chiar identice si care dintre ele ramane.
   *
   * Nu sterge nimic: le trece pe "respinse", exact ca orice alta decizie, deci
   * se vad in filtrul de respinse, se pot readuce una cate una, si toata
   * operatia se anuleaza dintr-o data cu Ctrl+Z. Stergerea de pe dispozitiv
   * ramane un pas separat, cerut explicit de utilizator.
   *
   * Protectia persoanelor NU se aplica aici, si e o alegere: doua fisiere
   * identice bit cu bit nu sunt "poza cu copilul si inca una" — sunt aceeasi
   * poza de doua ori, iar cea pastrata ramane oricum in biblioteca.
   */
  rejectExactDuplicates: async ids => {
    const byId = new Map(get().photos.map(p => [p.id, p]));
    const targets = ids.map(id => byId.get(id)).filter((p): p is PhotoView => !!p && p.status !== 'rejected');
    if (!targets.length) return { affected: 0 };
    const changes = targets.map(p => ({ photoId: p.id, previousStatus: p.status }));
    const { quotaError } = await applyBulkStatusChanges(
      targets.map(p => ({ id: p.id, status: 'rejected' as const })),
      () => false
    );
    const targetIds = new Set(targets.map(p => p.id));
    const locale = get().locale;
    set(state => ({
      photos: state.photos.map(p => (targetIds.has(p.id) ? { ...p, status: 'rejected' } : p)),
      batchHistory: pushBatchHistory(state.batchHistory, makeBatchEvent(t(locale, 'store.batchEvent.exactDupes'), changes)),
      notice: quotaError ? quotaNotice(locale) : t(locale, 'store.exactDupes.notice', { count: targets.length })
    }));
    return { affected: targets.length };
  },

  resolveAllSeries: async () => {
    const resolutions = resolveGroups(outsideVault(get().photos, get().collections));
    const protectedForSeries = get().protectedPersons;
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
        // Persoana protejata: nu o respingem automat nici cand pierde in serie.
        // Un cadru putin miscat in care copilul rade e exact ce nu vrei sa
        // dispara pentru ca a luat un scor mai mic. Vezi state/protectedPersons.ts.
        if (rec && protectedForSeries.size && rec.personNames.some(n => protectedForSeries.has(n))) continue;
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
    const { selectIds, rejectIds: rawRejectIds } = selectTopPercent(outsideVault(get().photos, get().collections), percent);
    // Doar RESPINGERILE se filtreaza: a scoate o poza protejata si din lista de
    // pastrate ar fi absurd — protectia inseamna "nu o arunca", nu "nu o atinge".
    const protectedNames = get().protectedPersons;
    const photoIndex = new Map(get().photos.map(p => [p.id, p]));
    const rejectIds = protectedNames.size
      ? rawRejectIds.filter(id => { const ph = photoIndex.get(id); return !ph || !ph.personNames.some(n => protectedNames.has(n)); })
      : rawRejectIds;
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
    // Aceleasi praguri pentru toata biblioteca, calculate o data — vezi
    // core/scoreThresholds.ts si nota din importFiles. Citite INAINTE de bucla:
    // scorurile se rescriu pe parcurs, iar un prag recalculat la mijloc ar
    // clasifica ultimele poze dupa alte reguli decat primele.
    const thresholds = deriveThresholds(await readLibraryScores());
    const changes: { photoId: string; previousStatus: PhotoRecord['status'] }[] = [];
    const updates = new Map<string, { aiScore: number; aiFactors: { feature: string; contribution: number }[]; aiUncertainty: number; status: PhotoRecord['status'] }>();
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
      const newStatus = decidePhotoStatus(prediction.score, analysis, thresholds);
      await db.analyses.update(p.id, { aiScore: prediction.score, aiFactors: prediction.topFactors, aiUncertainty: prediction.uncertainty, aiPersonalDelta: prediction.personalDelta });
      if (newStatus !== photoRecord.status) {
        changes.push({ photoId: p.id, previousStatus: photoRecord.status });
        await db.photos.update(p.id, { status: newStatus });
        const res = await syncOriginal(p.id, newStatus);
        if (res.quotaError) quotaError = true;
      }
      updates.set(p.id, { aiScore: prediction.score, aiFactors: prediction.topFactors, aiUncertainty: prediction.uncertainty, status: newStatus });
    }));

    set(state => ({
      photos: state.photos.map(p => {
        const u = updates.get(p.id);
        return u ? { ...p, aiScore: u.aiScore, aiFactors: u.aiFactors, aiUncertainty: u.aiUncertainty, status: u.status } : p;
      }),
      batchHistory: changes.length
        ? pushBatchHistory(state.batchHistory, makeBatchEvent(t(locale, 'store.batchEvent.rescore', { count: changes.length }), changes))
        : state.batchHistory,
      notice: quotaError ? quotaNotice(locale) : t(locale, 'store.rescore.notice', { total: photos.length, changed: changes.length })
    }));
    return { total: photos.length, changed: changes.length };
  },

  deleteRejectedPhotos: async () => {
    const locale = get().locale;
    const { deletable, skippedCount } = selectDeletableRejected(outsideVault(get().photos, get().collections));
    if (!deletable.length) return { deleted: 0, skipped: skippedCount, cancelled: false };
    if (!isNativeMediaLibraryAvailable()) return { deleted: 0, skipped: skippedCount + deletable.length, cancelled: false };

    // Acelasi plafon ca la export, si din acelasi buget — observatie a
    // utilizatorului: a-ti curata galeria stergand respinsele e exact folosul
    // pentru care se plateste, doar incasat altfel. Un plafon pus doar pe export
    // ar fi lasat drumul asta liber, iar cine tria 5000 de poze si stergea
    // respinsele n-ar fi platit niciodata.
    //
    // Refuzam tot lotul, nu o parte: dupa un dialog de stergere e cu atat mai
    // rau sa nu stii care poze au disparut si care nu.
    if (isCapEnforced() && deletable.length > remainingFreePhotos()) {
      set({
        notice: t(locale, 'store.deleteRejected.capBlocked', {
          count: deletable.length, remaining: remainingFreePhotos(), limit: FREE_PHOTOS_PER_MONTH
        }),
        premiumOpen: true, premiumReason: 'cap' as const
      });
      return { deleted: 0, skipped: skippedCount + deletable.length, cancelled: true };
    }

    let result: { cancelled: boolean; skippedUris: string[] };
    try {
      result = await deleteNativePhotos(deletable.map(p => p.mediaUri!));
    } catch (err) {
      set({ notice: t(locale, 'store.deleteRejected.failed', { error: err instanceof Error ? err.message : String(err) }) });
      return { deleted: 0, skipped: skippedCount + deletable.length, cancelled: false };
    }
    // Utilizatorul a inchis/refuzat dialogul de confirmare al sistemului — o
    // alegere valida, nu o eroare: nu s-a sters nimic, dar nici n-avem ce raporta
    // ca "esec" (spre deosebire de catch-ul de mai sus, unde cererea nici n-a putut porni).
    if (result.cancelled) return { deleted: 0, skipped: skippedCount + deletable.length, cancelled: true };

    // Bug real raportat de utilizator: o singura poza inaccesibila (permisiune
    // schimbata intre timp) facea sa esueze STERGEREA INTREGULUI LOT (0 din 29).
    // MediaLibraryPlugin.kt acum omite doar acele poze din cererea de stergere —
    // aici le scoatem la fel din setul "chiar sters", ca sa nu disparea din
    // biblioteca aplicatiei desi tot mai exista fizic pe telefon.
    const nativeSkippedUris = new Set(result.skippedUris);
    const actuallyDeleted = deletable.filter(p => !nativeSkippedUris.has(p.mediaUri!));
    const nativeSkippedCount = deletable.length - actuallyDeleted.length;

    const ids = actuallyDeleted.map(p => p.id);
    const idSet = new Set(ids);
    // Aceleasi 6 tabele golite la "Goleste sesiunea" (clearAll), dar doar pentru
    // ACESTE id-uri — vezi comentariul de acolo pentru ce contine fiecare.
    await Promise.all([
      db.photos.bulkDelete(ids), db.thumbnails.bulkDelete(ids), db.previews.bulkDelete(ids),
      db.originals.bulkDelete(ids), db.fileHandles.bulkDelete(ids), db.analyses.bulkDelete(ids)
    ]);
    for (const id of ids) { originalFiles.delete(id); originalHandles.delete(id); }


    // Bug gasit la audit: se goleau cele 6 tabele, dar nu si apartenenta la
    // foldere. Un folder din care ai sters 10 din 30 de poze continua sa scrie
    // "30 poze", iar butonul de export ramanea aprins pe un folder care putea fi
    // gol — exportul raportand apoi "N lipsa". `cleanupOrphanedOriginal` era deja
    // chemat corect la scoaterea MANUALA dintr-un folder; doar calea de stergere
    // il ocolea.
    const withoutDeleted = await Promise.all(
      get().collections.map(async c =>
        c.memberIds.some(pid => idSet.has(pid))
          ? (await removePhotosFromCollectionRecord(c.id, ids)) ?? c
          : c
      )
    );
    // Obiect-URL-urile pozelor sterse ar tine vii blob-uri care nu mai exista in
    // Dexie — pana la 40 de preview-uri agatate degeaba.
    clearPreviewUrlCache();
    clearThumbUrlCache();

    // Se scad din acelasi buget de 150 ca exporturile — vezi plafonul de mai sus.
    recordPhotosUsed(ids.length);

    const totalSkipped = skippedCount + nativeSkippedCount;
    const deletedNotice = t(locale, 'store.deleteRejected.notice', { deleted: ids.length });
    const skippedNotice = totalSkipped > 0 ? t(locale, 'store.deleteRejected.skippedPart', { skipped: totalSkipped }) : '';
    set(state => ({
      photos: state.photos.filter(p => !idSet.has(p.id)),
      collections: withoutDeleted,
      detailId: state.detailId && idSet.has(state.detailId) ? null : state.detailId,
      multiSelectIds: new Set([...state.multiSelectIds].filter(id => !idSet.has(id))),
      notice: deletedNotice + skippedNotice
    }));
    return { deleted: ids.length, skipped: totalSkipped, cancelled: false };
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

  setSelectMode: on => set(state => ({
    selectMode: on,
    // la iesire din mod, golim si selectia — la intrare, pornim de la zero
    multiSelectIds: on ? state.multiSelectIds : new Set(),
    multiSelectAnchor: on ? state.multiSelectAnchor : null
  })),

  revealInGrid: ids => {
    // "Arata in grila" trebuie sa poata arata ORICE poza, deci filtrul cade pe
    // 'all' — si se si salveaza, altfel valoarea pastrata ar ramane in urma
    // fata de ce vede omul pe ecran.
    writeActiveFilter('all');
    return set({
    // Tab-urile Albume/Persoane si meniul acopera grila: fara asta, selectia
    // s-ar face in spatele panoului din care tocmai s-a apasat.
    collectionsOpen: false,
    personsOpen: false,
    menuOpen: false,
    homeGridOpen: true,
    filter: 'all',
    selectMode: true,
    multiSelectIds: new Set(ids),
    multiSelectAnchor: ids.length ? ids[ids.length - 1] : null
    });
  },

  describePhoto: async photoId => {
    const { locale } = get();
    const status = await imageDescriptionStatus();

    // Nu descarcam niciodata singuri: modelul inseamna trafic si spatiu, si
    // alea se hotarasc de om. Prima apasare cere voie; a doua chiar descrie.
    if (status === 'unsupported' || status === 'unavailable') {
      set({ notice: t(locale, 'store.describe.unavailable') });
      return;
    }
    // Descarcarea modelului merge in sistem, nu aici. Prima versiune astepta
    // sa se TERMINE inainte sa raspunda ceva — iar modelul are sute de MB, deci
    // omul ramanea cu un mesaj inghetat si, la a doua apasare, cu acelasi mesaj
    // pe alta ramura. Raportat cu trei capturi.
    //
    // Acum ambele ramuri spun acelasi lucru adevarat: se descarca, dureaza,
    // revino. Diferenta e ca prima o si porneste.
    if (status === 'downloading') {
      set({ notice: t(locale, 'store.describe.downloadingNow') });
      return;
    }
    if (status === 'downloadable') {
      // Engleza se spune ACUM, inainte de descarcare — nu dupa, cand omul a
      // consumat deja traficul si primeste o propozitie pe care n-o astepta.
      const ok = await get().askConfirm(t(locale, 'store.describe.downloadAsk'), {
        confirmLabel: t(locale, 'store.describe.downloadConfirm')
      });
      if (!ok) return;
      try {
        const { completed, megabytes } = await startImageDescriptionDownload();
        if (!completed) {
          set({
            notice: megabytes > 0
              ? t(locale, 'store.describe.downloadStartedSize', { mb: megabytes })
              : t(locale, 'store.describe.downloadingNow')
          });
          return;
        }
      } catch {
        set({ notice: t(locale, 'store.describe.downloadFailed') });
        return;
      }
    }

    const photo = get().photos.find(p => p.id === photoId);
    if (!photo) return;
    set({ notice: t(locale, 'store.describe.working') });
    try {
      // Previzualizarea, nu originalul: modelul lucreaza oricum pe o imagine
      // redimensionata, iar originalul poate fi un RAW de zeci de MB pe care
      // n-are rost sa-l trecem peste punte.
      const rec = (await db.previews.get(photoId)) ?? (await db.thumbnails.get(photoId));
      if (!rec) { set({ notice: t(locale, 'store.describe.failed') }); return; }
      const blob = rec.blob;
      const description = (await describeImageNative({ blob })).trim();
      if (!description) { set({ notice: t(locale, 'store.describe.failed') }); return; }
      await db.analyses.update(photoId, { aiDescription: description });
      // Descrierea NU se mai arata ca atare. Vine in engleza (atat suporta
      // deocamdata API-ul Google), iar aplicatia e in romana — sa-i punem
      // omului o propozitie in engleza in fata ar fi fost singurul loc din
      // produs care nu-i vorbeste limba.
      //
      // Alternativa ar fi fost un traducator, dar orice traducator adevarat
      // cere internet, iar "nimic nu pleaca de pe telefon" e chiar lucrul pe
      // care concurenta nu-l poate copia. Nu se schimba pentru o propozitie.
      //
      // Deci ramane in fundal, unde chiar face treaba: hraneste memoria de
      // subiecte (vezi core/descriptionTags.ts — "rainbow", "street", "fence"
      // devin semnal de decizie) si intra in cautare. Confirmarea spune ce a
      // recunoscut, in romana, fara sa citeze textul englezesc.
      const recognised = subjectTags({ aiDescription: description }).slice(0, 4);
      set({
        photos: get().photos.map(p => (p.id === photoId ? { ...p, aiDescription: description } : p)),
        notice: recognised.length
          ? t(locale, 'store.describe.learned', { count: recognised.length })
          : t(locale, 'store.describe.savedQuiet')
      });
    } catch {
      set({ notice: t(locale, 'store.describe.failed') });
    }
  },

  showSimilarTo: async photoId => {
    const { locale, collections, photos } = get();
    const rows = await db.analyses.toArray();
    const similar = findSimilarPhotos(rows, photoId);

    // Dosarul privat nu iese pe usa asta, ca pe niciuna alta: cine a pus o poza
    // acolo n-are de ce s-o vada aparand intr-o grila pornita din alta poza.
    // Aceeasi regula ca la export si la stergerile in masa — vezi outsideVault().
    const allowed = new Set(outsideVault(photos, collections).map(p => p.id));
    const visible = similar.filter(id => allowed.has(id));

    if (!visible.length) {
      // Doua motive foarte diferite pentru aceeasi grila goala, si omul trebuie
      // sa stie care: ori poza n-a fost analizata cu embedding (web, sau
      // importata inainte de plugin), ori chiar nu seamana cu nimic.
      const source = rows.find(r => r.photoId === photoId);
      set({ notice: t(locale, source?.imageEmbedding?.length ? 'store.similar.none' : 'store.similar.unavailable') });
      return;
    }

    // Sursa in fata: e reperul fata de care se citeste tot restul.
    get().revealInGrid([photoId, ...visible]);
    set({ notice: t(locale, 'store.similar.found', { count: visible.length }) });
  },

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
    // Acelasi semnal ca la o stea data individual (vezi setRating) — secvential,
    // nu Promise.all: recordCorrection e SGD online, pasii trebuie sa se vada
    // unul pe altul, iar un lot mare de antrenari paralele ar concura pe aceeasi
    // stare de model.
    const decision = ratingDecision(clamped);
    if (decision !== null) for (const id of ids) await train(id, decision);
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

  setFilter: f => { writeActiveFilter(f); set({ filter: f }); },
  startQuickReview: () => {
    writeActiveFilter('review');
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
  openDetail: (id, opts) => set({ detailId: id, detailExpandMetrics: opts?.expandMetrics === true }),
  detailExpandMetrics: false,
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
      return { ok: false, message: 'Nicio față detectată în pozele de referință. Alege poze clare, frontale.' };
    }
    const skipped = Math.max(0, files.length - MAX_PERSON_REFERENCE_FILES);
    const skippedSuffix = skipped > 0 ? ` (${skipped} poze ignorate, plafon ${MAX_PERSON_REFERENCE_FILES} per inrolare)` : '';
    const multifaceSuffix = multiface > 0
      ? ` Atenție: ${multiface} ${multiface === 1 ? 'poză a conținut' : 'poze au conținut'} mai multe fețe — s-a folosit automat cea mai mare din cadru; verifică dacă e persoana corectă.`
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
      // Blocant doar cand exista o cale reala de plata (isCapEnforced); altfel
      // ramane hintul informativ de dinainte. Panoul Premium ANUNTA limita asta
      // ca beneficiu platit — daca n-ar fi niciodata aplicata, panoul ar minti.
      if (!canEnrollAnotherPersonFree(get().persons.length) && isCapEnforced()) {
        // { ok: false }, nu un `return` gol: apelantul (PersonsPanel) afiseaza
        // el mesajul si trateaza esecul — un `undefined` ar rupe contractul si
        // ar lasa dialogul de inrolare intr-o stare de "s-a intamplat ceva".
        set({ premiumOpen: true, premiumReason: 'persons' });
        return { ok: false, message: t(get().locale, 'store.addPerson.capBlocked', { limit: FREE_ENROLLED_PERSONS }) };
      }
      person = { id: crypto.randomUUID(), name: trimmedName, embeddings, updatedAt: Date.now(), enrolledAt: Date.now() };
      const premiumSuffix = canEnrollAnotherPersonFree(get().persons.length)
        ? ''
        : ' ' + t(get().locale, 'store.addPerson.premiumHint');
      message = trimmedName + ': ' + embeddings.length + ' referinte salvate.' + skippedSuffix + multifaceSuffix + premiumSuffix;
    }
    await db.persons.put(person);
    await rematchPersonInExistingAnalyses(person);
    const [persons, photos] = await Promise.all([db.persons.toArray(), reloadPhotoViews()]);
    await analysisPool.setKnownPersons(persons);
    contextEngine.setEnrolledPersonCount(persons.length);
    set({ persons, photos });
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
    contextEngine.setEnrolledPersonCount(persons.length);
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
    contextEngine.setEnrolledPersonCount(persons.length);
    set({ persons, photos });
  },

  mergePersons: async (ids, keepName) => {
    const toMerge = get().persons.filter(p => ids.includes(p.id));
    if (toMerge.length < 2) return;
    // vezi selectMergedEmbeddings mai sus pentru motivul pentru care nu mai e o
    // simpla concatenare + tail-slice (bug real gasit de auditul QA)
    const merged = selectMergedEmbeddings(toMerge.map(p => p.embeddings), MAX_PERSON_EMBEDDINGS);
    // enrolledAt: cel mai VECHI dintre profilurile unite. Fara el, persoana
    // rezultata devenea "cea mai noua" in clasamentul din activePersons.ts si
    // putea fi impinsa in afara celor active la gratuit — desi utilizatorul doar
    // a unit doua profiluri pe care le avea de mult.
    const oldestEnrolled = Math.min(...toMerge.map(p => p.enrolledAt ?? p.updatedAt));
    const survivor: KnownPerson = { id: toMerge[0].id, name: keepName.trim() || toMerge[0].name, embeddings: merged, updatedAt: Date.now(), enrolledAt: oldestEnrolled };
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
    contextEngine.setEnrolledPersonCount(persons.length);
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
        let person: KnownPerson;
        if (existing) {
          const combined = [...existing.embeddings, ...incoming.embeddings].slice(-MAX_PERSON_EMBEDDINGS);
          person = { ...existing, embeddings: combined, updatedAt: Date.now() };
          merged++;
        } else {
          person = { id: crypto.randomUUID(), name: incoming.name, embeddings: incoming.embeddings, updatedAt: Date.now(), enrolledAt: Date.now() };
          added++;
        }
        await db.persons.put(person);
        await rematchPersonInExistingAnalyses(person);
      }
      const [persons, photos] = await Promise.all([db.persons.toArray(), reloadPhotoViews()]);
      await analysisPool.setKnownPersons(persons).catch(() => {});
      contextEngine.setEnrolledPersonCount(persons.length);
      set({ persons, photos, notice: t(locale, 'store.personProfiles.imported', { added, merged }) });
    } catch (err) {
      set({ notice: t(locale, 'store.personProfiles.importFailed', { error: err instanceof Error ? err.message : String(err) }) });
    }
  },

  enrollFaceCluster: async (name, members) => {
    const trimmedName = name.trim();
    if (!trimmedName || !members.length) return;
    const newEmbeddings = members.map(m => m.embedding);
    const existing = get().persons.find(p => p.name.trim().toLowerCase() === trimmedName.toLowerCase());
    // Aceeasi poarta ca in addPerson. Bug gasit la audit: inrolarea dintr-un
    // cluster sugerat de AI n-o avea deloc, deci plafonul se ocolea pe aici.
    // Efectul vizibil era si mai derutant decat un simplu ocol: profilul se
    // crea, dar ramanea DORMANT (vezi selectActivePersons), deci recunoasterea
    // nu-l folosea niciodata — iar omul nu primea nici mesajul de plafon, nici
    // panoul Premium. Adica "am adaugat-o si nu face nimic", fara explicatie.
    if (!existing && !canEnrollAnotherPersonFree(get().persons.length) && isCapEnforced()) {
      set({ premiumOpen: true, premiumReason: 'persons', notice: t(get().locale, 'store.addPerson.capBlocked', { limit: FREE_ENROLLED_PERSONS }) });
      return;
    }
    const person: KnownPerson = existing
      ? { ...existing, embeddings: [...existing.embeddings, ...newEmbeddings].slice(-MAX_PERSON_EMBEDDINGS), updatedAt: Date.now() }
      : { id: crypto.randomUUID(), name: trimmedName, embeddings: newEmbeddings.slice(-MAX_PERSON_EMBEDDINGS), updatedAt: Date.now(), enrolledAt: Date.now() };

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
    contextEngine.setEnrolledPersonCount(persons.length);
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
    clearThumbUrlCache();
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
    // Supervizorul galeriei uita si el ce a adus: cursorul lui inseamna "pana
    // unde am adus deja poze IN biblioteca", iar biblioteca tocmai a fost
    // golita (bug raportat: perioada stearsa ramanea marcata ca acoperita, cu
    // procentul vechi, si nu se mai putea relua curat). Vezi
    // resetSupervisorProgress in state/gallerySupervisor.ts.
    resetSupervisorProgress();
    set({
      photos: [], collections: [], collectionFilter: null,
      detailId: null, compareGroupId: null, editingPhotoId: null, history: [],
      batchHistory: [], fieldBatchHistory: [],
      multiSelectIds: new Set(), multiSelectAnchor: null, selectMode: false,
      supervisorCoveredUntil: null, supervisorImportedFolderIds: new Set(), excludedFolderIds: new Set(), lastSupervisorImportIds: null,
      // Bug real raportat de utilizator (captura): cardul "Gata. Iata ce am
      // facut. Am decis singur 16 din 21 poze" ramanea pe ecranul GOL, dupa
      // ce sesiunea fusese stearsa — un raport despre poze care nu mai exista.
      sessionOutcome: null,
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
    clearThumbUrlCache();
    await analysisPool.setKnownPersons([]).catch(() => {});
    // Supervizorul galeriei uita si el ce a adus: cursorul lui inseamna "pana
    // unde am adus deja poze IN biblioteca", iar biblioteca tocmai a fost
    // golita (bug raportat: perioada stearsa ramanea marcata ca acoperita, cu
    // procentul vechi, si nu se mai putea relua curat). Vezi
    // resetSupervisorProgress in state/gallerySupervisor.ts.
    resetSupervisorProgress();
    set({
      photos: [], persons: [], collections: [], collectionFilter: null,
      detailId: null, compareGroupId: null, editingPhotoId: null, history: [],
      batchHistory: [], fieldBatchHistory: [],
      multiSelectIds: new Set(), multiSelectAnchor: null, selectMode: false,
      supervisorCoveredUntil: null, supervisorImportedFolderIds: new Set(), excludedFolderIds: new Set(), lastSupervisorImportIds: null,
      // Bug real raportat de utilizator (captura): cardul "Gata. Iata ce am
      // facut. Am decis singur 16 din 21 poze" ramanea pe ecranul GOL, dupa
      // ce sesiunea fusese stearsa — un raport despre poze care nu mai exista.
      sessionOutcome: null,
    });
  },

  /** Exporta pozele selectate ca fisiere reale, in formatul original (JPEG/PNG/etc), grupate pe subfoldere. */
  exportSelection: async (destination = 'auto') => {
    const allPhotos = outsideVault(get().photos, get().collections);
    const selected = allPhotos.filter(p => p.status === 'selected');
    if (!selected.length) return;
    // Plafonul opreste exportul DOAR cand exista o cale reala de plata (vezi
    // isCapEnforced). Refuzam tot lotul in loc sa exportam partial: "150 din
    // cele 300 de poze" lasa utilizatorul sa ghiceasca singur care au plecat si
    // care nu, iar dupa un triaj lung asta e mai rau decat un refuz clar.
    if (isCapEnforced() && selected.length > remainingFreePhotos()) {
      set({
        notice: t(get().locale, 'store.exportSelection.capBlocked', {
          count: selected.length, remaining: remainingFreePhotos(), limit: FREE_PHOTOS_PER_MONTH
        }),
        premiumOpen: true, premiumReason: 'cap' as const
      });
      return;
    }
    // Feedback IMEDIAT, inainte de orice munca async (coacere editari, cautari
    // in IndexedDB per poza, apoi pe Android scriere in cache + share nativ,
    // care impreuna pot dura cateva secunde bune pe un export mare) — bug real
    // raportat de utilizator ("apas Exporta si nu se intampla nimic"): fara
    // acest semnal, nu exista NICIO diferenta vizibila intre "a inceput sa
    // lucreze" si "apasarea n-a avut niciun efect", mai ales pe calea nativa
    // (Share.share), unde foaia de partajare a sistemului poate aparea cu o
    // intarziere vizibila fata de tap.
    set({ notice: t(get().locale, 'store.exportSelection.exporting') });
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
      }), { renameTemplate: get().renameTemplate, locale, destination });
      // Vezi 'store.exportSelection.cancelled' (i18n): o anulare trebuie sa
      // INLOCUIASCA toast-ul de progres, altfel "Se exporta..." ramane agatat
      // pe ecran la infinit — bug real raportat de utilizator.
      if (result.cancelled) { set({ notice: t(locale, 'store.exportSelection.cancelled') }); return; }
      recordPhotosUsed(result.exported);
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
      set({ notice: parts.join(' ') + freeExportCapNotice(locale) });
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
   *
   * Spre deosebire de exportSelection, pozele NU sunt grupate pe persoana/scena:
   * ajung toate in folderul denumit de utilizator (vezi ExportOptions.folderName).
   * Cerinta lui directa, dupa ce a vazut prima varianta pe device — un folder pe
   * care l-a creat si l-a numit el e o alegere explicita, mai puternica decat
   * orice categorie dedusa de aplicatie, iar aceea o inlocuia pe a lui pe disc.
   */
  exportCollection: async id => {
    const locale = get().locale;
    const collection = get().collections.find(c => c.id === id);
    const allPhotos = outsideVault(get().photos, get().collections);
    const memberSet = new Set(collection?.memberIds ?? []);
    const members = allPhotos.filter(p => memberSet.has(p.id));
    if (!members.length) { set({ notice: t(locale, 'collections.export.empty') }); return; }
    // ACELASI plafon ca exportSelection si deleteRejectedPhotos, din acelasi
    // buget. Bug real gasit la audit: aici lipsea complet, desi mai jos se
    // apela recordPhotosUsed() — adica exportul de folder CONSUMA din plafon,
    // dar nu-l respecta. Un utilizator neabonat isi punea toate pozele intr-un
    // folder si le scotea pe toate, oricate, ocolind un plafon pe care exportul
    // selectiei chiar il aplica. Nu era o portita teoretica: e exact drumul
    // recomandat in UI pentru "exporta tot".
    if (isCapEnforced() && members.length > remainingFreePhotos()) {
      set({
        notice: t(locale, 'store.exportSelection.capBlocked', {
          count: members.length, remaining: remainingFreePhotos(), limit: FREE_PHOTOS_PER_MONTH
        }),
        premiumOpen: true, premiumReason: 'cap' as const
      });
      return;
    }
    // Vezi comentariul identic din exportSelection mai sus — acelasi bug raportat,
    // aceeasi cauza (munca async fara niciun semnal vizibil pana la finalul ei).
    set({ notice: t(locale, 'store.exportSelection.exporting') });
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
        zipBaseName: 'lumin-culler-' + (collection?.name ?? 'folder').replace(/[\\/:*?"<>|]/g, '-'),
        // vezi ExportOptions.folderName: folderul personalizat e o alegere explicita a
        // utilizatorului, deci el ajunge pe disc — nu gruparea dedusa pe persoana/scena
        folderName: collection?.name
      });
      // vezi comentariul identic din exportSelection mai sus
      if (result.cancelled) { set({ notice: t(locale, 'store.exportSelection.cancelled') }); return; }
      recordPhotosUsed(result.exported);
      const parts = [
        result.exported
          ? t(locale,
              result.method === 'folder' ? 'collections.export.exportedFolder'
              : result.grouped ? 'collections.export.exportedZip'
              : 'collections.export.exportedDirect',
              { count: result.exported, name: collection?.name ?? '' }
            )
          : t(locale, 'store.exportSelection.none')
      ];
      if (result.missing.length) {
        parts.push(t(locale, 'store.exportSelection.missing', { count: result.missing.length }));
      }
      set({ notice: parts.join(' ') + freeExportCapNotice(locale) });
    } catch (err) {
      set({ notice: t(locale, 'store.exportSelection.failed', { error: String(err) }) });
    }
  },

  /** Lista JSON cu numele fisierelor selectate — util pentru selectie-dupa-nume in Lightroom. */
  exportManifest: async () => {
    const selected = outsideVault(get().photos, get().collections).filter(p => p.status === 'selected');
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
      stats, projectName, earliestImportedAt, generatedAt: Date.now(),
      // Numai durate, si numai daca s-a masurat ceva — vezi core/stageTiming.ts.
      stageStats: readStageStats(),
      feedback: summariseFeedback(),
      imports: summariseOutcomes()
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
    if (get().gatePremium('xmp')) return;
    const allPhotos = outsideVault(get().photos, get().collections);
    const decided = allPhotos.filter(p => p.status !== 'pending');
    const locale = get().locale;
    if (!decided.length) { set({ notice: t(locale, 'store.exportXmp.noDecided') }); return; }
    // Vezi comentariul identic din exportSelection (state/store.ts) — acelasi
    // bug raportat, aceeasi cauza (munca async fara niciun semnal vizibil).
    set({ notice: t(locale, 'store.exportSelection.exporting') });
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
      // vezi comentariul identic din exportSelection mai sus
      if (result.cancelled) { set({ notice: t(locale, 'store.exportSelection.cancelled') }); return; }
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

  groupByPeople: readGroupByPeople(),
  setGroupByPeople: on => { writeGroupByPeople(on); set({ groupByPeople: on }); },

  bestInGroupIds: () => computeBestInGroupIds(get().photos),

  filtered: () => {
    const { photos, filter, personFilter, colorLabelFilter, sceneTagFilter, projectFilter, collectionFilter, collections, cameraFilter, searchText, locale, dateFrom, dateTo, minRating, gridSort, vaultUnlocked } = get();
    const c = filteredCache;
    if (
      c && c.photos === photos && c.filter === filter && c.personFilter === personFilter &&
      c.colorLabelFilter === colorLabelFilter && c.sceneTagFilter === sceneTagFilter &&
      c.cameraFilter === cameraFilter && c.projectFilter === projectFilter &&
      c.collectionFilter === collectionFilter && c.collections === collections &&
      c.searchText === searchText && c.locale === locale && c.dateFrom === dateFrom && c.dateTo === dateTo &&
      c.minRating === minRating && c.gridSortKey === gridSort.key && c.gridSortDir === gridSort.dir &&
      c.vaultUnlocked === vaultUnlocked
    ) {
      return c.result;
    }
    // Dosarul privat (core/vault.ts) e ascuns din grila principala cat timp nu e
    // deblocat cu PIN in aceasta sesiune — vezi VaultPanel.tsx pentru singurul
    // loc unde continutul lui e vizibil altfel.
    let photosVisible = photos;
    if (!vaultUnlocked) {
      const vault = collections.find(col => col.isPrivate);
      if (vault?.memberIds.length) {
        const hidden = new Set(vault.memberIds);
        photosVisible = photos.filter(p => !hidden.has(p.id));
      }
    }
    let base: PhotoView[];
    switch (filter) {
      case 'selected': base = photosVisible.filter(p => p.status === 'selected'); break;
      case 'candidate': base = photosVisible.filter(p => p.status === 'candidate'); break;
      // "de verificat" incepe sortat dupa cat de greu e cazul: deciziile
      // limpezi primele, cele cu adevarat ambigue la coada, ca sa treci intai
      // prin cele multe si usoare.
      //
      // Masura folosita e `aiUncertainty` cand exista (vezi uncertaintyOf in
      // learning/ContextEngine.ts) si distanta pana la prag ca rezerva, pentru
      // pozele analizate inainte de aceasta functie. E acelasi sens, dar un
      // semnal mai bun: distanta pana la prag vede DOAR ambiguitatea (scor pe
      // la mijloc), pe cand incertitudinea vede si NOUTATEA — o poza cu scor
      // extrem, dar cu trasaturi cum n-a mai vazut modelul, e o extrapolare,
      // nu o judecata, si merita privita cu aceeasi rezerva ca una de la mijloc.
      case 'review':
        base = photosVisible.filter(p => p.status === 'review')
          .sort((a, b) => reviewDifficulty(a) - reviewDifficulty(b));
        break;
      case 'rejected': base = photosVisible.filter(p => p.status === 'rejected'); break;
      case 'blinks': base = selectBlinks(photosVisible); break;
      case 'blurry': base = selectBlurry(photosVisible); break;
      case 'goldenHour': base = photosVisible.filter(p => p.goldenHourDetected); break;
      case 'highlights': base = selectHighlights(photosVisible); break;
      case 'series': {
        const withGroup = photosVisible.filter(p => p.groupId);
        base = withGroup.sort((a, b) =>
          a.groupId === b.groupId ? b.aiScore - a.aiScore : (a.groupId! < b.groupId! ? -1 : 1)
        );
        break;
      }
      default: base = photosVisible;
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
      vaultUnlocked, result: base
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
    const { photos, personFilter, colorLabelFilter, sceneTagFilter, cameraFilter, projectFilter, collectionFilter, collections, searchText, locale, dateFrom, dateTo, minRating, vaultUnlocked } = get();
    const c = secondaryFilteredCache;
    if (
      c && c.photos === photos && c.personFilter === personFilter &&
      c.colorLabelFilter === colorLabelFilter && c.sceneTagFilter === sceneTagFilter &&
      c.cameraFilter === cameraFilter && c.projectFilter === projectFilter &&
      c.collectionFilter === collectionFilter && c.collections === collections &&
      c.searchText === searchText && c.locale === locale && c.dateFrom === dateFrom && c.dateTo === dateTo &&
      c.minRating === minRating && c.vaultUnlocked === vaultUnlocked
    ) {
      return c.result;
    }
    let base = photos;
    if (!vaultUnlocked) {
      const vault = collections.find(col => col.isPrivate);
      if (vault?.memberIds.length) {
        const hidden = new Set(vault.memberIds);
        base = base.filter(p => !hidden.has(p.id));
      }
    }
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
      collectionFilter, collections, searchText, locale, dateFrom, dateTo, minRating, vaultUnlocked, result: base
    };
    return base;
  },

  groupOf: groupId =>
    get().photos.filter(p => p.groupId === groupId).sort((a, b) => b.aiScore - a.aiScore)
}));

/**
 * Legatura dintre drepturile din core/entitlement.ts si starea reactiva de mai
 * sus (vezi AppState.premium). O singura data, la incarcarea modulului: cat
 * timp exista store-ul exista si abonamentul, deci nu are cine sa-l dezlege.
 */
subscribeEntitlement(() => { useStore.getState().syncEntitlement(); });

/**
 * Exista vreun panou, dialog sau ecran suprapus deasupra continutului?
 *
 * Sursa UNICA de adevar pentru intrebarea "cine primeste tasta Escape". Fiecare
 * ecran de fundal (Workspace, DetailView, grila din App) are propriul ascultator
 * global de Escape, iar `stopPropagation()` dintr-un panou NU opreste ascultatorii
 * de pe ACELASI target (window) sa ruleze — opreste doar propagarea intre
 * elemente diferite. Deci fiecare trebuie sa intrebe singur daca e ceva deasupra.
 *
 * De ce centralizat, si nu cate o lista la fata locului: erau doua liste scrise
 * de mana, in Workspace.tsx si DetailView.tsx, iar comentariile din ambele spun
 * ca bug-ul reparat inainte fusese exact "lipseau majoritatea panourilor din
 * lista". La auditul asta lipseau din nou 12 din 22 — printre ele Cautarea,
 * Colectiile, Duplicatele, Dosarul privat, Aspectul si chiar ecranul Premium —
 * iar App.tsx (Escape care goleste selectia in masa) n-avea deloc lista, deci
 * Escape iesea din modul selectie odata cu inchiderea oricarui panou.
 *
 * O lista scrisa de mana in trei locuri nu ramane completa: orice panou adaugat
 * de acum reintroduce acelasi bug in toate trei. Aici e un singur loc de
 * actualizat, iar TypeScript nu poate impune asta, deci: CAND ADAUGI UN PANOU
 * NOU, ADAUGA-L SI AICI.
 *
 * Nu intra in lista `homeGridOpen` (mod de vizualizare, nu suprapunere) si nici
 * `allEyesOpen` (camp de pe poza, nu panou).
 */
export function isAnyOverlayOpen(): boolean {
  const s = useStore.getState();
  return Boolean(
    s.paletteOpen || s.shortcutsOpen || s.menuOpen || s.personsOpen || s.insightsOpen ||
    s.batchOpsOpen || s.statsOpen || s.projectsOpen || s.contactSheetOpen || s.presentationOpen ||
    s.appearanceOpen || s.collectionsOpen || s.documentShieldOpen || s.duplicatesPanelOpen ||
    s.rescueQueueOpen || s.smartInboxOpen || s.momentsOpen || s.exactDupesOpen ||
    s.exportDestinationsOpen || s.premiumOpen || s.searchPanelOpen || s.supervisorPanelOpen ||
    s.tiktokSortOpen || s.locationsOpen || s.vaultOpen || s.zenPanelOpen || s.guideOpen ||
    s.compareGroupId || s.editingPhotoId || s.dialogRequest
  );
}
