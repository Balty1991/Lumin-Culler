import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useStore, type FilterKey } from './state/store';
import { PhotoCard } from './ui/PhotoCard';
import { VirtualPhotoGrid } from './ui/VirtualPhotoGrid';
import { DetailView } from './ui/DetailView';
import { Workspace } from './ui/Workspace';
import { GroupCompare } from './ui/GroupCompare';
import { PersonsPanel } from './ui/PersonsPanel';
import { MenuDrawer } from './ui/MenuDrawer';
import { InsightsPanel } from './ui/InsightsPanel';
import { BatchOpsPanel } from './ui/BatchOpsPanel';
import { StatsPanel } from './ui/StatsPanel';
import { ProjectsPanel } from './ui/ProjectsPanel';
import { CommandPalette } from './ui/CommandPalette';
import { ShortcutsPanel } from './ui/ShortcutsPanel';
import { EmptyFilterState } from './ui/EmptyFilterState';
import { ContextMenu } from './ui/ContextMenu';
import { ConfirmDialog } from './ui/ConfirmDialog';
import { AnimatedNumber } from './ui/AnimatedNumber';
import { Tooltip } from './ui/Tooltip';
import { StarRating } from './ui/StarRating';
import { MenuIcon, PlusIcon, UserCheckIcon, AlertIcon, ErrorIcon, XIcon, FocusIcon, UndoIcon, SearchIcon, ApertureIcon, SparkleIcon, CheckIcon, EditIcon, GridIcon, ClockIcon, LayersIcon, EyeClosedIcon, SunIcon, DownloadIcon } from './ui/icons';
import { CARD_MIN_WIDTH } from './state/gridDensity';
import { SORT_KEY_LABELS, type SortKey } from './state/gridSort';
import { pickImportFiles } from './core/filePicker';
import { t } from './i18n';

const NOTICE_AUTODISMISS_MS = 7000;
/** Apasare lunga pe touch = meniu contextual (echivalentul click-dreapta pe desktop) — plan 3.2.1. */
const LONG_PRESS_MS = 500;
/** Peste aceasta miscare (px), o apasare lunga se anuleaza — degetul incearca sa deruleze/traga, nu sa tina apasat. */
const TOUCH_MOVE_CANCEL_PX = 10;

/** Clasifica un mesaj de notificare dupa cuvinte-cheie — nu exista un camp de tip in store
    (notice e doar text), asa ca deducem tonul din continut pentru iconita/culoarea toast-ului. */
