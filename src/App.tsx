import { useEffect, useMemo, useRef, useState, lazy, Suspense, type ComponentType, type CSSProperties, type ReactNode } from 'react';
import { useStore, type FilterKey } from './state/store';
import { PhotoCard } from './ui/PhotoCard';
import { VirtualPhotoGrid } from './ui/VirtualPhotoGrid';
import { DetailView } from './ui/DetailView';
import { Workspace } from './ui/Workspace';
import { MenuDrawer } from './ui/MenuDrawer';
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
import { MenuIcon, PlusIcon, AlertIcon, ErrorIcon, XIcon, FocusIcon, SearchIcon, ApertureIcon, SparkleIcon, CheckIcon, EditIcon, GridIcon, ClockIcon, LayersIcon, EyeClosedIcon, SunIcon, DownloadIcon, StarIcon, TagIcon, TrashIcon } from './ui/icons';
import { UndoHistoryButton } from './ui/UndoHistoryButton';
import { selectHighlights, selectBlinks, selectDeletableRejected } from './state/batchOps';
import { CARD_MIN_WIDTH } from './state/gridDensity';
import { SORT_KEY_LABELS, type SortKey } from './state/gridSort';
import { pickImportFiles } from './core/filePicker';
import { isNativeMediaLibraryAvailable, pickNativePhotos } from './core/nativeMediaLibrary';
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
import { ImportReminder } from './ui/ImportReminder';
import { MemoryBanner } from './ui/MemoryBanner';
import { GallerySupervisorBanner } from './ui/GallerySupervisorBanner';
import { PhotosAccessNotice } from './ui/PhotosAccessNotice';
import { SessionOutcome } from './ui/SessionOutcome';
import { HomeDashboard } from './ui/HomeDashboard';
import { BottomNav } from './ui/BottomNav';
import { WelcomeOnboarding } from './ui/WelcomeOnboarding';
import { SmartNotification } from './ui/SmartNotification';
import { t } from './i18n';

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

const GroupCompare = lazyPanel(() => import('./ui/GroupCompare').then(m => ({ default: m.GroupCompare })));
const PersonsPanel = lazyPanel(() => import('./ui/PersonsPanel').then(m => ({ default: m.PersonsPanel })));
const InsightsPanel = lazyPanel(() => import('./ui/InsightsPanel').then(m => ({ default: m.InsightsPanel })));
const BatchOpsPanel = lazyPanel(() => import('./ui/BatchOpsPanel').then(m => ({ default: m.BatchOpsPanel })));
const StatsPanel = lazyPanel(() => import('./ui/StatsPanel').then(m => ({ default: m.StatsPanel })));
const ProjectsPanel = lazyPanel(() => import('./ui/ProjectsPanel').then(m => ({ default: m.ProjectsPanel })));
const CollectionsPanel = lazyPanel(() => import('./ui/CollectionsPanel').then(m => ({ default: m.CollectionsPanel })));
const TripsPanel = lazyPanel(() => import('./ui/TripsPanel').then(m => ({ default: m.TripsPanel })));
const TikTokSort = lazyPanel(() => import('./ui/TikTokSort').then(m => ({ default: m.TikTokSort })));
const ZenModePanel = lazyPanel(() => import('./ui/ZenModePanel').then(m => ({ default: m.ZenModePanel })));
const AppearancePanel = lazyPanel(() => import('./ui/AppearancePanel').then(m => ({ default: m.AppearancePanel })));
const PremiumPanel = lazyPanel(() => import('./ui/PremiumPanel').then(m => ({ default: m.PremiumPanel })));
const ExportDestinations = lazyPanel(() => import('./ui/ExportDestinations').then(m => ({ default: m.ExportDestinations })));
const SearchPanel = lazyPanel(() => import('./ui/SearchPanel').then(m => ({ default: m.SearchPanel })));
const DocumentShieldPanel = lazyPanel(() => import('./ui/DocumentShieldPanel').then(m => ({ default: m.DocumentShieldPanel })));
const VaultPanel = lazyPanel(() => import('./ui/VaultPanel').then(m => ({ default: m.VaultPanel })));
const DuplicatesPanel = lazyPanel(() => import('./ui/DuplicatesPanel').then(m => ({ default: m.DuplicatesPanel })));
const GallerySupervisorPanel = lazyPanel(() => import('./ui/GallerySupervisorPanel').then(m => ({ default: m.GallerySupervisorPanel })));
const CommandPalette = lazyPanel(() => import('./ui/CommandPalette').then(m => ({ default: m.CommandPalette })));
const ShortcutsPanel = lazyPanel(() => import('./ui/ShortcutsPanel').then(m => ({ default: m.ShortcutsPanel })));
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
 * Clasifica un mesaj de notificare dupa cuvinte-cheie — nu exista un camp de
 * tip in store (notice e doar text), asa ca deducem tonul din continut pentru
 * iconita/culoarea toast-ului.
 *
 * 'progress' (mesaje "Se exporta...", "Se restaureaza backup-ul...", etc. —
 * conventia existenta in i18n e mereu suspensie de 3 puncte la finalul unei
 * actiuni inca in desfasurare) NU trebuie sa dispara automat dupa 10s ca un
 * succes obisnuit: bug real raportat de utilizator (export nativ Android,
 * confirmat pe device) — "Se exporta..." disparea la 10s in timp ce munca
 * async continua inca (poate dura pana la 30s pe calea nativa de partajare),
 * lasand un gol tacut in care parea ca nu s-a intamplat NIMIC, desi rezultatul
 * (succes SAU eroare) tot urma sa apara mai tarziu. Vezi efectul de mai jos.
 */
