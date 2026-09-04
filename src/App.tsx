import { Fragment, useEffect, useMemo, useRef, useState, lazy, Suspense, type ComponentType, type CSSProperties, type ReactNode } from 'react';
import { useStore, isAnyOverlayOpen, reviewDifficulty, type FilterKey } from './state/store';
import { PhotoCard } from './ui/PhotoCard';
import { VirtualPhotoGrid } from './ui/VirtualPhotoGrid';
import { DetailView } from './ui/DetailView';
import { Workspace } from './ui/Workspace';
import { GuidePanel } from './ui/GuidePanel';
// Nu si CollectionPicker printre panourile lazy de mai jos, desi e folosit tot
// ocazional — ContextMenu.tsx/DetailView.tsx il importa deja STATIC (eager),
// asa ca Rollup nu poate sa-l scoata oricum intr-un chunk separat (avertisment
// de build confirmat la verificare); un wrapper lazy aici ar fi doar
// complexitate suplimentara fara niciun beneficiu real de marime.
import { CollectionPicker } from './ui/CollectionPicker';
import { EmptyFilterState } from './ui/EmptyFilterState';
import { ContextMenu } from './ui/ContextMenu';
import { ConfirmDialog } from './ui/ConfirmDialog';
import { CullGauge } from './ui/CullGauge';
import { AiBootScreen } from './ui/AiBootScreen';
import { Tooltip } from './ui/Tooltip';
import { StarRating } from './ui/StarRating';
import { MenuIcon, PlusIcon, AlertIcon, ErrorIcon, XIcon, FocusIcon, SearchIcon, ApertureIcon, SparkleIcon, CheckIcon, EditIcon, GridIcon, ClockIcon, LayersIcon, EyeClosedIcon, SunIcon, DownloadIcon, StarIcon, TagIcon, TrashIcon, LockIcon, BoltIcon, TargetIcon } from './ui/icons';
import { UndoHistoryButton } from './ui/UndoHistoryButton';
import { selectHighlights, selectBlinks, selectBlurry, selectDeletableRejected } from './state/batchOps';
import { CARD_MIN_WIDTH } from './state/gridDensity';
import { bandStarts, planBands, type PlanBand } from './state/reviewPlan';
import { groupBySubject, type SubjectBand } from './state/libraryGroups';
import { PlanSeparator } from './ui/PlanSeparator';
import { SORT_KEY_LABELS, type SortKey } from './state/gridSort';
import { pickImportFiles } from './core/filePicker';
import { isNativeMediaLibraryAvailable, pickNativePhotos } from './core/nativeMediaLibrary';
import { analysisPool } from './core/workerPool';
import { armPickerWatchdog, type PickerWatchdog } from './core/pickerWatchdog';
import { initAndroidBackButton } from './core/androidBackButton';
import { formatEta } from './core/formatTime';
import { ColorLabelFilter } from './ui/ColorLabelFilter';
import { SceneTagFilter } from './ui/SceneTagFilter';
import { CameraFilter } from './ui/CameraFilter';
import { MoreFiltersMenu } from './ui/MoreFiltersMenu';
import { SavedFiltersMenu } from './ui/SavedFiltersMenu';
import { InstallPrompt } from './ui/InstallPrompt';
import { BackupReminder } from './ui/BackupReminder';
import { FreeAllowanceNotice } from './ui/FreeAllowanceNotice';
import { ImportReminder } from './ui/ImportReminder';
import { EnrollPeopleNudge } from './ui/EnrollPeopleNudge';
import { MemoryBanner } from './ui/MemoryBanner';
import { GallerySupervisorBanner } from './ui/GallerySupervisorBanner';
import { PhotosAccessNotice } from './ui/PhotosAccessNotice';
import { useAutoThemeWatch } from './ui/useAutoThemeWatch';
import { useHeaderBottomVar } from './ui/useHeaderBottomVar';
import { useBannerStackVar } from './ui/useBannerStackVar';
import { noticeTone } from './ui/noticeTone';
import { HomeDashboard } from './ui/HomeDashboard';
import { BottomNav } from './ui/BottomNav';
import { WelcomeOnboarding } from './ui/WelcomeOnboarding';
import { SmartNotification } from './ui/SmartNotification';
import { QuickScanFind } from './ui/QuickScanFind';
import { t } from './i18n';
import { dismissAiDegradedNotice, isAiDegradedNoticeDismissed } from './state/aiDegradedNotice';

/**
 * Panourile de mai jos sunt randate NECONDITIONAT mai jos in acest fisier
 * (`<CommandPalette />`, `<InsightsPanel />` etc., fara niciun `{open && ...}`
 * in jurul lor) — fiecare isi verifica singur starea "deschis" din store si
 * intoarce `null` cand e inchis. Comod pentru randare, dar inseamna ca
 * CODUL lor era incarcat si executat la pornirea aplicatiei INDIFERENT daca
 * utilizatorul ajunge vreodata sa deschida Statistici/Proiecte/Colectii/
 * Command Palette etc. — gasit la auditul de performanta: bundle-ul
 * principal avea 849KB (262KB gzip), fara nicio incarcare amanata nicaieri
 * in aplicatie (`grep React.lazy` nu gasea nimic). `lazyPanel` pastreaza
 * exact acelasi comportament (fiecare tot randeaza `null` cand e inchis —
 * `Suspense fallback={null}` nu introduce niciun ecran de incarcare vizibil),
 * dar codul lor JS se descarca/executa abia la PRIMA deschidere reala, nu la
 * pornirea aplicatiei — utilizatorii care nu ating niciodata aceste panouri
 * (majoritatea, probabil) nu mai platesc deloc costul lor de parsare.
 */
// Toate componentele de mai jos sunt FARA PROPS (CollectionPicker, singurul
// panou cu props reale, nu poate fi scos oricum in propriul chunk — vezi
// comentariul de la importul lui static, mai sus) — helperul ramane
// deliberat nespecializat (fara generic pe props) ca sa evite dureri de cap
// de inferenta TS intre cele 12 apeluri, pentru un caz care oricum nu are
// nevoie de generalitate.
function lazyPanel(loader: () => Promise<{ default: ComponentType<Record<string, never>> }>): ComponentType<Record<string, never>> {
  const LazyComponent = lazy(loader);
  return function LazyPanel() {
    return (
      <Suspense fallback={null}>
        <LazyComponent />
      </Suspense>
    );
  };
}

// Meniul a fost pana acum importat static — cea mai mare componenta de UI
// ramasa in bundle-ul principal (~50 KB de cod brut). Statica trebuia sa fie
// doar din cauza ceasului temei "Automat", care traia in ea si trebuia sa
// mearga si cu meniul inchis; ceasul e acum useAutoThemeWatch, montat mai jos.
const MenuDrawer = lazyPanel(() => import('./ui/MenuDrawer').then(m => ({ default: m.MenuDrawer })));
const GroupCompare = lazyPanel(() => import('./ui/GroupCompare').then(m => ({ default: m.GroupCompare })));
const PersonsPanel = lazyPanel(() => import('./ui/PersonsPanel').then(m => ({ default: m.PersonsPanel })));
const InsightsPanel = lazyPanel(() => import('./ui/InsightsPanel').then(m => ({ default: m.InsightsPanel })));
const BatchOpsPanel = lazyPanel(() => import('./ui/BatchOpsPanel').then(m => ({ default: m.BatchOpsPanel })));
const StatsPanel = lazyPanel(() => import('./ui/StatsPanel').then(m => ({ default: m.StatsPanel })));
const ProjectsPanel = lazyPanel(() => import('./ui/ProjectsPanel').then(m => ({ default: m.ProjectsPanel })));
const CollectionsPanel = lazyPanel(() => import('./ui/CollectionsPanel').then(m => ({ default: m.CollectionsPanel })));
const LocationsPanel = lazyPanel(() => import('./ui/LocationsPanel').then(m => ({ default: m.LocationsPanel })));
const TikTokSort = lazyPanel(() => import('./ui/TikTokSort').then(m => ({ default: m.TikTokSort })));
const ZenModePanel = lazyPanel(() => import('./ui/ZenModePanel').then(m => ({ default: m.ZenModePanel })));
const AppearancePanel = lazyPanel(() => import('./ui/AppearancePanel').then(m => ({ default: m.AppearancePanel })));
const PremiumPanel = lazyPanel(() => import('./ui/PremiumPanel').then(m => ({ default: m.PremiumPanel })));
const ExplainDecisionSheet = lazyPanel(() => import('./ui/ExplainDecisionSheet').then(m => ({ default: m.ExplainDecisionSheet })));
const ExportDestinations = lazyPanel(() => import('./ui/ExportDestinations').then(m => ({ default: m.ExportDestinations })));
const SearchPanel = lazyPanel(() => import('./ui/SearchPanel').then(m => ({ default: m.SearchPanel })));
const DocumentShieldPanel = lazyPanel(() => import('./ui/DocumentShieldPanel').then(m => ({ default: m.DocumentShieldPanel })));
const VaultPanel = lazyPanel(() => import('./ui/VaultPanel').then(m => ({ default: m.VaultPanel })));
const RescueQueuePanel = lazyPanel(() => import('./ui/RescueQueuePanel').then(m => ({ default: m.RescueQueuePanel })));
const SmartInboxPanel = lazyPanel(() => import('./ui/SmartInboxPanel').then(m => ({ default: m.SmartInboxPanel })));
const MomentsPanel = lazyPanel(() => import('./ui/MomentsPanel').then(m => ({ default: m.MomentsPanel })));
const ExactDupesPanel = lazyPanel(() => import('./ui/ExactDupesPanel').then(m => ({ default: m.ExactDupesPanel })));
const DuplicatesPanel = lazyPanel(() => import('./ui/DuplicatesPanel').then(m => ({ default: m.DuplicatesPanel })));
const GallerySupervisorPanel = lazyPanel(() => import('./ui/GallerySupervisorPanel').then(m => ({ default: m.GallerySupervisorPanel })));
const CommandPalette = lazyPanel(() => import('./ui/CommandPalette').then(m => ({ default: m.CommandPalette })));
const ShortcutsPanel = lazyPanel(() => import('./ui/ShortcutsPanel').then(m => ({ default: m.ShortcutsPanel })));
// Motorul nou: ecranul de masurare. Lazy ca tot restul — si, spre deosebire de
// ele, nici macar modelul nu se atinge pana nu apesi butonul dinauntru.
const ClipLabPanel = lazyPanel(() => import('./ui/ClipLabPanel').then(m => ({ default: m.ClipLabPanel })));
const ContactSheet = lazyPanel(() => import('./ui/ContactSheet').then(m => ({ default: m.ContactSheet })));
const PresentationMode = lazyPanel(() => import('./ui/PresentationMode').then(m => ({ default: m.PresentationMode })));
const EditPanel = lazyPanel(() => import('./ui/EditPanel').then(m => ({ default: m.EditPanel })));