function noticeTone(message: string): 'error' | 'warn' | 'success' {
  const lower = message.toLowerCase();
  if (lower.includes('esuat') || lower.includes('eroare')) return 'error';
  if (lower.includes('plin') || lower.includes('aproape')) return 'warn';
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
        {tone === 'error' ? <ErrorIcon /> : tone === 'warn' ? <AlertIcon /> : <CheckIcon />}
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
  const progress = useStore(s => s.progress);
  const filter = useStore(s => s.filter);
  const setFilter = useStore(s => s.setFilter);
  const personFilter = useStore(s => s.personFilter);
  const setPersonFilter = useStore(s => s.setPersonFilter);
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
  const cancelImport = useStore(s => s.cancelImport);
  const openDetail = useStore(s => s.openDetail);
  const openCompare = useStore(s => s.openCompare);
  const setMenuOpen = useStore(s => s.setMenuOpen);
  const exportSelection = useStore(s => s.exportSelection);
  const notice = useStore(s => s.notice);
  const clearNotice = useStore(s => s.clearNotice);
  const aiDegraded = useStore(s => s.aiDegraded);
  const aiBackend = useStore(s => s.aiBackend);
  const clearAll = useStore(s => s.clearAll);
  const askConfirm = useStore(s => s.askConfirm);
  const filtered = useStore(s => s.filtered());
  const workspaceMode = useStore(s => s.workspaceMode);
  const setWorkspaceMode = useStore(s => s.setWorkspaceMode);
  const history = useStore(s => s.history);
  const batchHistory = useStore(s => s.batchHistory);
  const undoCount = history.length + batchHistory.length;
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
  const setStatus = useStore(s => s.setStatus);
  const setRating = useStore(s => s.setRating);
  const gridDensity = useStore(s => s.gridDensity);
  const gridSort = useStore(s => s.gridSort);
  const setGridSort = useStore(s => s.setGridSort);
  const locale = useStore(s => s.locale);
  const tr = (key: string, params?: Record<string, string | number>) => t(locale, key, params);
  const fileRef = useRef<HTMLInputElement>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; photoId: string } | null>(null);
  const dragSelectRef = useRef<{ originId: string; adding: boolean; visited: Set<string>; dragged: boolean } | null>(null);
  const longPressTimerRef = useRef<number | null>(null);
  const touchOriginRef = useRef<{ x: number; y: number } | null>(null);
  // Auto-hide pentru antet la scroll (plan "Refactorizare UI/UX", GridView) — maximizeaza
  // zona de vizualizare pe mobil. Doua surse de scroll posibile dupa marimea bibliotecii
  // (vezi VIRTUALIZE_THRESHOLD mai jos): fereastra intreaga (grila normala, flux de pagina)
  // sau containerul intern al VirtualPhotoGrid (biblioteci mari) — ambele raporteaza aici
  // prin acelasi handler, ca starea sa fie unica indiferent de sursa.
  const [headerHidden, setHeaderHidden] = useState(false);
  const lastScrollYRef = useRef(0);
  const handleGridScroll = (scrollY: number) => {
    const last = lastScrollYRef.current;
    const delta = scrollY - last;
    if (scrollY < 40) setHeaderHidden(false); // aproape de varf — antetul ramane mereu vizibil
    else if (delta > 6) setHeaderHidden(true); // scroll in jos
    else if (delta < -6) setHeaderHidden(false); // scroll in sus
    lastScrollYRef.current = scrollY;
  };

  useEffect(() => {
    const onWindowScroll = () => handleGridScroll(window.scrollY);
    window.addEventListener('scroll', onWindowScroll, { passive: true });
    return () => window.removeEventListener('scroll', onWindowScroll);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { void boot(); }, [boot]);

  // semnal de import activ, disponibil INDIFERENT de ecranul curent (Workspace
  // sau grila) — util pentru teste/automatizari care altfel n-ar avea un
  // singur loc unic sa verifice "importul s-a terminat", de vreme ce bara de
  // progres detaliata traieste doar in ramura grilei.
  useEffect(() => {
    document.body.dataset.importing = progress ? 'true' : 'false';
  }, [progress]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => clearNotice(), NOTICE_AUTODISMISS_MS);
    return () => clearTimeout(t);
  }, [notice, clearNotice]);

  // Ctrl/Cmd+Z global — functioneaza indiferent de ecran (grid, Workspace,
  // DetailView), fara sa intre in conflict cu shortcut-urile lor (Sageti/P/X/Z
  // fara modificator, deja folosite acolo pentru navigare/zoom).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
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

  const counts = useMemo(() => ({
    all: photos.length,
    selected: photos.filter(p => p.status === 'selected').length,
    review: photos.filter(p => p.status === 'review').length,
    rejected: photos.filter(p => p.status === 'rejected').length,
    series: photos.filter(p => p.groupId).length,
    blinks: photos.filter(p => p.faceCount > 0 && !p.allEyesOpen).length,
    goldenHour: photos.filter(p => p.goldenHourDetected).length
  }), [photos]);

  const FILTERS: { key: FilterKey; label: string; count: number; icon: ReactNode }[] = [
    { key: 'all', label: tr('palette.filter.all'), count: counts.all, icon: <GridIcon /> },
    { key: 'selected', label: tr('palette.filter.selected'), count: counts.selected, icon: <CheckIcon /> },
    { key: 'review', label: tr('palette.filter.review'), count: counts.review, icon: <ClockIcon /> },
    { key: 'series', label: tr('palette.filter.series'), count: counts.series, icon: <LayersIcon /> },
    { key: 'blinks', label: tr('palette.filter.blinks'), count: counts.blinks, icon: <EyeClosedIcon /> },
    { key: 'goldenHour', label: tr('palette.filter.goldenHour'), count: counts.goldenHour, icon: <SunIcon /> },
    { key: 'rejected', label: tr('palette.filter.rejected'), count: counts.rejected, icon: <XIcon /> }
  ];

  const onFiles = (list: FileList | null) => {
    if (!list || !list.length) return;
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
    const picked = await pickImportFiles();
    if (picked) {
      if (picked.files.length) void runImport(picked.files, picked.handles);
      return;
    }
    fileRef.current?.click();
  };

  const onCardOpen = (id: string, e: React.MouseEvent) => {
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
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [setMultiSelected]);

  // fara confirmare, un singur clic accidental sterge ireversibil intreaga
  // sesiune (posibil 1000+ poze deja evaluate) — cea mai distructiva actiune
  // din aplicatie, singura fara nicio plasa de siguranta
  const confirmClearAll = async () => {
    const ok = await askConfirm(tr('app.clearSession.confirm', { count: counts.all }), { danger: true });
    if (ok) await clearAll();
  };

  const total = Math.max(1, counts.all);
  const decidedPercent = Math.round(((counts.selected + counts.rejected) / total) * 100);

  // Workspace e ecranul principal implicit — grila (jos) ramane accesibila
  // doar cand exista deja poze SI utilizatorul a comutat explicit la ea
  // (buton dedicat in antetul Workspace-ului); fara poze, ramane onboarding-ul.
  // Montam si panourile deschise din meniu (Persoane/Preferinte AI/Operatii in
  // masa) — altfel butonul Meniu din Workspace n-ar avea ce deschide.
  if (photos.length > 0 && workspaceMode) {
    return (
      <>
        <Toast />
        <Workspace />
        <CommandPalette />
        <ShortcutsPanel />
        <MenuDrawer />
        <PersonsPanel />
        <InsightsPanel />
        <BatchOpsPanel />
        <StatsPanel />
        <ProjectsPanel />
        <ConfirmDialog />
      </>
    );
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <ApertureIcon className="brand-mark" aria-hidden="true" />
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
          {undoCount > 0 && (
            <Tooltip label={tr('app.tooltip.undo')} shortcut="Ctrl+Z">
              <button className="ghost icon-btn" onClick={() => void undo()} aria-label={tr('app.undo.ariaLabel', { count: undoCount })}>
                <UndoIcon />
                <span className="undo-count mono">{undoCount}</span>
              </button>
            </Tooltip>
          )}
          {photos.length > 0 && (
            <Tooltip label={tr('app.tooltip.workspace')}>
              <button className="ghost icon-btn" onClick={() => setWorkspaceMode(true)} aria-label={tr('app.workspace.ariaLabel')}>
                <FocusIcon />
              </button>
            </Tooltip>
          )}
          <button
            className={counts.selected ? 'btn-accent export-cta' : 'ghost export-cta'}
            onClick={() => void exportSelection()}
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

      {aiDegraded && (
        <p className="notice warn mono">
          <AlertIcon className="inline-icon" /> {tr('app.aiDegraded', { backend: aiBackend || tr('app.aiBackend.unknown') })}
        </p>
      )}

      {/* Auto-hide la scroll (plan "Refactorizare UI/UX"): progresul, filtrele si statisticile
          globale se ascund la scroll in jos si revin la scroll in sus — maximizeaza spatiul
          de afisare al grilei pe mobil. Topbar-ul (brand + actiuni critice) ramane mereu vizibil. */}
      <div className={headerHidden ? 'app-collapsible hidden' : 'app-collapsible'}>
        {photos.length > 0 && (
          <div className="cullbar-compact mono" aria-label={tr('app.cullbar.ariaLabel')}>
            <span className="cullbar-compact-stat sel" title={tr('app.cullbar.selected')}>
              <CheckIcon aria-hidden="true" /><AnimatedNumber value={counts.selected} />
            </span>
            <span className="cullbar-compact-stat rev" title={tr('app.cullbar.review')}>
              <ClockIcon aria-hidden="true" /><AnimatedNumber value={counts.review} />
            </span>
            <span className="cullbar-compact-stat rej" title={tr('app.cullbar.rejected')}>
              <XIcon aria-hidden="true" /><AnimatedNumber value={counts.rejected} />
            </span>
            <span className="cullbar-compact-percent" title={tr('app.cullbar.decidedTitle', { percent: decidedPercent })}>{decidedPercent}%</span>
            <span className="spacer-flex" />
            <button className="ghost small danger" onClick={() => void confirmClearAll()}>{tr('app.clearSession')}</button>
          </div>
        )}

        {progress && (
          <div className="progress" role="status" aria-live="polite">
            <div className="progress-bar" style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }} />
            <span className="mono">
              {progress.phase === 'incarcare' ? tr('app.progress.loadingModels')
                : progress.phase === 'analiza' ? tr('app.progress.analyzing', { done: progress.done, total: progress.total, fileName: progress.fileName })
                : progress.phase === 'grupare' ? tr('app.progress.grouping') : tr('app.progress.done')}
            </span>
            {progress.phase === 'analiza' && (
              <button className="ghost small progress-cancel" onClick={() => cancelImport()}>{tr('app.progress.cancel')}</button>
            )}
          </div>
        )}

        {photos.length > 0 && (
          <nav className="filters">
            {FILTERS.map(f => (
              <button
                key={f.key}
                className={filter === f.key ? 'chip active' : 'chip'}
                onClick={() => setFilter(f.key)}
                aria-pressed={filter === f.key}
              >
                <span className="chip-icon" aria-hidden="true">{f.icon}</span>
                {f.label}
                <b className="chip-count">{f.count}</b>
              </button>
            ))}
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
            {multiSelectIds.size === 0 && (
              <button
                className={selectMode ? 'chip active select-mode-toggle' : 'chip select-mode-toggle'}
                onClick={() => setSelectMode(!selectMode)}
                aria-pressed={selectMode}
              >
                <CheckIcon className="inline-icon" aria-hidden="true" /> {selectMode ? tr('app.selectMode.active') : tr('app.selectMode.toggle')}
              </button>
            )}
          </nav>
        )}

        {photos.length > 0 && (
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
            <span className="sort-control" title={filter === 'series' ? tr('app.sort.seriesOverride') : undefined}>
              <select
                className="chip sort-key"
                value={gridSort.key}
                disabled={filter === 'series'}
                onChange={e => setGridSort({ key: e.target.value as SortKey, dir: gridSort.dir })}
                aria-label={tr('app.sort.ariaLabel')}
              >
                {(Object.keys(SORT_KEY_LABELS) as SortKey[]).map(key => (
                  <option key={key} value={key}>{tr(`app.sort.key.${key}`)}</option>
                ))}
              </select>
              <button
                className="chip sort-dir"
                disabled={filter === 'series'}
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

      {photos.length === 0 && !progress ? (
        <div className="empty">
          <ApertureIcon className="empty-mark" aria-hidden="true" />
          <h2>{tr('app.empty.title')}</h2>
          <p>{tr('app.empty.description')}</p>
          <button className="btn-accent big" onClick={() => void onAddPhotosClick()}>{tr('app.empty.cta')}</button>
          <p className="hint"><UserCheckIcon className="inline-icon" /> {tr('app.empty.hint')}</p>

          <div className="how-it-works">
            <div className="how-step">
              <span className="how-step-icon"><PlusIcon /></span>
              <div className="how-step-text">
                <b>{tr('app.howItWorks.add.title')}</b>
                <p>{tr('app.howItWorks.add.desc')}</p>
              </div>
            </div>
            <div className="how-step">
              <span className="how-step-icon"><SparkleIcon /></span>
              <div className="how-step-text">
                <b>{tr('app.howItWorks.analyze.title')}</b>
                <p>{tr('app.howItWorks.analyze.desc')}</p>
              </div>
            </div>
            <div className="how-step">
              <span className="how-step-icon"><CheckIcon /></span>
              <div className="how-step-text">
                <b>{tr('app.howItWorks.decide.title')}</b>
                <p>{tr('app.howItWorks.decide.desc')}</p>
              </div>
            </div>
          </div>
        </div>
      ) : (
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
          {multiSelectIds.size > 0 ? (
            <div className="bulk-bar glass" role="toolbar" aria-label={tr('app.bulkBar.ariaLabel')}>
              <span className="bulk-bar-count mono">{tr('app.bulkBar.count', { count: multiSelectIds.size })}</span>
              <div className="bulk-bar-actions">
                <button className="select small-btn" onClick={() => void bulkSetStatusForSelection('selected')}>{tr('app.bulkBar.select')}</button>
                <button className="ghost small-btn" onClick={() => void bulkSetStatusForSelection('review')}>{tr('app.bulkBar.review')}</button>
                <button className="reject small-btn" onClick={() => void bulkSetStatusForSelection('rejected')}>{tr('app.bulkBar.reject')}</button>
                <StarRating rating={0} onRate={n => void bulkSetRatingForSelection(n)} size="sm" />
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
              <button className="fab" onClick={() => void onAddPhotosClick()} aria-label={tr('app.addPhotos')}><PlusIcon /></button>
            </Tooltip>
          )}
        </>
      )}

      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/avif,.cr2,.cr3,.nef,.nrw,.arw,.srf,.sr2,.dng,.raf,.orf,.rw2,.pef,.ptx,.srw,.3fr,.erf,.kdc,.dcr,.mrw,.raw,.rwl,.iiq,.x3f"
        multiple
        hidden
        onChange={e => onFiles(e.target.files)}
      />

      <DetailView />
      <GroupCompare />
      <PersonsPanel />
      <InsightsPanel />
      <BatchOpsPanel />
      <StatsPanel />
      <ProjectsPanel />
      <MenuDrawer />
      <CommandPalette />
      <ShortcutsPanel />
      <ConfirmDialog />
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          count={multiSelectIds.has(contextMenu.photoId) && multiSelectIds.size > 1 ? multiSelectIds.size : 1}
          rating={
            multiSelectIds.has(contextMenu.photoId) && multiSelectIds.size > 1
              ? 0
              : photos.find(p => p.id === contextMenu.photoId)?.rating ?? 0
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