function noticeTone(message: string): 'error' | 'warn' | 'progress' | 'success' {
  const lower = message.toLowerCase();
  if (lower.includes('esuat') || lower.includes('eroare')) return 'error';
  // O anulare nu e nici eroare, nici succes — fara ea, "Export anulat..." ar primi
  // bifa verde de succes, exact mesajul gresit pentru un export care n-a livrat nimic.
  if (lower.includes('anulat') || lower.includes('cancelled')) return 'warn';
  if (lower.includes('plin') || lower.includes('aproape')) return 'warn';
  if (message.endsWith('...')) return 'progress';
  return 'success';
}
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
      <span className="mono toast-text">{notice}</span>
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
  const cancelImport = useStore(s => s.cancelImport);
  const importCancelling = useStore(s => s.importCancelling);
  const openDetail = useStore(s => s.openDetail);
  const openCompare = useStore(s => s.openCompare);
  const setMenuOpen = useStore(s => s.setMenuOpen);
  const setExportDestinationsOpen = useStore(s => s.setExportDestinationsOpen);
  const welcomeSeen = useStore(s => s.welcomeSeen);
  const setSupervisorPanelOpen = useStore(s => s.setSupervisorPanelOpen);
  const notice = useStore(s => s.notice);
  const clearNotice = useStore(s => s.clearNotice);
  const aiDegraded = useStore(s => s.aiDegraded);
  const aiBackend = useStore(s => s.aiBackend);
  const clearAll = useStore(s => s.clearAll);
  const askConfirm = useStore(s => s.askConfirm);
  const askPrompt = useStore(s => s.askPrompt);
  const filtered = useStore(s => s.filtered());
  const workspaceMode = useStore(s => s.workspaceMode);
  const setWorkspaceMode = useStore(s => s.setWorkspaceMode);
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
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setSelectMode(false); };
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
  const counts = useMemo(() => ({
    all: secondaryFiltered.length,
    selected: secondaryFiltered.filter(p => p.status === 'selected').length,
    review: secondaryFiltered.filter(p => p.status === 'review').length,
    rejected: secondaryFiltered.filter(p => p.status === 'rejected').length,
    series: secondaryFiltered.filter(p => p.groupId).length,
    blinks: selectBlinks(secondaryFiltered).length,
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
  const SECONDARY_FILTERS: { key: FilterKey; label: string; count: number; icon: ReactNode }[] = [
    { key: 'series', label: tr('palette.filter.series'), count: counts.series, icon: <LayersIcon /> },
    { key: 'highlights', label: tr('palette.filter.highlights'), count: counts.highlights, icon: <StarIcon /> },
    { key: 'blinks', label: tr('palette.filter.blinks'), count: counts.blinks, icon: <EyeClosedIcon /> },
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
    if (filter === 'series' && photo?.groupId) openCompare(photo.groupId);
    else openDetail(id);
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

  // fara confirmare, un singur clic accidental sterge ireversibil intreaga
  // sesiune (posibil 1000+ poze deja evaluate) — cea mai distructiva actiune
  // din aplicatie, singura fara nicio plasa de siguranta
  const confirmClearAll = async () => {
    const ok = await askConfirm(tr('app.clearSession.confirm', { count: counts.all }), { danger: true });
    if (ok) await clearAll();
  };

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
        <HomeDashboard />
        {welcomeSeen && (
          <div className="banner-stack">
            <MemoryBanner />
            <InstallPrompt />
            <BackupReminder />
            <ImportReminder onAddPhotos={() => void onAddPhotosClick()} />
            <GallerySupervisorBanner />
          </div>
        )}
        <Workspace />
        <CommandPalette />
        <ShortcutsPanel />
        <MenuDrawer />
        <PersonsPanel />
        <InsightsPanel />
        <BatchOpsPanel />
        <StatsPanel />
        <ContactSheet />
        <PresentationMode />
        <EditPanel />
        <ProjectsPanel />
        <CollectionsPanel />
        <TripsPanel />
        <TikTokSort />
        <ZenModePanel />
        <AppearancePanel />
        <PremiumPanel />
        <ExportDestinations />
        <SearchPanel />
        <DocumentShieldPanel />
        <VaultPanel />
        <DuplicatesPanel />
        <GallerySupervisorPanel />
        <ConfirmDialog />
      </>
    );
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark-wrap">
            <span className="brand-mark-ring" aria-hidden="true" />
            <span className="brand-mark">
              <ApertureIcon aria-hidden="true" />
            </span>
          </div>
          <div className="brand-text">
            <h1>LUMIN<span>CULLER</span></h1>
            <p className="mono"><i className="live-dot" aria-hidden="true" /> {tr('app.tagline')}</p>
            <ProjectNameField />
          </div>
        </div>
        <div className="top-actions">
          {photos.length > 0 && (
            <Tooltip label={tr('app.tooltip.palette')} shortcut="Ctrl+K">
              <button className="ghost icon-btn" onClick={() => setPaletteOpen(true)} aria-label={`${tr('app.tooltip.palette')} (Ctrl+K)`}>
                <SearchIcon />
              </button>
            </Tooltip>
          )}
          <UndoHistoryButton />
          {photos.length > 0 && (
            <Tooltip label={tr('app.tooltip.workspace')}>
              <button className="ghost icon-btn" onClick={() => setWorkspaceMode(true)} aria-label={tr('app.workspace.ariaLabel')}>
                <FocusIcon />
              </button>
            </Tooltip>
          )}
          <button
            className={counts.selected ? 'btn-accent export-cta' : 'ghost export-cta'}
            onClick={() => setExportDestinationsOpen(true)}
            disabled={!counts.selected}
          >
            <DownloadIcon className="inline-icon" aria-hidden="true" /> {tr('app.export', { count: counts.selected })}
          </button>
          <Tooltip label={tr('app.tooltip.menu')} side="left">
            <button className="ghost icon-btn" onClick={() => setMenuOpen(true)} aria-label={tr('app.menu.ariaLabel')}>
              <MenuIcon />
            </button>
          </Tooltip>
        </div>
      </header>

      <Toast />
      <WelcomeOnboarding />
      <HomeDashboard />
      {/* Nimic nu se desenează peste ecranul de bun venit: .banner-stack are
          z-index de toast, deci bannerele acopereau comutatorul de limbă și
          butonul de închidere. Reapar imediat ce ecranul e închis. */}
      {welcomeSeen && (
        <div className="banner-stack">
          <MemoryBanner />
          <InstallPrompt />
          <BackupReminder />
          <ImportReminder onAddPhotos={() => void onAddPhotosClick()} />
          <GallerySupervisorBanner />
        </div>
      )}

      {aiDegraded && (
        <p className="notice warn mono">
          <AlertIcon className="inline-icon" /> {tr('app.aiDegraded', { backend: aiBackend || tr('app.aiBackend.unknown') })}
        </p>
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
            pending={counts.all - counts.selected - counts.review - counts.rejected}
            total={counts.all}
            onClearSession={() => void confirmClearAll()}
          />
        )}

        {progress && (
          progress.phase === 'incarcare' ? (
            <AiBootScreen />
          ) : (
            <div className="progress" role="status" aria-live="polite">
              <div className="progress-bar" style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }} />
              <span className="mono">
                {progress.phase === 'analiza'
                  ? (progress.etaSeconds !== undefined
                    ? tr('app.progress.analyzingEta', { done: progress.done, total: progress.total, fileName: progress.fileName, eta: formatEta(progress.etaSeconds) })
                    : tr('app.progress.analyzing', { done: progress.done, total: progress.total, fileName: progress.fileName }))
                  : progress.phase === 'pregatire'
                    ? tr('app.progress.prescan', { done: progress.done, total: progress.total })
                    : progress.phase === 'grupare' ? tr('app.progress.grouping') : tr('app.progress.done')}
              </span>
              {progress.phase === 'analiza' && (
                <button className="ghost small progress-cancel" onClick={() => cancelImport()} disabled={importCancelling}>
                  {importCancelling ? tr('app.progress.cancelling') : tr('app.progress.cancel')}
                </button>
              )}
            </div>
          )
        )}

        {photos.length > 0 && homeGridOpen && (
          <nav className="filters" aria-label={tr('app.filters.ariaLabel')}>
            {PRIMARY_FILTERS.map(f => (
              <button
                key={f.key}
                className={filter === f.key ? 'chip chip-compact active' : 'chip chip-compact'}
                onClick={() => setFilter(f.key)}
                aria-pressed={filter === f.key}
                aria-label={f.label}
                title={f.label}
              >
                <span className="chip-icon" aria-hidden="true">{f.icon}</span>
                <b className="chip-count">{f.count}</b>
              </button>
            ))}
            <MoreFiltersMenu active={extraFiltersActive} badgeCount={extraFiltersCount}>
              {close => (
                <>
                  {SECONDARY_FILTERS.map(f => (
                    <button
                      key={f.key}
                      className={filter === f.key ? 'chip active' : 'chip'}
                      onClick={() => { setFilter(f.key); close(); }}
                      aria-pressed={filter === f.key}
                    >
                      <span className="chip-icon" aria-hidden="true">{f.icon}</span>
                      {f.label}
                      <b className="chip-count">{f.count}</b>
                    </button>
                  ))}
                  <div className="more-filters-divider" />
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
                  {isNativeMediaLibraryAvailable() && (
                    <>
                      <div className="more-filters-divider" />
                      <button
                        className="chip danger"
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
            {anySecondaryFilterActive && (
              <button
                className="chip chip-compact"
                onClick={clearAllFilters}
                aria-label={tr('app.clearAllFilters')}
                title={tr('app.clearAllFilters')}
              >
                <XIcon className="chip-icon" aria-hidden="true" />
              </button>
            )}
            {multiSelectIds.size === 0 && (
              <button
                className={selectMode ? 'chip chip-compact active select-mode-toggle' : 'chip chip-compact select-mode-toggle'}
                onClick={() => setSelectMode(!selectMode)}
                aria-pressed={selectMode}
                aria-label={selectMode ? tr('app.selectMode.active') : tr('app.selectMode.toggle')}
                title={selectMode ? tr('app.selectMode.active') : tr('app.selectMode.toggle')}
              >
                <CheckIcon className="chip-icon" aria-hidden="true" />
              </button>
            )}
          </nav>
        )}

        {photos.length > 0 && homeGridOpen && (
          <nav className="filters filters-advanced" aria-label={tr('app.filtersAdvanced.ariaLabel')}>
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
            <select
              className={minRating > 0 ? 'chip rating-filter active' : 'chip rating-filter'}
              value={minRating}
              onChange={e => setMinRating(Number(e.target.value))}
              aria-label={tr('app.ratingFilter.ariaLabel')}
            >
              <option value={0}>{tr('app.ratingFilter.any')}</option>
              {[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{'★'.repeat(n)}+ </option>)}
            </select>
            <span className="sort-control" title={
              filter === 'series' ? tr('app.sort.seriesOverride')
                : filter === 'review' ? tr('app.sort.reviewOverride')
                : undefined
            }>
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
            <label className="date-field">
              {tr('app.dateFrom')}
              <input
                type="date"
                value={epochToDateInput(dateFrom)}
                onChange={e => setDateRange(dateInputToEpoch(e.target.value, false), dateTo)}
                aria-label={tr('app.dateFrom.ariaLabel')}
              />
            </label>
            <label className="date-field">
              {tr('app.dateTo')}
              <input
                type="date"
                value={epochToDateInput(dateTo)}
                onChange={e => setDateRange(dateFrom, dateInputToEpoch(e.target.value, true))}
                aria-label={tr('app.dateTo.ariaLabel')}
              />
            </label>
            {(searchText || dateFrom !== null || dateTo !== null || minRating > 0) && (
              <button className="ghost small" onClick={clearAdvancedFilters}>{tr('app.resetFilters')}</button>
            )}
          </nav>
        )}
        </div>
      </div>

      <SessionOutcome />

      {photos.length === 0 && !progress ? (
        <div className="empty">
          <div className="empty-badge" aria-hidden="true">
            <ApertureIcon />
          </div>
          <p className="mono empty-tagline"><span className="live-dot" aria-hidden="true" /> {tr('app.empty.badge')}</p>
          <h2>{tr('app.empty.title')}</h2>
          <p className="empty-lead">{tr('app.empty.description')}</p>
          {/* Doua cai de intrare, una langa alta (cerinta directa): alegi tu
              fisierele, sau lasi supervizorul sa aduca galeria telefonului pe
              perioade. A doua exista doar pe Android nativ, unde chiar avem un
              MediaStore de citit — pe web ar fi un buton care nu poate face
              nimic. */}
          <div className="empty-cta-row">
            <button className="btn-accent big" onClick={() => void onAddPhotosClick()}>{tr('app.empty.cta')}</button>
            {isNativeMediaLibraryAvailable() && (
              <button className="ghost big empty-cta-secondary" onClick={() => setSupervisorPanelOpen(true)}>
                <ClockIcon className="inline-icon" aria-hidden="true" /> {tr('app.empty.supervisorCta')}
              </button>
            )}
          </div>
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
          <div className="how-it-works-card">
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
                  photos={filtered} onOpen={onCardOpen} multiSelectIds={multiSelectIds}
                  onCardPointerDown={onCardPointerDown} onContextMenu={onCardContextMenu}
                  onScroll={handleGridScroll}
                />
              ) : (
                <div
                  className="grid"
                  style={{
                    '--card-min': `${CARD_MIN_WIDTH[gridDensity].wide}px`,
                    '--card-min-narrow': `${CARD_MIN_WIDTH[gridDensity].narrow}px`
                  } as CSSProperties}
                >
                  {filtered.map((p, i) => (
                    <PhotoCard
                      key={p.id} photo={p} index={i} onOpen={onCardOpen}
                      multiSelected={multiSelectIds.has(p.id)}
                      onCardPointerDown={onCardPointerDown} onContextMenu={onCardContextMenu}
                    />
                  ))}
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
      <TripsPanel />
      <TikTokSort />
      <ZenModePanel />
      <AppearancePanel />
      <PremiumPanel />
      <ExportDestinations />
      <SearchPanel />
      <DocumentShieldPanel />
      <VaultPanel />
      <DuplicatesPanel />
      <GallerySupervisorPanel />
      <MenuDrawer />
      <CommandPalette />
      <ShortcutsPanel />
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