// 7s a fost prea scurt pentru notificari dupa actiuni care nu schimba nimic
// vizibil pe ecran (ex. restaurare backup intr-o sesiune goala — nu apar poze
// noi, doar persoane/model AI/setari in fundal), unde toast-ul e SINGURUL
// semnal ca ceva s-a intamplat — usor de ratat daca utilizatorul clipeste.
const NOTICE_AUTODISMISS_MS = 10000;
/** Apasare lunga pe touch = meniu contextual (echivalentul click-dreapta pe desktop) — plan 3.2.1. */
const LONG_PRESS_MS = 500;
/** Peste aceasta miscare (px), o apasare lunga se anuleaza — degetul incearca sa deruleze/traga, nu sa tina apasat. */
const TOUCH_MOVE_CANCEL_PX = 10;
/** Swipe orizontal pe o miniatura (plan "cat mai pro", mobil) — respinge la stanga, selecteaza la dreapta, fara sa deschizi DetailView. */
const SWIPE_COMMIT_PX = 80;
/** Peste aceasta deriva verticala, gestul e tratat ca scroll, nu ca swipe orizontal intentionat. */
const SWIPE_MAX_VERTICAL_PX = 45;

/**
 * Eticheta editabila de proiect/sesiune — freelancerii care lucreaza in paralel la mai
 * multe importuri/clienti se pot pierde intre tab-uri identice ("LUMIN CULLER" peste tot);
 * o eticheta scurta, persistata local (nu in Dexie, nu ajunge in export), ii ajuta sa
 * distinga sesiunile din bara de titlu a browserului si vizual in header.
 */
function ProjectNameField() {
  const projectName = useStore(s => s.projectName);
  const setProjectName = useStore(s => s.setProjectName);
  const locale = useStore(s => s.locale);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(projectName);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (editing) inputRef.current?.select(); }, [editing]);

  const commit = () => {
    setEditing(false);
    setProjectName(draft.trim().slice(0, 60));
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        className="project-name-input mono"
        value={draft}
        placeholder={t(locale, 'app.projectName.placeholder')}
        aria-label={t(locale, 'app.projectName.placeholder')}
        maxLength={60}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') { setDraft(projectName); setEditing(false); }
        }}
      />
    );
  }

  return (
    <button
      className="project-name-btn mono"
      onClick={() => { setDraft(projectName); setEditing(true); }}
      title={t(locale, 'app.projectName.title')}
    >
      <EditIcon className="inline-icon" />
      {projectName || t(locale, 'app.projectName.empty')}
    </button>
  );
}

/**
 * Toast de notificare — extras intr-o componenta separata ca sa poata fi montat
 * si in ramura Workspace (ecranul implicit), nu doar in cea a grilei: fara asta,
 * orice notificare (export, cotă de stocare, undo, mod economic etc.) aparuta
 * cat timp utilizatorul e in Workspace disparea silentios, nemontata nicaieri.
 */
function Toast() {
  const notice = useStore(s => s.notice);
  const clearNotice = useStore(s => s.clearNotice);
  const locale = useStore(s => s.locale);
  if (!notice) return null;
  const tone = noticeTone(notice);
  return (
    <div className={`toast tone-${tone}`} role="status">
      <span className="toast-icon">
        {tone === 'error' ? <ErrorIcon />
          : tone === 'warn' ? <AlertIcon />
          : tone === 'progress' ? <SparkleIcon className="spin" />
          : <CheckIcon />}
      </span>
      {/* Fara `mono`: notificarile sunt propozitii, nu scoruri sau id-uri (unde
          fontul monospatiat chiar ajuta la aliniere). Cu el, un mesaj normal se
          rupe in randuri scurte si arata ca o iesire de terminal — vezi captura
          din feedback-ul utilizatorului. */}
      <span className="toast-text">{notice}</span>
      <button className="toast-close" onClick={() => clearNotice()} aria-label={t(locale, 'app.toast.close')}>
        <XIcon />
      </button>
    </div>
  );
}

/**
 * Sub acest prag, grid-ul simplu (DOM normal) e mai simplu si are animatia
 * de intrare in cascada; peste, numarul de noduri DOM (+ URL-uri de obiect
 * pentru miniaturi) devine problema reala, asa ca trecem pe grid virtualizat
 * (doar randurile vizibile exista in DOM), indiferent cate mii de poze sunt.
 */
const VIRTUALIZE_THRESHOLD = 120;

/** "YYYY-MM-DD" (valoarea unui &lt;input type="date"&gt;, in fusul local) -> epoch ms, la inceputul/sfarsitul zilei. */
function dateInputToEpoch(value: string, endOfDay: boolean): number | null {
  if (!value) return null;
  const [y, m, d] = value.split('-').map(Number);
  if (!y || !m || !d) return null;
  return endOfDay ? new Date(y, m - 1, d, 23, 59, 59, 999).getTime() : new Date(y, m - 1, d, 0, 0, 0, 0).getTime();
}

/** epoch ms -> "YYYY-MM-DD" in fusul local, pentru valoarea unui &lt;input type="date"&gt;. */
function epochToDateInput(epoch: number | null): string {
  if (epoch === null) return '';
  const d = new Date(epoch);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function App() {
  const boot = useStore(s => s.boot);
  const photos = useStore(s => s.photos);
  const setBatchOpsOpen = useStore(s => s.setBatchOpsOpen);
  const deletableRejectedCount = useMemo(() => selectDeletableRejected(photos).deletable.length, [photos]);
  const progress = useStore(s => s.progress);
  const filter = useStore(s => s.filter);
  const setFilter = useStore(s => s.setFilter);
  const personFilter = useStore(s => s.personFilter);
  const setPersonFilter = useStore(s => s.setPersonFilter);
  const colorLabelFilter = useStore(s => s.colorLabelFilter);
  const setColorLabelFilter = useStore(s => s.setColorLabelFilter);
  const sceneTagFilter = useStore(s => s.sceneTagFilter);
  const cameraFilter = useStore(s => s.cameraFilter);
  const projectFilter = useStore(s => s.projectFilter);
  const collectionFilter = useStore(s => s.collectionFilter);
  const clearAllFilters = useStore(s => s.clearAllFilters);
  const persons = useStore(s => s.persons);
  const groupByPeople = useStore(s => s.groupByPeople);
  const searchText = useStore(s => s.searchText);
  const setSearchText = useStore(s => s.setSearchText);
  const dateFrom = useStore(s => s.dateFrom);
  const dateTo = useStore(s => s.dateTo);
  const setDateRange = useStore(s => s.setDateRange);
  const minRating = useStore(s => s.minRating);
  const setMinRating = useStore(s => s.setMinRating);
  const clearAdvancedFilters = useStore(s => s.clearAdvancedFilters);
  const runImport = useStore(s => s.runImport);
  const setNotice = useStore(s => s.setNotice);
  const importBackupFile = useStore(s => s.importBackupFile);
  const cancelImport = useStore(s => s.cancelImport);
  const importCancelling = useStore(s => s.importCancelling);
  const openDetail = useStore(s => s.openDetail);
  const openTiktokSortForIds = useStore(s => s.openTiktokSortForIds);
  const openCompare = useStore(s => s.openCompare);
  const setMenuOpen = useStore(s => s.setMenuOpen);
  const setExportDestinationsOpen = useStore(s => s.setExportDestinationsOpen);
  const welcomeSeen = useStore(s => s.welcomeSeen);
  const setSupervisorPanelOpen = useStore(s => s.setSupervisorPanelOpen);
  const notice = useStore(s => s.notice);
  const clearNotice = useStore(s => s.clearNotice);
  // Ceasul temei "Automat" — mutat aici din MenuDrawer, care era montat de la
  // pornire DOAR ca sa-l tina in viata. Vezi ui/useAutoThemeWatch.ts.
  useAutoThemeWatch();
  // Toastul se aseaza sub capul de ecran masurat, nu sub un numar fix — vezi useHeaderBottomVar.
  const headerBottomRef = useHeaderBottomVar<HTMLElement>();
  // Bannerele plutitoare acopereau salutul de pe Acasa (captura de la
  // utilizator) — acum isi publica inaltimea si continutul le lasa loc.
  const bannerStackRef = useBannerStackVar<HTMLDivElement>();
  const aiDegraded = useStore(s => s.aiDegraded);
  const aiBackend = useStore(s => s.aiBackend);
  // Citit la fiecare schimbare de backend, nu o singura data la montare: pe
  // pornire `aiBackend` e gol si devine cunoscut abia dupa initializarea
  // pool-ului, deci o citire unica ar fi intrebat mereu pentru cheia gresita.
  const [aiDegradedDismissed, setAiDegradedDismissed] = useState(false);
  useEffect(() => {
    setAiDegradedDismissed(isAiDegradedNoticeDismissed(aiBackend || 'unknown'));
  }, [aiBackend]);
  const askPrompt = useStore(s => s.askPrompt);
  const filtered = useStore(s => s.filtered());
  const workspaceMode = useStore(s => s.workspaceMode);
  const homeGridOpen = useStore(s => s.homeGridOpen);
  const setHomeGridOpen = useStore(s => s.setHomeGridOpen);
  const setTiktokSortOpen = useStore(s => s.setTiktokSortOpen);
  const undo = useStore(s => s.undo);
  const setPaletteOpen = useStore(s => s.setPaletteOpen);
  const multiSelectIds = useStore(s => s.multiSelectIds);
  const toggleMultiSelect = useStore(s => s.toggleMultiSelect);
  const rangeMultiSelect = useStore(s => s.rangeMultiSelect);
  const setMultiSelected = useStore(s => s.setMultiSelected);
  const selectMode = useStore(s => s.selectMode);
  const setSelectMode = useStore(s => s.setSelectMode);
  const bulkSetStatusForSelection = useStore(s => s.bulkSetStatusForSelection);
  const bulkSetRatingForSelection = useStore(s => s.bulkSetRatingForSelection);
  const bulkSetColorLabelForSelection = useStore(s => s.bulkSetColorLabelForSelection);
  const bulkSetCaptionForSelection = useStore(s => s.bulkSetCaptionForSelection);
  const bulkSetKeywordsForSelection = useStore(s => s.bulkSetKeywordsForSelection);
  const setStatus = useStore(s => s.setStatus);
  const setRating = useStore(s => s.setRating);
  const setColorLabel = useStore(s => s.setColorLabel);
  const gridDensity = useStore(s => s.gridDensity);
  const gridSort = useStore(s => s.gridSort);
  const setGridSort = useStore(s => s.setGridSort);
  const locale = useStore(s => s.locale);
  const tr = (key: string, params?: Record<string, string | number>) => t(locale, key, params);
  const fileRef = useRef<HTMLInputElement>(null);
  /** "Am deja o sesiune" (ecranul gol, mockup "Lumin Culler Pro") — restaureaza
      persoane/modele AI/decizii dintr-un backup JSON, aceeasi actiune reala ca
      "Restaureaza din backup" din Meniu, nu un link decorativ fara efect. */
  const restoreSessionInputRef = useRef<HTMLInputElement>(null);
  const pickerWatchdogRef = useRef<PickerWatchdog | null>(null);
  /** "?action=sort" (App shortcuts) — asteapta pana boot() incarca poze, vezi efectul de mai jos. */
  const pendingSortShortcutRef = useRef(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; photoId: string } | null>(null);
  const dragSelectRef = useRef<{ originId: string; adding: boolean; visited: Set<string>; dragged: boolean } | null>(null);
  const longPressTimerRef = useRef<number | null>(null);
  const touchOriginRef = useRef<{ x: number; y: number } | null>(null);
  /**
   * Swipe pe o miniatura (touch, doar cand NU esti deja in mod selectie-prin-
   * drag) — stanga respinge, dreapta selecteaza, fara sa deschizi DetailView.
   * `el` e manipulat DIRECT (style.transform/opacity), nu prin state React,
   * ca sa nu declanseze un re-render la fiecare pointermove pe o grila
   * virtualizata cu mii de carduri — acelasi motiv pentru care selectia prin
   * drag de mai jos citeste DOM-ul direct (document.elementFromPoint) in loc
   * sa tina o stare React per-card.
   */
  const swipeRef = useRef<{ id: string; startX: number; startY: number; lastDx: number; el: HTMLElement | null } | null>(null);
  /** true intre eliberarea unui swipe comis si urmatorul eveniment `click` — suprima deschiderea DetailView pentru acel tap. */
  const swipedRef = useRef(false);
  // Auto-hide pentru antet la scroll (plan "Refactorizare UI/UX", GridView) — maximizeaza
  // zona de vizualizare pe mobil. Doua surse de scroll posibile dupa marimea bibliotecii
  // (vezi VIRTUALIZE_THRESHOLD mai jos): fereastra intreaga (grila normala, flux de pagina)
  // sau containerul intern al VirtualPhotoGrid (biblioteci mari) — ambele raporteaza aici
  // prin acelasi handler, ca starea sa fie unica indiferent de sursa.
  const [headerHidden, setHeaderHidden] = useState(false);
  /**
   * Ancora scroll-ului de la ULTIMA schimbare de directie (nu ultimul eveniment
   * de scroll) — un scroll natural (mai ales momentum/inerte pe mobil) produce
   * evenimente dese cu delta-uri mici care oscileaza in jurul unui prag mic
   * (ex. +8px, apoi -3px, apoi +5px), desi directia GENERALA e clar in jos.
   * Compararea cu ultimul eveniment (cum era inainte) facea antetul sa
   * apara/dispara la fiecare astfel de oscilatie — pâlpâire vizibila la
   * scroll continuu. Comparand fata de ancora si mutand-o DOAR cand starea
   * chiar se schimba, o mica oscilatie sub prag nu mai declanseaza nimic.
   */
  const scrollAnchorRef = useRef(0);
  const HEADER_TOGGLE_THRESHOLD_PX = 24;
  const handleGridScroll = (scrollY: number) => {
    if (scrollY < 40) { // aproape de varf — antetul ramane mereu vizibil
      setHeaderHidden(false);
      scrollAnchorRef.current = scrollY;
      return;
    }
    const delta = scrollY - scrollAnchorRef.current;
    if (delta > HEADER_TOGGLE_THRESHOLD_PX) { setHeaderHidden(true); scrollAnchorRef.current = scrollY; }
    else if (delta < -HEADER_TOGGLE_THRESHOLD_PX) { setHeaderHidden(false); scrollAnchorRef.current = scrollY; }
  };

  useEffect(() => {
    const onWindowScroll = () => handleGridScroll(window.scrollY);
    window.addEventListener('scroll', onWindowScroll, { passive: true });
    return () => window.removeEventListener('scroll', onWindowScroll);
  }, []);

  useEffect(() => { void boot(); }, [boot]);

  // Butonul/gestul hardware Android de "inapoi" — no-op automat in afara pachetului nativ
  // Capacitor (vezi core/androidBackButton.ts). Un singur listener global, cat aplicatia
  // e montata.
  useEffect(() => initAndroidBackButton(), []);

  // semnal de import activ, disponibil INDIFERENT de ecranul curent (Workspace
  // sau grila) — util pentru teste/automatizari care altfel n-ar avea un
  // singur loc unic sa verifice "importul s-a terminat", de vreme ce bara de
  // progres detaliata traieste doar in ramura grilei.
  useEffect(() => {
    document.body.dataset.importing = progress ? 'true' : 'false';
  }, [progress]);

  useEffect(() => {
    if (!notice) return;
    // Erorile NU dispar singure — utilizatorul trebuie sa apuce sa le citeasca/
    // fotografieze (mai ales mesaje de diagnostic, ex. timeout-urile din
    // exportul nativ Android) inainte sa le poata raporta; le inchide manual
    // (X-ul din toast) cand a terminat. La fel "progress" (vezi noticeTone) —
    // ramane pana e inlocuit de rezultatul real (succes/eroare), nu disparea
    // singur cat munca async e inca in desfasurare. Succes/avertismente raman
    // pe auto-dismiss, ca inainte.
    const tone = noticeTone(notice);
    if (tone === 'error' || tone === 'progress') return;
    const t = setTimeout(() => clearNotice(), NOTICE_AUTODISMISS_MS);
    return () => clearTimeout(t);
  }, [notice, clearNotice]);

  // Ctrl/Cmd+Z global — functioneaza indiferent de ecran (grid, Workspace,
  // DetailView), fara sa intre in conflict cu shortcut-urile lor (Sageti/P/X/Z
  // fara modificator, deja folosite acolo pentru navigare/zoom).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // ignora tastarea in orice camp text (nume proiect, cautare, caption/keywords) —
      // acelasi gardian ca DetailView/Workspace mai jos. Bug real gasit de auditul QA:
      // fara el, Ctrl/Cmd+Z apasat cu intentia de undo NATIV de text (ex. in campul de
      // nume proiect) era interceptat global si anula in schimb ultima decizie de
      // culling, silentios, in loc sa desfaca textul editat.
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)) return;
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        void undo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo]);

  // Escape goleste selectia in masa (si iese din mod selectie) — doar cat timp
  // exista ceva de golit (altfel ar intra in conflict cu Escape-ul altor
  // panouri/paleta)
  useEffect(() => {
    if (!multiSelectIds.size && !selectMode) return;
    const onKey = (e: KeyboardEvent) => {
      // Bug real gasit la auditul UI: aici lipsea COMPLET verificarea a ce e
      // deasupra (spre deosebire de Workspace/DetailView, care aveau macar o
      // lista partiala). Cu selectie multipla activa si un panou deschis peste
      // grila, un singur Escape inchidea panoul SI iesea din modul selectie —
      // adica pierdeai o selectie construita poza cu poza, fara s-o fi cerut.
      if (e.key !== 'Escape' || isAnyOverlayOpen()) return;
      setSelectMode(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [multiSelectIds.size, selectMode, setSelectMode]);

  // Bug real gasit de auditul QA: se calculau din TOATA biblioteca `photos`,
  // ignorand orice filtru secundar activ (persoana/eticheta/scena/camera/
  // proiect/cautare/data/rating) — pastila "Selectate" arata mereu numarul
  // pe toata biblioteca, chiar si cu (de ex.) un filtru de persoana activ
  // care ar arata mult mai putine. secondaryFiltered() aplica exact aceleasi
  // filtre secundare ca filtered() (grila reala), doar fara axa de status
  // (asta e ce numaram aici). Vezi store.ts pentru detalii.
  const secondaryFiltered = useStore(s => s.secondaryFiltered());
  /**
   * Planul de lucru al cozii "de verificat": cat ai de confirmat din mers, cat
   * de comparat, si unde chiar trebuie sa te uiti tu. Vezi state/reviewPlan.ts.
   *
   * Doar pe filtrul 'review', si asta e o alegere: acolo lista e DEJA sortata
   * dupa cat de greu e cazul, iar benzile se taie pe aceeasi axa. Pe orice alta
   * ordine (cronologica, dupa scor, dupa nume), separatoarele ar sari inainte
   * si inapoi prin lista — iar un plan care sare nu mai e un plan.
   */
  /**
   * "Toate" era singurul ecran unde ordinea nu spunea nimic — o grila plata de
   * zeci de poze, fara niciun reper. Cerinta utilizatorului: "ar trebui grupate
   * primele persoanele, sau o grupare mai interesanta".
   *
   * Se reasaza doar pe filtrul 'all' si doar cand exista persoane inrolate; in
   * rest, lista ramane exact cum vine din store. Vezi state/libraryGroups.ts
   * pentru de ce axa e CINE si nu cand/unde.
   */
  const grouped = useMemo(
    () => (filter === 'all' && groupByPeople
      ? groupBySubject(filtered, persons.map(p => p.name))
      : { photos: filtered, bands: new Map<number, SubjectBand>() }),
    [filter, filtered, persons, groupByPeople]
  );
  const shown = grouped.photos;

  const planStarts = useMemo<Map<number, PlanBand | SubjectBand>>(() => {
    if (filter === 'review') return bandStarts(planBands(filtered.map(reviewDifficulty)));
    return grouped.bands;
  }, [filter, filtered, grouped]);

  const counts = useMemo(() => ({
    all: secondaryFiltered.length,
    selected: secondaryFiltered.filter(p => p.status === 'selected').length,
    candidate: secondaryFiltered.filter(p => p.status === 'candidate').length,
    review: secondaryFiltered.filter(p => p.status === 'review').length,
    rejected: secondaryFiltered.filter(p => p.status === 'rejected').length,
    series: secondaryFiltered.filter(p => p.groupId).length,
    blinks: selectBlinks(secondaryFiltered).length,
    blurry: selectBlurry(secondaryFiltered).length,
    goldenHour: secondaryFiltered.filter(p => p.goldenHourDetected).length,
    highlights: selectHighlights(secondaryFiltered).length
  }), [secondaryFiltered]);

  // Randul principal de filtre (.filters) trebuie sa incapa pe un singur ecran de
  // telefon FARA scroll orizontal (feedback direct: "grupeaza cumva meniul asta,
  // sa nu mai scrolez la dreapta") — doar cele 4 statusuri de baza (aceleasi ca in
  // grila 2x2 din CullGauge, cele mai folosite in timpul unei sedinte de triaj)
  // raman mereu vizibile, ca pastile compacte icon+numar. Restul (statusuri
  // speciale + persoana/eticheta/scena/aparat + modul de selectie) se muta in
  // MoreFiltersMenu, un singur buton care le grupeaza pe toate.
  const PRIMARY_FILTERS: { key: FilterKey; label: string; count: number; icon: ReactNode }[] = [
    { key: 'all', label: tr('palette.filter.all'), count: counts.all, icon: <GridIcon /> },
    { key: 'selected', label: tr('palette.filter.selected'), count: counts.selected, icon: <CheckIcon /> },
    { key: 'review', label: tr('palette.filter.review'), count: counts.review, icon: <ClockIcon /> },
    { key: 'rejected', label: tr('palette.filter.rejected'), count: counts.rejected, icon: <XIcon /> }
  ];
  /** Filtrele din grupa "ce caut" — restul cad in grupa "ce nu e in regula". */
  const FIND_FILTERS: FilterKey[] = ['series', 'highlights', 'goldenHour'];
  const SECONDARY_FILTERS: { key: FilterKey; label: string; count: number; icon: ReactNode }[] = [
    { key: 'series', label: tr('palette.filter.series'), count: counts.series, icon: <LayersIcon /> },
    { key: 'highlights', label: tr('palette.filter.highlights'), count: counts.highlights, icon: <StarIcon /> },
    { key: 'blinks', label: tr('palette.filter.blinks'), count: counts.blinks, icon: <EyeClosedIcon /> },
    { key: 'blurry', label: tr('palette.filter.blurry'), count: counts.blurry, icon: <FocusIcon /> },
    { key: 'goldenHour', label: tr('palette.filter.goldenHour'), count: counts.goldenHour, icon: <SunIcon /> }
  ];
  // Bug real gasit la verificare: projectFilter/collectionFilter lipseau de aici —
  // un filtru de proiect sau folder activ nu se reflecta deloc in badge-ul/starea
  // "activa" a butonului "Mai multe filtre", desi grila era deja filtrata de el.
  const extraFiltersActive = SECONDARY_FILTERS.some(f => f.key === filter) ||
    !!personFilter || !!colorLabelFilter || !!sceneTagFilter || !!cameraFilter || !!projectFilter || !!collectionFilter;
  const extraFiltersCount = (SECONDARY_FILTERS.some(f => f.key === filter) ? 1 : 0) +
    (personFilter ? 1 : 0) + (colorLabelFilter ? 1 : 0) + (sceneTagFilter ? 1 : 0) + (cameraFilter ? 1 : 0) +
    (projectFilter ? 1 : 0) + (collectionFilter ? 1 : 0);
  // Cerinta directa a utilizatorului: un singur buton care sa anuleze TOATE
  // filtrele combinabile deodata, fara sa fie nevoie sa stii care anume era
  // activ ca sa-l re-selectezi din propriul lui panou.
  const anySecondaryFilterActive = !!personFilter || !!colorLabelFilter || !!sceneTagFilter || !!cameraFilter ||
    !!projectFilter || !!collectionFilter || !!searchText || dateFrom !== null || dateTo !== null || minRating > 0;

  const onFiles = (list: FileList | null) => {
    pickerWatchdogRef.current?.cancel();
    // watchdog-ul poate fi deja declansat (fals-pozitiv) daca transferul de
    // fisiere mari a durat mai mult decat pragul lui, dar `change` tot a ajuns
    // pana la urma — fara asta, avertismentul ramane afisat inutil chiar in
    // timp ce importul chiar porneste cu succes (bug real raportat: utilizatorul
    // vede avertismentul "nu s-a intamplat nimic" suprapus peste ecranul de
    // incarcare AI, care rulează deja).
    if (notice === tr('app.import.pickerTimeout')) clearNotice();
    // O selectie "goala" nu inseamna neaparat ca utilizatorul nu a ales nimic —
    // unele aplicatii sursa (Fisiere, Drive, Descarcari) pot returna un FileList
    // gol desi utilizatorul a apasat pe poze in acel selector (MIME raportat de
    // furnizorul de documente nu se potriveste cu `accept`-ul cerut de browser).
    // Fara notificare, asta arata exact ca "nu s-a intamplat nimic" — bug real raportat.
    if (!list || !list.length) { setNotice(tr('app.import.noneSelected')); return; }
    void runImport(Array.from(list));
    if (fileRef.current) fileRef.current.value = '';
  };

  /**
   * Foloseste File System Access API cand e disponibil (Chromium desktop) —
   * pastreaza handle-uri catre fisierele originale (plan 2.3.4), nu doar
   * File-uri "moarte" la reload. Fallback: deschide <input type="file"> ca
   * inainte, pe browsere fara suport (Safari/WebKit, WebView-uri mobile).
   */
  const onAddPhotosClick = async () => {
    /*
     * Modelele incep sa se incarce ACUM, nu dupa ce se intorc fisierele.
     * Masurat in browser pe 12 poze de 4000x3000: incarcarea modelelor a durat
     * 82 din cele 82 de secunde ale importului, iar analiza propriu-zisa abia
     * incepea dupa. Selectorul de fisiere tine utilizatorul cateva secunde bune
     * — timp in care, pana acum, nu se intampla nimic.
     *
     * Nu se iroseste nimic: pornim doar cand un import e deja iminent, nu la
     * fiecare deschidere a aplicatiei. Daca utilizatorul anuleaza selectorul,
     * modelele raman incarcate si urmatorul import porneste instant.
     * Pe Android nativ, init() se termina imediat (analiza merge prin pluginuri,
     * vezi core/nativeAnalysis.ts), deci apelul e inofensiv acolo.
     * Erorile se ignora deliberat: runImport() apeleaza oricum init() si
     * raporteaza corect esecul, cu ecranul lui.
     */
    void analysisPool.init().catch(() => {});

    // Pe Android nativ, incearca INTAI selectorul propriu (MediaLibraryPlugin) —
    // singura cale prin care pastram URI-ul content:// al pozei, necesar mai
    // tarziu pentru "Sterge pozele respinse" (BatchOpsPanel). Bug real gasit
    // prin test pe device: verificam mai intai pickImportFiles() (API-ul
    // showOpenFilePicker de desktop) — dar WebView-ul Android a inceput sa
    // raspunda si el la acel API (fara sa expuna vreun URI persistent prin el),
    // deci codul lua mereu acea cale si selectorul nostru nu mai apuca sa
    // porneasca niciodata. Pe Android nativ, ordinea trebuie inversata.
    if (isNativeMediaLibraryAvailable()) {
      try {
        const photos = await pickNativePhotos();
        // O selectie goala aici e o ANULARE deliberata a utilizatorului din
        // dialogul nativ — nu trebuie sa deschidem imediat DUPA un al doilea
        // selector ca "plasa de siguranta"; acel fallback ramane doar pentru
        // cazul in care selectorul nativ chiar esueaza (arunca).
        if (photos.length) void runImport(photos.map(p => p.file), undefined, photos.map(p => p.uri));
        return;
      } catch (err) {
        console.warn('Selectorul nativ de poze a esuat, revenim la API-ul de desktop / <input type="file">:', err);
      }
    }
    const picked = await pickImportFiles();
    if (picked) {
      if (picked.files.length) void runImport(picked.files, picked.handles);
      return;
    }
    // Plasa de siguranta: pe unele telefoane, alegerea mai multor poze mari
    // deodata dintr-o aplicatie ca "Fisiere" (nu Galeria) poate face ca `change`
    // sa nu mai ajunga niciodata (confirmat pe teren) — fara asta, utilizatorul
    // ramane in tacere totala, fara nicio explicatie. Vezi core/pickerWatchdog.ts.
    // Bug real gasit de auditul QA: fara cancel() aici, un watchdog anterior
    // ramas armat (utilizatorul a apasat "Adauga poze" a doua oara fara sa
    // aleaga nimic prima data) era orfan — timer-ul lui tot pornea mai tarziu
    // si arata un avertisment fals "nu s-a intamplat nimic" peste un import
    // deja in curs, declansat de a doua apasare.
    pickerWatchdogRef.current?.cancel();
    pickerWatchdogRef.current = armPickerWatchdog(() => setNotice(tr('app.import.pickerTimeout')));
    fileRef.current?.click();
  };

  // App shortcuts (vite.config.ts, apasare lunga pe iconita PWA instalata) —
  // "?action=sort"/"?action=add" in URL la pornire. Curatam parametrul din
  // URL imediat (altfel un refresh manual ulterior redeschide acelasi ecran
  // la nesfarsit), dar actiunea 'sort' asteapta pana exista poze de sortat
  // (boot() e async, la primul randare `photos` e inca gol).
  useEffect(() => {
    const action = new URLSearchParams(window.location.search).get('action');
    if (!action) return;
    const url = new URL(window.location.href);
    url.searchParams.delete('action');
    window.history.replaceState({}, '', url);
    if (action === 'add') void onAddPhotosClick();
    else if (action === 'sort') pendingSortShortcutRef.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- doar la montare, citeste URL-ul initial o singura data
  }, []);

  useEffect(() => {
    if (pendingSortShortcutRef.current && photos.length > 0) {
      pendingSortShortcutRef.current = false;
      setTiktokSortOpen(true);
    }
  }, [photos.length, setTiktokSortOpen]);

  /**
   * Editare in masa a descrierii/cuvintelor-cheie IPTC (plan "modernizare") —
   * pre-completeaza cu valoarea curenta DOAR daca toate pozele din selectie o
   * au deja identica (altfel un camp gol invita la o valoare noua, nu la
   * suprascrierea aparent-arbitrara a uneia dintre valorile diferite existente).
   */
  const handleBulkCaption = async () => {
    const selected = photos.filter(p => multiSelectIds.has(p.id));
    if (!selected.length) return;
    const first = selected[0].iptcCaption ?? '';
    const allSame = selected.every(p => (p.iptcCaption ?? '') === first);
    const value = await askPrompt(tr('app.bulkBar.captionPrompt'), allSame ? first : '');
    if (value === null) return;
    void bulkSetCaptionForSelection(value.trim());
  };

  const handleBulkKeywords = async () => {
    const selected = photos.filter(p => multiSelectIds.has(p.id));
    if (!selected.length) return;
    const first = (selected[0].iptcKeywords ?? []).join(', ');
    const allSame = selected.every(p => (p.iptcKeywords ?? []).join(', ') === first);
    const value = await askPrompt(tr('app.bulkBar.keywordsPrompt'), allSame ? first : '');
    if (value === null) return;
    void bulkSetKeywordsForSelection(value.split(',').map(k => k.trim()).filter(Boolean));
  };

  const onCardOpen = (id: string, e: React.MouseEvent) => {
    // un swipe comis a schimbat deja statusul — tap-ul care urmeaza (acelasi
    // gest touch, click sintetizat de browser) nu trebuie sa mai deschida
    // DetailView (acelasi tipar ca sheetMovedRef in DetailView.tsx)
    if (swipedRef.current) { swipedRef.current = false; return; }
    if (e.shiftKey) { rangeMultiSelect(id, filtered.map(p => p.id)); return; }
    if (e.ctrlKey || e.metaKey) { toggleMultiSelect(id); return; }
    // cat timp exista deja ceva in selectie SAU modul selectie e pornit explicit
    // (buton dedicat — singura cale de a incepe o selectie pe touch, unde
    // Ctrl/Shift+Click nu exista), un click/tap simplu continua sa selecteze
    // in loc sa deschida DetailView
    if (multiSelectIds.size > 0 || selectMode) {
      // un drag real (a trecut peste alt card) e deja tratat de onCardPointerDown/pointermove
      // de mai jos — click-ul nativ nu ajunge sa se declanseze in acel caz (mousedown/mouseup
      // pe elemente diferite), asa ca aici ramane doar cazul unui tap simplu, fara miscare
      toggleMultiSelect(id);
      return;
    }
    const photo = photos.find(p => p.id === id);
    if (filter === 'series' && photo?.groupId) { openCompare(photo.groupId); return; }
    // Un tap pe o poza din grila deschide SORTAREA RAPIDA, de la poza atinsa —
    // cerinta directa a utilizatorului, cu capturi: "cand dau pe o poza din
    // biblioteca vreau sa apara ca la sortare rapida, nu asa".
    //
    // Are dreptate si dincolo de gust: ecranul de detaliu era o fundatura — te
    // uitai la o poza si trebuia sa iesi ca sa treci la urmatoarea. Sortarea
    // rapida are aceeasi poza pe tot ecranul, plus decizia la degetul mare si
    // trecerea la urmatoarea in acelasi gest.
    //
    // Coada primeste EXACT ce se vede in grila, in ordinea din grila (`shown`,
    // deci si gruparea pe persoane), incepand de la poza atinsa: altfel ai fi
    // sarit intr-o alta ordine decat cea de sub deget.
    const order = shown.map(p => p.id);
    const from = order.indexOf(id);
    openTiktokSortForIds(from > 0 ? [...order.slice(from), ...order.slice(0, from)] : order);
  };

  /** Inceputul unei posibile selectii-prin-drag ("vopsire" peste mai multe carduri, plan 3.2.1)
      si/sau al unei apasari lungi (meniu contextual pe touch) — decizia daca a fost intr-adevar
      un drag (spre deosebire de un simplu tap) se ia in onPointerMove de mai jos, urmarind daca
      pointerul ajunge peste un alt card inainte de eliberare. */
  const onCardPointerDown = (id: string, e: React.PointerEvent) => {
    if (e.pointerType === 'touch') {
      touchOriginRef.current = { x: e.clientX, y: e.clientY };
      const { clientX, clientY } = e;
      longPressTimerRef.current = window.setTimeout(() => {
        longPressTimerRef.current = null;
        touchOriginRef.current = null;
        dragSelectRef.current = null;
        setContextMenu({ x: clientX, y: clientY, photoId: id });
      }, LONG_PRESS_MS);
    }
    const dragEligible = selectMode || e.ctrlKey || e.metaKey || multiSelectIds.size > 0;
    if (dragEligible) {
      dragSelectRef.current = { originId: id, adding: !multiSelectIds.has(id), visited: new Set(), dragged: false };
    } else if (e.pointerType === 'touch') {
      // swipe-ul are sens doar in navigarea normala (nu si in modul selectie-prin-drag,
      // unde miscarea peste carduri deja inseamna altceva)
      const el = (e.target as HTMLElement).closest('.card') as HTMLElement | null;
      swipeRef.current = { id, startX: e.clientX, startY: e.clientY, lastDx: 0, el };
    }
  };

  const onCardContextMenu = (id: string, e: React.MouseEvent) => {
    e.preventDefault();
    dragSelectRef.current = null;
    setContextMenu({ x: e.clientX, y: e.clientY, photoId: id });
  };

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (touchOriginRef.current && longPressTimerRef.current) {
        const dx = e.clientX - touchOriginRef.current.x;
        const dy = e.clientY - touchOriginRef.current.y;
        if (Math.hypot(dx, dy) > TOUCH_MOVE_CANCEL_PX) {
          window.clearTimeout(longPressTimerRef.current);
          longPressTimerRef.current = null;
        }
      }
      const swipe = swipeRef.current;
      if (swipe) {
        const dx = e.clientX - swipe.startX;
        const dy = e.clientY - swipe.startY;
        if (Math.abs(dy) > SWIPE_MAX_VERTICAL_PX) {
          // deriva verticala prea mare — utilizatorul deruleaza pagina, nu face swipe; abandonam
          if (swipe.el) { swipe.el.classList.remove('swiping'); swipe.el.style.transform = ''; swipe.el.style.opacity = ''; }
          swipeRef.current = null;
        } else {
          swipe.lastDx = dx;
          if (Math.abs(dx) > 8) {
            if (longPressTimerRef.current) { window.clearTimeout(longPressTimerRef.current); longPressTimerRef.current = null; }
            if (swipe.el) {
              swipe.el.classList.add('swiping');
              swipe.el.style.transform = `translateX(${dx}px) rotate(${dx / 24}deg)`;
              swipe.el.style.opacity = String(Math.max(0.25, 1 - Math.abs(dx) / 260));
            }
          }
        }
      }

      const drag = dragSelectRef.current;
      if (!drag) return;
      const el = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest('[data-photo-id]');
      const id = el?.getAttribute('data-photo-id');
      if (!id) return;
      if (!drag.dragged) {
        drag.dragged = true;
        drag.visited.add(drag.originId);
        setMultiSelected(drag.originId, drag.adding);
      }
      if (!drag.visited.has(id)) {
        drag.visited.add(id);
        setMultiSelected(id, drag.adding);
      }
    };
    const onUp = () => {
      dragSelectRef.current = null;
      touchOriginRef.current = null;
      if (longPressTimerRef.current) { window.clearTimeout(longPressTimerRef.current); longPressTimerRef.current = null; }
      const swipe = swipeRef.current;
      if (swipe) {
        if (swipe.el) { swipe.el.classList.remove('swiping'); swipe.el.style.transform = ''; swipe.el.style.opacity = ''; }
        if (Math.abs(swipe.lastDx) > SWIPE_COMMIT_PX) {
          swipedRef.current = true;
          void setStatus(swipe.id, swipe.lastDx > 0 ? 'selected' : 'rejected');
        }
        swipeRef.current = null;
      }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [setMultiSelected, setStatus]);

  // Workspace e ecranul principal implicit — grila (jos) ramane accesibila
  // doar cand exista deja poze SI utilizatorul a comutat explicit la ea
  // (buton dedicat in antetul Workspace-ului); fara poze, ramane onboarding-ul.
  // Montam si panourile deschise din meniu (Persoane/Preferinte AI/Operatii in
  // masa) — altfel butonul Meniu din Workspace n-ar avea ce deschide.
  if (photos.length > 0 && workspaceMode) {
    return (
      <>
        <Toast />
        <SmartNotification />
        {/* HomeDashboard NU se mai monteaza aici. Workspace-ul are propriul
            antet fix si propriul filmstrip fix, dar corpul lui nu acopera
            pagina — asa ca ecranul de acasa, montat ca frate deasupra lui in
            flux, ramanea vizibil dedesubt: se vedea Review Desk-ul cu
            "Continuă" si biblioteca, iar peste ele plutea butonul METRICI si
            banda de miniaturi. Masurat in browser: `.workspace` e in flux
            normal, nu suprapus. Pe langa ce se vedea, tot ecranul de acasa
            ramanea si in arborele de accesibilitate — un cititor de ecran
            citea intreaga pagina de acasa in timp ce utilizatorul era in
            spatiul de lucru. */}
        {welcomeSeen && (
          <div className="banner-stack" ref={bannerStackRef}>
            <MemoryBanner />
            <InstallPrompt />
            <BackupReminder />
            <ImportReminder onAddPhotos={() => void onAddPhotosClick()} />
            <EnrollPeopleNudge />
            <FreeAllowanceNotice />
            <GallerySupervisorBanner />
          </div>
        )}
        <Workspace />
        {/* Compararea de serii nu era montata aici: butonul "Compară" din
            panoul de Duplicate (montat mai jos) nu facea nimic in modul
            spatiu de lucru. Nu intra in conflict cu Workspace-ul — atarna de
            `compareGroupId`, nu de `detailId`. */}
        <GroupCompare />
        <CommandPalette />
        <ShortcutsPanel />
        <ClipLabPanel />
        <MenuDrawer />
        <GuidePanel />
        <PersonsPanel />
        <InsightsPanel />
        <BatchOpsPanel />
        <StatsPanel />
        <ContactSheet />
        <PresentationMode />
        <EditPanel />
        <ProjectsPanel />
        <CollectionsPanel />
        <LocationsPanel />
        <TikTokSort />
        <ZenModePanel />
        <AppearancePanel />
        <PremiumPanel />
        <ExplainDecisionSheet />
        <ExportDestinations />
        <SearchPanel />
        <DocumentShieldPanel />
        <VaultPanel />
        <DuplicatesPanel />
        <RescueQueuePanel />
        <SmartInboxPanel />
        <MomentsPanel />
        <ExactDupesPanel />
        <GallerySupervisorPanel />
        <ConfirmDialog />
      </>
    );
  }

  return (
    <div className={photos.length === 0 && !progress ? 'app app-empty-state' : 'app'}>
      <header className="topbar" ref={headerBottomRef}>
        {/* Marca+numele produsului dispar pe ecranul gol: se repeta deja, mult
            mai mare, in medalionul "LC" + titlul de mai jos (cerinta directa,
            mockup fara antet deasupra). Butonul de meniu ramane singur —
            e SINGURA cale spre Meniu inainte de import (vezi mai jos). */}
        {(photos.length > 0 || progress) && (
        <div className="brand">
          {/* Marca devine buton "Acasa" — bug real raportat de utilizator: dupa
              ce tab-ul dedicat "Acasa" a disparut din bara de jos (redesign
              PRO, Grila/Persoane/Export/Setari), nu mai exista NICIO cale
              inapoi la ecranul "Revede selectia ta" odata intrat in Grila.
              Doar marca (nu tot randul — .brand-text contine ProjectNameField,
              el insusi interactiv, si nu poate sta intr-un buton parinte) —
              a doua cale, pe langa tap-ul pe tab-ul Grila deja activ (vezi
              BottomNav.tsx). */}
          <button type="button" className="brand-mark-wrap brand-home-btn" onClick={() => setHomeGridOpen(false)} aria-label={tr('nav.grid')}>
            <span className="brand-mark-ring" aria-hidden="true" />
            <span className="brand-mark">
              <ApertureIcon aria-hidden="true" />
            </span>
          </button>
          <div className="brand-text">
            <h1>
              LUMIN<span>CULLER</span>
              {/* Nume de produs, nu insigna de drepturi — "Premium disponibil" real
                  se afla in drawer-pro-card (Meniu), unde starea de cumparare chiar
                  conteaza. Aici e doar identitatea din redesign, vizibila mereu. */}
              <em className="brand-pro-badge">PRO</em>
            </h1>
            <p className="mono"><i className="live-dot" aria-hidden="true" /> {tr('app.tagline')}</p>
            <ProjectNameField />
          </div>
        </div>
        )}
        <div className="top-actions">
          {/* "Acasa" NU mai e aici. A stat in antet ca buton dedicat, dupa ce
              varianta cu un singur tab avand doua sensuri ("apas o data ma duce
              la grila, apas iar ma duce home") fusese raportata drept confuza.
              Butonul dedicat era raspunsul corect; locul era gresit — pe telefon
              coltul din dreapta sus e exact unde degetul mare nu ajunge fara sa
              muti mana. E acum tab propriu in bara de jos (ui/BottomNav.tsx),
              ceea ce pastreaza si intelesul unic, si drumul scurt. */}
          {photos.length > 0 && (
            <Tooltip label={tr('app.tooltip.palette')} shortcut="Ctrl+K">
              <button className="ghost icon-btn" onClick={() => setPaletteOpen(true)} aria-label={`${tr('app.tooltip.palette')} (Ctrl+K)`}>
                <SearchIcon />
              </button>
            </Tooltip>
          )}
          <UndoHistoryButton />
          {/* Butonul spre spatiul de lucru a fost scos din antet la cererea
              directa a utilizatorului ("ma duce tot la sortare"): de cand bara
              de jos are tab-ul "Revizuiesc", cele doua duceau in acelasi loc
              din punctul lui de vedere, iar antetul avea un buton in plus fara
              o destinatie noua. Ramane in paleta de comenzi (Ctrl+K) si acolo
              unde aplicatia il deschide singura, dupa o actiune care chiar
              cere spatiul de lucru. */}
          {/* Doar cand exista ceva de exportat. Pe ecranul gol ramanea un buton
              dezactivat care scria "Exporta poze (0)" — ocupa jumatate din
              antet fara sa poata face nimic. Celelalte butoane din antet erau
              deja conditionate la fel. */}
          {photos.length > 0 && (
            <button
              className={counts.selected ? 'btn-accent export-cta' : 'ghost export-cta'}
              onClick={() => setExportDestinationsOpen(true)}
              disabled={!counts.selected}
              aria-label={tr('app.export', { count: counts.selected })}
            >
              <DownloadIcon className="inline-icon" aria-hidden="true" />
            {/* Eticheta cade pe ecrane inguste, unde altfel impinge randul de
                actiuni sub logo si antetul creste la doua randuri. Numarul
                ramane vizibil, ca pastila — vezi .export-cta-count. */}
              <span className="export-cta-label">{tr('app.export', { count: counts.selected })}</span>
              {/* Varianta scurta pentru antetul de telefon: butonul spunea doar
                  cu o iconita ce face, iar numarul statea intr-o pastila taiata
                  la marginea lui. Textul complet ramane in aria-label. */}
              <span className="export-cta-short" aria-hidden="true">{tr('app.exportShort')}</span>
              {counts.selected > 0 && <span className="export-cta-count mono" aria-hidden="true">{counts.selected}</span>}
            </button>
          )}
          {/* Doua butoane "Meniu" pe acelasi ecran, amandoua deschizand acelasi
              sertar: cel de aici si fila din bara de jos. Gasit la inventarul
              controalelor, dupa ce utilizatorul a cerut sa nu existe butoane
              care fac acelasi lucru — si dupa ce s-a plans ca randul de sus e
              inghesuit, ceea ce exact un buton in plus provoca.
              Bara de jos apare doar cand exista poze (vezi BottomNav), deci
              butonul de aici ramane pentru biblioteca goala, unde e singura
              cale spre meniu. */}
          {photos.length === 0 && (
            <Tooltip label={tr('app.tooltip.menu')} side="left">
              <button className="ghost icon-btn" onClick={() => setMenuOpen(true)} aria-label={tr('app.menu.ariaLabel')}>
                <MenuIcon />
              </button>
            </Tooltip>
          )}
        </div>
      </header>

      <Toast />
      <WelcomeOnboarding />
      <HomeDashboard />
      {/* Nimic nu se desenează peste ecranul de bun venit: .banner-stack are
          z-index de toast, deci bannerele acopereau comutatorul de limbă și
          butonul de închidere. Reapar imediat ce ecranul e închis. */}
      {welcomeSeen && (
        <div className="banner-stack" ref={bannerStackRef}>
          <MemoryBanner />
          <InstallPrompt />
          <BackupReminder />
          <ImportReminder onAddPhotos={() => void onAddPhotosClick()} />
          <FreeAllowanceNotice />
          <GallerySupervisorBanner />
        </div>
      )}

      {/* Anuntul asta apare exact cand omul incearca prima data functia
          principala, si statea permanent, cu pictograma de avertisment,
          enumerand ce NU merge — inclusiv numele intern al backendului, care
          nu-i spune nimic nimanui. Un banner de alerta care nu poate fi inchis
          si pe care nimeni nu-l poate rezolva nu mai informeaza: repeta, la
          fiecare deschidere, ca produsul e limitat.
          Acum incepe cu ce MERGE, spune pe scurt ce nu, si se poate inchide —
          revine doar daca se schimba situatia de accelerare (vezi
          state/aiDegradedNotice.ts). Semnalat de auditul extern ca "defect de
          experienta prioritar"; sugestia lui de acolo era insa sa se ofere
          "mod economic" ca remediu, ceea ce ar fi fost fals: modul economic
          reduce numarul de workeri pentru RAM, n-are nicio legatura cu lipsa
          accelerarii. */}
      {aiDegraded && !aiDegradedDismissed && (
        <div className="notice ai-degraded">
          <div className="ai-degraded-text">
            <strong>{tr('app.aiDegraded.title')}</strong>
            <span>{tr('app.aiDegraded')}</span>
          </div>
          <button
            className="ghost small-btn"
            onClick={() => {
              dismissAiDegradedNotice(aiBackend || 'unknown');
              setAiDegradedDismissed(true);
            }}
          >
            {tr('app.aiDegraded.dismiss')}
          </button>
        </div>
      )}

      {/* Auto-hide la scroll (plan "Refactorizare UI/UX"): progresul, filtrele si statisticile
          globale se ascund la scroll in jos si revin la scroll in sus — maximizeaza spatiul
          de afisare al grilei pe mobil. Topbar-ul (brand + actiuni critice) ramane mereu vizibil. */}
      <div className={headerHidden ? 'app-collapsible hidden' : 'app-collapsible'}>
        {/* Un singur copil, obligatoriu: colapsarea merge pe grid-template-rows
            0fr->1fr (vezi .app-collapsible in styles.css), iar tehnica aia are
            nevoie de EXACT un rand de grila. */}
        <div className="app-collapsible-inner">
        {photos.length > 0 && homeGridOpen && (
          <CullGauge
            selected={counts.selected}
            review={counts.review}
            rejected={counts.rejected}
            candidate={counts.candidate}
            pending={counts.all - counts.selected - counts.review - counts.rejected - counts.candidate}
            total={counts.all}
          />
        )}

        {/* Cerinta directa a utilizatorului, cu captura: dupa import, progresul
            aparea de doua ori pe acelasi ecran — sus in masa de triaj ("AI-ul
            citeste fotografiile"), jos in cardul ANALYSIS STUDIO. Cat timp
            exista poze, masa de triaj e cea care raporteaza (numar, estimare,
            bara, anulare — vezi HomeDashboard). Studioul ramane exact pentru
            cazul in care nu e nimic deasupra lui: primul import, biblioteca
            goala, unde el E ecranul. */}
        {progress && photos.length === 0 && (
          progress.phase === 'incarcare' ? (
            <AiBootScreen />
          ) : (
            <section className="analysis-studio" role="status" aria-live="polite">
              <div className="analysis-studio-glow" aria-hidden="true" />
              <div className="analysis-studio-head">
                <span className="analysis-studio-kicker">{tr('app.progress.studioKicker')}</span>
                <span className="analysis-studio-count">{progress.total ? `${progress.done}/${progress.total}` : '…'}</span>
              </div>
              {/* Lentila: doua inele care se rotesc in sensuri opuse, plus miezul.
                  Miscarea e ce spune "lucreaza acum" — un desen static citea a
                  ecran blocat. */}
              <div className="analysis-studio-lens" aria-hidden="true">
                <span className="analysis-studio-orbit orbit-one" />
                <span className="analysis-studio-orbit orbit-two" />
                <span className="analysis-studio-core" />
              </div>
              <div className="analysis-studio-copy">
              <h2>{tr(progress.phase === 'analiza' ? 'app.progress.studioTitleReading' : 'app.progress.studioTitle')}</h2>
              <p>
                {progress.phase === 'citire'
                  ? (progress.total ? tr('app.progress.reading', { done: progress.done, total: progress.total }) : tr('app.progress.readingUnknown', { done: progress.done }))
                  : progress.phase === 'analiza'
                    ? (progress.etaSeconds !== undefined ? tr('app.progress.analyzingEta', { done: progress.done, total: progress.total, fileName: progress.fileName, eta: formatEta(progress.etaSeconds) }) : tr('app.progress.analyzing', { done: progress.done, total: progress.total, fileName: progress.fileName }))
                    : progress.phase === 'pregatire' ? tr('app.progress.prescan')
                      : progress.phase === 'grupare' ? tr('app.progress.grouping') : tr('app.progress.done')}
              </p>
              </div>
              <QuickScanFind />
              <div className="analysis-studio-progress" aria-hidden="true">
                <span style={{ width: `${progress.total ? Math.max(4, (progress.done / progress.total) * 100) : 18}%` }} />
              </div>
              {/* Etapa curenta e marcata, nu doar listata: altfel cele trei
                  cuvinte erau decor, nu progres. */}
              <div className="analysis-studio-steps" aria-hidden="true">
                <span className={progress.phase === 'citire' ? 'active' : ''}>{tr('app.progress.step.import')}</span>
                <span className={progress.phase === 'analiza' ? 'active' : ''}>{tr('app.progress.step.analyze')}</span>
                <span className={progress.phase === 'grupare' ? 'active' : ''}>{tr('app.progress.step.series')}</span>
              </div>
              {progress.phase === 'analiza' && (
                <button className="analysis-studio-cancel" onClick={() => cancelImport()} disabled={importCancelling}>
                  {importCancelling ? tr('app.progress.cancelling') : tr('app.progress.cancel')}
                </button>
              )}
            </section>
          )
        )}

        {photos.length > 0 && homeGridOpen && (
          <nav className="filters" aria-label={tr('app.filters.ariaLabel')}>
            {/* A TREIA forma a acestei bare, dupa ce utilizatorul a respins-o de
                doua ori ("arata groaznic", "fa o regrupare"). Ce nu mergea,
                masurat: cele patru stari plus trei butoane cu nume nu incap pe
                412px, iar zona care scrola taia pastila activa fix prin mijlocul
                cuvantului ("Selec|tate").
                Regruparea: pe bara raman DOAR starile — intrebarea "ce ma uit
                acum" — plus o singura usa spre restul. Numele se scrie pe starea
                ALEASA, celelalte trei raman iconita si numar; asa randul incape
                intreg, fara sa scrole si fara sa taie nimic. Sortarea, ratingul,
                intervalul de date si modul de selectie au coborat in foaie: sunt
                reglaje, nu navigatie. */}
            <div className="filters-status">
            {PRIMARY_FILTERS.map(f => (
              <button
                key={f.key}
                className={filter === f.key ? 'chip chip-compact active' : 'chip chip-compact'}
                onClick={() => setFilter(f.key)}
                aria-pressed={filter === f.key}
                aria-label={`${f.label}: ${f.count}`}
                title={f.label}
              >
                <span className="chip-icon" aria-hidden="true">{f.icon}</span>
                {/* Numarul, pe TOATE. Numele, doar pe starea aleasa.
                    Inainte cifrele celorlalte trei lipseau, pe motiv ca sunt
                    scrise mai mari in cardul de rezumat de deasupra. Cardul a
                    disparut (vezi CullGauge.tsx: tabul Biblioteca incepea cu
                    370px de statistici), deci motivul a disparut cu el — si
                    ramanea o bara de filtre pe care nu vedeai cate poze ai
                    respins fara sa comuti pe respinse ca sa afli.
                    Randul incape: numele lung se scrie o singura data, pe
                    pastila activa; celelalte raman iconita + cifra. */}
                {filter === f.key && <span className="chip-label">{f.label}</span>}
                <b className="chip-count">{f.count}</b>
              </button>
            ))}
            </div>
          </nav>
        )}

        {/* Randul al doilea al bibliotecii avea sapte controale pe 412px —
            cautare, rating, sortare, directie si doua campuri de data — din
            care ultimele doua ieseau pur si simplu din ecran (vizibil in
            captura utilizatorului: "de la" taiat pe margine). A ramas doar
            cautarea, pe toata latimea, fiindca ea se foloseste des si nu are
            de ce sa concureze cu nimic; restul s-au mutat in foaia de filtre. */}
        {photos.length > 0 && homeGridOpen && (
          <div className="library-search">
            <label className="search-field">
              <SearchIcon className="inline-icon" aria-hidden="true" />
              <input
                type="search"
                placeholder={tr('app.search.placeholder')}
                value={searchText}
                onChange={e => setSearchText(e.target.value)}
                aria-label={tr('app.search.ariaLabel')}
              />
            </label>
          <div className="filters-actions">
          <MoreFiltersMenu active={extraFiltersActive || anySecondaryFilterActive} badgeCount={extraFiltersCount}>
            {close => (
              /* Panoul era o singura gramada de pastile: filtre de continut,
                 dropdown-uri de persoana/eticheta/scena/aparat si o actiune
                 distructiva, toate amestecate cu flex-wrap. Utilizatorul le-a
                 respins explicit ("nu imi plac cum se vad, cum sunt grupate").
                 Acum sunt trei grupe cu nume, in ordinea intrebarii pe care
                 si-o pune omul: ce vreau sa gasesc, ce nu e in regula, dupa
                 ce anume caut. Actiunea care sterge sta ultima, sub o linie,
                 niciodata langa un filtru. */
              <>
                {([
                  ['app.moreFilters.group.find', SECONDARY_FILTERS.filter(f => FIND_FILTERS.includes(f.key))],
                  ['app.moreFilters.group.problems', SECONDARY_FILTERS.filter(f => !FIND_FILTERS.includes(f.key))]
                ] as const).map(([headKey, list]) => (
                  <div className="more-filters-group" key={headKey}>
                    <span className="more-filters-group-head mono">{tr(headKey)}</span>
                    {/* Randuri de lista pe toata latimea, nu pastile: numele la
                        stanga, numarul la dreapta, o bifa pe cel pornit. */}
                    <div className="filter-rows">
                      {list.map(f => (
                        <button
                          key={f.key}
                          type="button"
                          className={filter === f.key ? 'filter-row active' : 'filter-row'}
                          onClick={() => { setFilter(f.key); close(); }}
                          aria-pressed={filter === f.key}
                          disabled={f.count === 0 && filter !== f.key}
                        >
                          <span className="filter-row-icon" aria-hidden="true">{f.icon}</span>
                          <span className="filter-row-label">{f.label}</span>
                          <b className="filter-row-count mono">{f.count}</b>
                          {filter === f.key && <CheckIcon className="filter-row-check" aria-hidden="true" />}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
                <div className="more-filters-group">
                  <span className="more-filters-group-head mono">{tr('app.moreFilters.group.details')}</span>
                  <div className="more-filters-group-body">
                    {persons.length > 0 && (
                      <select
                        className={personFilter ? 'chip person-filter active' : 'chip person-filter'}
                        value={personFilter ?? ''}
                        onChange={e => setPersonFilter(e.target.value || null)}
                        aria-label={tr('app.personFilter.ariaLabel')}
                      >
                        <option value="">{tr('app.personFilter.any')}</option>
                        {persons.map(p => <option key={p.id} value={p.name}>{p.name}</option>)}
                      </select>
                    )}
                    <ColorLabelFilter value={colorLabelFilter} onChange={setColorLabelFilter} />
                    <SceneTagFilter />
                    <CameraFilter />
                    <SavedFiltersMenu />
                  </div>
                </div>
                {/* Ce era pe randul al doilea al bibliotecii — rating, sortare,
                    interval de date — a coborat aici. Erau sapte controale
                    inghesuite pe un rand de 412px, din care ultimele doua
                    ieseau din ecran, tocmai reglaje pe care nu le atingi la
                    fiecare poza. */}
                <div className="more-filters-group">
                  <span className="more-filters-group-head mono">{tr('app.moreFilters.group.sort')}</span>
                  <div className="filter-rows">
                    <label className="filter-field">
                      <span className="filter-field-label">{tr('app.ratingFilter.ariaLabel')}</span>
                      <select
                        className={minRating > 0 ? 'chip rating-filter active' : 'chip rating-filter'}
                        value={minRating}
                        onChange={e => setMinRating(Number(e.target.value))}
                        aria-label={tr('app.ratingFilter.ariaLabel')}
                      >
                        <option value={0}>{tr('app.ratingFilter.any')}</option>
                        {[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{'★'.repeat(n)}+ </option>)}
                      </select>
                    </label>
                    <label className="filter-field">
                      <span className="filter-field-label">{tr('app.sort.ariaLabel')}</span>
                      <span className="filter-field-pair">
                        <select
                          className="chip sort-key"
                          value={gridSort.key}
                          disabled={filter === 'series' || filter === 'review'}
                          onChange={e => setGridSort({ key: e.target.value as SortKey, dir: gridSort.dir })}
                          aria-label={tr('app.sort.ariaLabel')}
                        >
                          {(Object.keys(SORT_KEY_LABELS) as SortKey[]).map(key => (
                            <option key={key} value={key}>{tr(`app.sort.key.${key}`)}</option>
                          ))}
                        </select>
                        <button
                          className="chip sort-dir"
                          disabled={filter === 'series' || filter === 'review'}
                          onClick={() => setGridSort({ key: gridSort.key, dir: gridSort.dir === 'asc' ? 'desc' : 'asc' })}
                          aria-label={gridSort.dir === 'asc' ? tr('app.sort.ascToDesc') : tr('app.sort.descToAsc')}
                          title={gridSort.dir === 'asc' ? tr('app.sort.asc') : tr('app.sort.desc')}
                        >
                          {gridSort.dir === 'asc' ? '↑' : '↓'}
                        </button>
                      </span>
                    </label>
                    <label className="filter-field">
                      <span className="filter-field-label">{tr('app.dateFrom')}</span>
                      <input
                        type="date"
                        className="chip"
                        value={epochToDateInput(dateFrom)}
                        onChange={e => setDateRange(dateInputToEpoch(e.target.value, false), dateTo)}
                        aria-label={tr('app.dateFrom.ariaLabel')}
                      />
                    </label>
                    <label className="filter-field">
                      <span className="filter-field-label">{tr('app.dateTo')}</span>
                      <input
                        type="date"
                        className="chip"
                        value={epochToDateInput(dateTo)}
                        onChange={e => setDateRange(dateFrom, dateInputToEpoch(e.target.value, true))}
                        aria-label={tr('app.dateTo.ariaLabel')}
                      />
                    </label>
                    {/* Modul de selectie multipla: un comutator, deci un rand cu
                        bifa, nu un buton fara nume in coltul barei. */}
                    <button
                      type="button"
                      className={selectMode ? 'filter-row active' : 'filter-row'}
                      onClick={() => { setSelectMode(!selectMode); close(); }}
                      aria-pressed={selectMode}
                    >
                      <span className="filter-row-icon" aria-hidden="true"><CheckIcon /></span>
                      <span className="filter-row-label">{tr('app.selectMode.short')}</span>
                      {selectMode && <CheckIcon className="filter-row-check" aria-hidden="true" />}
                    </button>
                  </div>
                </div>
                {(searchText || dateFrom !== null || dateTo !== null || minRating > 0 || anySecondaryFilterActive) && (
                  <button className="filter-reset-btn" onClick={() => { clearAdvancedFilters(); clearAllFilters(); close(); }}>
                    {tr('app.resetFilters')}
                  </button>
                )}
                {isNativeMediaLibraryAvailable() && (
                  <>
                    <div className="more-filters-divider" />
                    <button
                      className="chip danger more-filters-danger"
                      onClick={() => { setBatchOpsOpen(true); close(); }}
                    >
                      <TrashIcon className="chip-icon" aria-hidden="true" />
                      {tr('menu.deleteRejected')}
                      {deletableRejectedCount > 0 && <b className="chip-count">{deletableRejectedCount}</b>}
                    </button>
                  </>
                )}
              </>
            )}
          </MoreFiltersMenu>
          </div>
          </div>
        )}
        </div>
      </div>


      {photos.length === 0 && !progress ? (
        <div className="empty">
          {/* Medalionul poarta ACELASI semn ca iconita aplicatiei si ca bara de
              sus — diafragma, nu literele "LC".

              Cerinta directa a utilizatorului, si are dreptate: aplicatia avea
              DOUA marci. Pe ecranul de start al telefonului aparea diafragma;
              deschideai aplicatia si te intampina "LC". Doua semne pentru
              acelasi produs nu inseamna doua sanse de a fi tinut minte, ci
              jumatate de sansa fiecare — recunoasterea se face din repetitie,
              iar aici repetitia era rupta exact in momentul in care conta cel
              mai mult, la prima deschidere.

              Ales semnul, nu literele, si asta e partea care nu se poate
              inversa usor: iconita din magazin si cea de pe ecranul de start
              sunt deja diafragma, iar acelea nu se schimba fara sa pierzi
              recunoasterea deja stransa. Ecranul dinauntru e cel care se
              alinia mai ieftin. */}
          <div className="empty-badge" aria-hidden="true">
            <ApertureIcon className="empty-badge-mark" />
          </div>
          <h2 className="empty-brand-title">{tr('app.empty.title')}</h2>
          <p className="empty-lead">{tr('app.empty.description')}</p>
          {/* Cele trei carduri de valoare — continut real (nu simulat): mockup-ul
              zice "1000+ poze fara blocare", dar plafonul gratuit real e
              150/luna (FREE_PHOTOS_PER_MONTH in core/entitlement.ts), nelimitat
              doar la Premium — pastram in schimb "Trecere rapida", adevarat. */}
          <section className="lc-home-proof" aria-label={tr('app.empty.proof.ariaLabel')}>
            <div className="lc-home-proof-item">
              <span className="lc-home-proof-icon"><LockIcon /></span>
              <span className="lc-home-proof-copy">
                <strong>{tr('app.empty.proof.private.kicker')}</strong>
                <span>{tr('app.empty.proof.private.text')}</span>
              </span>
            </div>
            <div className="lc-home-proof-item">
              <span className="lc-home-proof-icon"><BoltIcon /></span>
              <span className="lc-home-proof-copy">
                <strong>{tr('app.empty.proof.fast.kicker')}</strong>
                <span>{tr('app.empty.proof.fast.text')}</span>
              </span>
            </div>
            <div className="lc-home-proof-item">
              <span className="lc-home-proof-icon"><TargetIcon /></span>
              <span className="lc-home-proof-copy">
                <strong>{tr('app.empty.proof.control.kicker')}</strong>
                <span>{tr('app.empty.proof.control.text')}</span>
              </span>
            </div>
          </section>
          {/* Doua cai de intrare, una langa alta (cerinta directa): alegi tu
              fisierele, sau lasi supervizorul sa aduca galeria telefonului pe
              perioade. A doua exista doar pe Android nativ, unde chiar avem un
              MediaStore de citit — pe web ar fi un buton care nu poate face
              nimic. */}
          <div className="empty-cta-row">
            <button className="btn-accent big empty-cta-main" onClick={() => void onAddPhotosClick()}>{tr('app.empty.cta')}</button>
            {isNativeMediaLibraryAvailable() && (
              <button className="ghost big empty-cta-secondary" onClick={() => setSupervisorPanelOpen(true)}>
                <ClockIcon className="inline-icon" aria-hidden="true" /> {tr('app.empty.supervisorCta')}
              </button>
            )}
          </div>
          {/* "Am deja o sesiune" — actiune reala (nu un link decorativ):
              restaureaza persoane/modele AI/decizii dintr-un backup JSON,
              aceeasi cale ca "Restaureaza din backup" din Meniu. */}
          <input
            ref={restoreSessionInputRef} type="file" accept="application/json,.json" style={{ display: 'none' }}
            onChange={e => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (!file) return;
              setNotice(tr('menu.importBackup.processing'));
              void importBackupFile(file);
            }}
          />
          <button type="button" className="empty-existing-session" onClick={() => restoreSessionInputRef.current?.click()}>
            {tr('app.empty.existingSession')}
          </button>
          <PhotosAccessNotice />

          {/* Aici erau inca 3 blocuri de text sub butoane (formatele acceptate,
              sfatul cu inrolarea unei persoane, si "cate poze ai pe telefon").
              Feedback direct: "prea multe texte". Formatele se repetau cuvant
              cu cuvant in pasul 1 de mai jos; sfatul cu persoanele il spune deja
              ecranul de bun venit; iar numaratoarea galeriei s-a mutat in
              Supervizorul galeriei, langa bara de acoperire, unde chiar
              raspunde la o intrebare pusa acolo ("cat am de adus?"). */}

          {/* Card simplu, nu panou HUD cu colturi in paranteze: tratamentul acela
              a ramas limbajul pentru DATE LIVE (CullGauge, in timpul triajului).
              Pe un explicativ static citea decorativ, nu profesional. */}
          <div className="how-it-works-card concept-empty-legacy">
            <div className="how-it-works">
              <div className="how-step">
                <span className="how-step-icon"><span className="how-step-num">1</span><PlusIcon /></span>
                <div className="how-step-text">
                  <b>{tr('app.howItWorks.add.title')}</b>
                  <p>{tr('app.howItWorks.add.desc')}</p>
                </div>
              </div>
              <div className="how-step">
                <span className="how-step-icon how-step-icon-hero"><span className="how-step-num">2</span><SparkleIcon /></span>
                <div className="how-step-text">
                  <b>{tr('app.howItWorks.analyze.title')}</b>
                  <p>{tr('app.howItWorks.analyze.desc')}</p>
                </div>
              </div>
              <div className="how-step">
                <span className="how-step-icon"><span className="how-step-num">3</span><CheckIcon /></span>
                <div className="how-step-text">
                  <b>{tr('app.howItWorks.decide.title')}</b>
                  <p>{tr('app.howItWorks.decide.desc')}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <>
          {/* Ecranul Acasa (plan modernizare): implicit arata doar HomeDashboard-ul
              de mai sus, curat — grila clasica (CullGauge + filtre + carduri) ramane
              accesibila, dar la cerere, prin acest buton, nu mai stivuita direct sub
              dashboard din start (feedback direct: "arata dublu, nu curat ca in HTML"). */}
          {!homeGridOpen && (
            <button className="home-view-all-cta" onClick={() => setHomeGridOpen(true)}>
              {tr('app.viewAllPhotos', { count: counts.all })}
            </button>
          )}
          {homeGridOpen && (
            <>
              {filtered.length > VIRTUALIZE_THRESHOLD ? (
                <VirtualPhotoGrid
                  photos={shown} onOpen={onCardOpen} multiSelectIds={multiSelectIds}
                  onCardPointerDown={onCardPointerDown} onContextMenu={onCardContextMenu}
                  onScroll={handleGridScroll} planStarts={planStarts}
                />
              ) : (
                <div
                  className="grid"
                  style={{
                    '--card-min': `${CARD_MIN_WIDTH[gridDensity].wide}px`,
                    '--card-min-narrow': `${CARD_MIN_WIDTH[gridDensity].narrow}px`
                  } as CSSProperties}
                >
                  {shown.map((p, i) => {
                    const band = planStarts.get(i);
                    return (
                      <Fragment key={p.id}>
                        {band && <PlanSeparator band={band} locale={locale} />}
                        <PhotoCard
                          photo={p} index={i} onOpen={onCardOpen}
                          multiSelected={multiSelectIds.has(p.id)}
                          onCardPointerDown={onCardPointerDown} onContextMenu={onCardContextMenu}
                        />
                      </Fragment>
                    );
                  })}
                </div>
              )}
              {filtered.length === 0 && !progress && <EmptyFilterState />}
            </>
          )}
          {multiSelectIds.size > 0 ? (
            <div className="bulk-bar glass" role="toolbar" aria-label={tr('app.bulkBar.ariaLabel')}>
              <span className="bulk-bar-count mono">{tr('app.bulkBar.count', { count: multiSelectIds.size })}</span>
              <div className="bulk-bar-actions">
                <button className="select small-btn" onClick={() => void bulkSetStatusForSelection('selected')}>{tr('app.bulkBar.select')}</button>
                <button className="ghost small-btn" onClick={() => void bulkSetStatusForSelection('review')}>{tr('app.bulkBar.review')}</button>
                <button className="reject small-btn" onClick={() => void bulkSetStatusForSelection('rejected')}>{tr('app.bulkBar.reject')}</button>
                <StarRating rating={0} onRate={n => void bulkSetRatingForSelection(n)} size="sm" />
                <button className="ghost icon-btn" onClick={() => void handleBulkCaption()} aria-label={tr('app.bulkBar.caption')} title={tr('app.bulkBar.caption')}>
                  <EditIcon />
                </button>
                <button className="ghost icon-btn" onClick={() => void handleBulkKeywords()} aria-label={tr('app.bulkBar.keywords')} title={tr('app.bulkBar.keywords')}>
                  <TagIcon />
                </button>
                <CollectionPicker photoIds={Array.from(multiSelectIds)} iconOnly />
                <button className="ghost icon-btn" onClick={() => setSelectMode(false)} aria-label={tr('app.bulkBar.exit')}>
                  <XIcon />
                </button>
              </div>
            </div>
          ) : selectMode ? (
            <div className="bulk-bar glass" role="toolbar" aria-label={tr('app.selectModeBar.ariaLabel')}>
              <span className="bulk-bar-count mono">{tr('app.selectModeBar.hint')}</span>
              <button className="ghost small-btn" onClick={() => setSelectMode(false)}>{tr('app.selectModeBar.exit')}</button>
            </div>
          ) : (
            <Tooltip label={tr('app.addPhotos')} side="left">
              {/* disabled cat timp un import e deja in curs — vezi runImport (store.ts) pentru
                  bug-ul real pe care il evita: al doilea import concurent suprascria
                  activeCancelToken/progress-ul primului, care ramanea imposibil de anulat */}
              <button className="fab" onClick={() => void onAddPhotosClick()} disabled={!!progress} aria-label={tr('app.addPhotos')}><PlusIcon /></button>
            </Tooltip>
          )}
        </>
      )}

      <input
        ref={fileRef}
        type="file"
        accept="image/*,.cr2,.cr3,.nef,.nrw,.arw,.srf,.sr2,.dng,.raf,.orf,.rw2,.pef,.ptx,.srw,.3fr,.erf,.kdc,.dcr,.mrw,.raw,.rwl,.iiq,.x3f"
        multiple
        hidden
        onChange={e => onFiles(e.target.files)}
      />

      <BottomNav />
      <DetailView />
      <GroupCompare />
      <PersonsPanel />
      <InsightsPanel />
      <BatchOpsPanel />
      <StatsPanel />
      <ContactSheet />
      <PresentationMode />
      <EditPanel />
      <ProjectsPanel />
      <CollectionsPanel />
      <LocationsPanel />
      <TikTokSort />
      <ZenModePanel />
      <AppearancePanel />
      <PremiumPanel />
      <ExplainDecisionSheet />
      <ExportDestinations />
      <SearchPanel />
      <DocumentShieldPanel />
      <VaultPanel />
      <DuplicatesPanel />
      <RescueQueuePanel />
      <SmartInboxPanel />
      <MomentsPanel />
      <ExactDupesPanel />
      <GallerySupervisorPanel />
      <MenuDrawer />
      <GuidePanel />
      <CommandPalette />
      <ShortcutsPanel />
      <ClipLabPanel />
      <ConfirmDialog />
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          photoIds={
            multiSelectIds.has(contextMenu.photoId) && multiSelectIds.size > 1
              ? Array.from(multiSelectIds)
              : [contextMenu.photoId]
          }
          count={multiSelectIds.has(contextMenu.photoId) && multiSelectIds.size > 1 ? multiSelectIds.size : 1}
          rating={
            multiSelectIds.has(contextMenu.photoId) && multiSelectIds.size > 1
              ? 0
              : photos.find(p => p.id === contextMenu.photoId)?.rating ?? 0
          }
          colorLabel={
            multiSelectIds.has(contextMenu.photoId) && multiSelectIds.size > 1
              ? 'none'
              : photos.find(p => p.id === contextMenu.photoId)?.colorLabel ?? 'none'
          }
          onSetStatus={status => {
            const bulk = multiSelectIds.has(contextMenu.photoId) && multiSelectIds.size > 1;
            if (bulk) void bulkSetStatusForSelection(status);
            else void setStatus(contextMenu.photoId, status);
          }}
          onSetRating={n => {
            const bulk = multiSelectIds.has(contextMenu.photoId) && multiSelectIds.size > 1;
            if (bulk) void bulkSetRatingForSelection(n);
            else void setRating(contextMenu.photoId, n);
          }}
          onSetColorLabel={label => {
            const bulk = multiSelectIds.has(contextMenu.photoId) && multiSelectIds.size > 1;
            if (bulk) void bulkSetColorLabelForSelection(label);
            else void setColorLabel(contextMenu.photoId, label);
          }}
          onOpenDetail={
            multiSelectIds.has(contextMenu.photoId) && multiSelectIds.size > 1
              ? undefined
              : () => openDetail(contextMenu.photoId)
          }
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
}
