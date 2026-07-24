import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
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
import { AnimatedNumber } from './ui/AnimatedNumber';
import { Tooltip } from './ui/Tooltip';
import { StarRating } from './ui/StarRating';
import { MenuIcon, PlusIcon, UserCheckIcon, AlertIcon, ErrorIcon, XIcon, FocusIcon, UndoIcon, SearchIcon, ApertureIcon, SparkleIcon, CheckIcon, EditIcon } from './ui/icons';
import { CARD_MIN_WIDTH } from './state/gridDensity';
import { SORT_KEY_LABELS, type SortKey } from './state/gridSort';

const NOTICE_AUTODISMISS_MS = 7000;

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
        placeholder="Nume proiect sau client"
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
      title="Eticheteaza aceasta sesiune (client/proiect) — util cand lucrezi in mai multe tab-uri"
    >
      <EditIcon className="inline-icon" />
      {projectName || 'Nume proiect (optional)'}
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
  if (!notice) return null;
  const tone = noticeTone(notice);
  return (
    <div className={`toast tone-${tone}`} role="status">
      <span className="toast-icon">
        {tone === 'error' ? <ErrorIcon /> : tone === 'warn' ? <AlertIcon /> : <CheckIcon />}
      </span>
      <span className="mono toast-text">{notice}</span>
      <button className="toast-close" onClick={() => clearNotice()} aria-label="Inchide">
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
  const selectMode = useStore(s => s.selectMode);
  const setSelectMode = useStore(s => s.setSelectMode);
  const bulkSetStatusForSelection = useStore(s => s.bulkSetStatusForSelection);
  const bulkSetRatingForSelection = useStore(s => s.bulkSetRatingForSelection);
  const gridDensity = useStore(s => s.gridDensity);
  const gridSort = useStore(s => s.gridSort);
  const setGridSort = useStore(s => s.setGridSort);
  const fileRef = useRef<HTMLInputElement>(null);

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
    blinks: photos.filter(p => p.faceCount > 0 && !p.allEyesOpen).length
  }), [photos]);

  const FILTERS: { key: FilterKey; label: string; count: number }[] = [
    { key: 'all', label: 'Toate', count: counts.all },
    { key: 'selected', label: 'Selectate', count: counts.selected },
    { key: 'review', label: 'De verificat', count: counts.review },
    { key: 'series', label: 'Serii', count: counts.series },
    { key: 'blinks', label: 'Ochi inchisi', count: counts.blinks },
    { key: 'rejected', label: 'Respinse', count: counts.rejected }
  ];

  const onFiles = (list: FileList | null) => {
    if (!list || !list.length) return;
    void runImport(Array.from(list));
    if (fileRef.current) fileRef.current.value = '';
  };

  const onCardOpen = (id: string, e: React.MouseEvent) => {
    if (e.shiftKey) { rangeMultiSelect(id, filtered.map(p => p.id)); return; }
    if (e.ctrlKey || e.metaKey) { toggleMultiSelect(id); return; }
    // cat timp exista deja ceva in selectie SAU modul selectie e pornit explicit
    // (buton dedicat — singura cale de a incepe o selectie pe touch, unde
    // Ctrl/Shift+Click nu exista), un click/tap simplu continua sa selecteze
    // in loc sa deschida DetailView
    if (multiSelectIds.size > 0 || selectMode) { toggleMultiSelect(id); return; }
    const photo = photos.find(p => p.id === id);
    if (filter === 'series' && photo?.groupId) openCompare(photo.groupId);
    else openDetail(id);
  };

  // fara confirmare, un singur clic accidental sterge ireversibil intreaga
  // sesiune (posibil 1000+ poze deja evaluate) — cea mai distructiva actiune
  // din aplicatie, singura fara nicio plasa de siguranta
  const confirmClearAll = async () => {
    const ok = window.confirm(
      `Sigur golești sesiunea? Se șterg ireversibil toate cele ${counts.all} poze din acest browser ` +
      '(inclusiv cele selectate/exportate). Nu poate fi anulat.'
    );
    if (ok) await clearAll();
  };

  const total = Math.max(1, counts.all);
  const decidedPercent = Math.round(((counts.selected + counts.rejected) / total) * 100);
  const decidedDeg = Math.max(0, Math.min(360, Math.round((decidedPercent / 100) * 360)));

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
            <p className="mono"><i className="live-dot" aria-hidden="true" /> AI local · pozele raman pe dispozitiv</p>
            <ProjectNameField />
          </div>
        </div>
        <div className="top-actions">
          {photos.length > 0 && (
            <Tooltip label="Paleta de comenzi" shortcut="Ctrl+K">
              <button className="ghost icon-btn" onClick={() => setPaletteOpen(true)} aria-label="Paleta de comenzi (Ctrl+K)">
                <SearchIcon />
              </button>
            </Tooltip>
          )}
          {undoCount > 0 && (
            <Tooltip label="Anuleaza ultima decizie" shortcut="Ctrl+Z">
              <button className="ghost icon-btn" onClick={() => void undo()} aria-label={`Anuleaza ultima decizie (${undoCount} disponibile, Ctrl+Z)`}>
                <UndoIcon />
                <span className="undo-count mono">{undoCount}</span>
              </button>
            </Tooltip>
          )}
          {photos.length > 0 && (
            <Tooltip label="Spatiu de lucru">
              <button className="ghost icon-btn" onClick={() => setWorkspaceMode(true)} aria-label="Spatiu de lucru (lupa + filmstrip)">
                <FocusIcon />
              </button>
            </Tooltip>
          )}
          <button className="ghost" onClick={() => void exportSelection()} disabled={!counts.selected}>
            Exporta poze ({counts.selected})
          </button>
          <Tooltip label="Meniu" side="left">
            <button className="ghost icon-btn" onClick={() => setMenuOpen(true)} aria-label="Meniu">
              <MenuIcon />
            </button>
          </Tooltip>
        </div>
      </header>

      <Toast />

      {aiDegraded && (
        <p className="notice warn mono">
          <AlertIcon className="inline-icon" /> Detectia AI de fete nu ruleaza accelerat pe acest
          dispozitiv ({aiBackend || 'necunoscut'}) — scorurile folosesc doar claritate si expunere,
          fara fete/zambet/persoane cunoscute.
        </p>
      )}

      {photos.length > 0 && (
        <section className="cullbar" aria-label="Progresul sortarii">
          <div className="cullbar-main">
            <div
              className="session-ring"
              style={{ background: `conic-gradient(var(--accent) ${decidedDeg}deg, var(--surface-3) 0)` }}
              title={`${decidedPercent}% din poze au o decizie luata`}
            >
              <span className="session-ring-inner">{decidedPercent}%</span>
            </div>
            <div className="cullbar-body">
              <div className="cullbar-track">
                <span className="seg-sel" style={{ width: `${(counts.selected / total) * 100}%` }} />
                <span className="seg-rev" style={{ width: `${(counts.review / total) * 100}%` }} />
                <span className="seg-rej" style={{ width: `${(counts.rejected / total) * 100}%` }} />
              </div>
              <div className="cullbar-legend mono">
                <span className="legend-stat"><i className="dot sel" /><b><AnimatedNumber value={counts.selected} /></b> selectate</span>
                <span className="legend-stat"><i className="dot rev" /><b><AnimatedNumber value={counts.review} /></b> de verificat</span>
                <span className="legend-stat"><i className="dot rej" /><b><AnimatedNumber value={counts.rejected} /></b> respinse</span>
                <span className="spacer" />
                <button className="ghost small" onClick={() => void confirmClearAll()}>Goleste sesiunea</button>
              </div>
            </div>
          </div>
        </section>
      )}

      {progress && (
        <div className="progress" role="status" aria-live="polite">
          <div className="progress-bar" style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }} />
          <span className="mono">
            {progress.phase === 'incarcare' ? 'Se incarca modelele AI (prima data poate dura, verifica conexiunea)…'
              : progress.phase === 'analiza' ? `Analiza AI ${progress.done}/${progress.total} — ${progress.fileName}`
              : progress.phase === 'grupare' ? 'Grupare serii si duplicate…' : 'Finalizat'}
          </span>
          {progress.phase === 'analiza' && (
            <button className="ghost small progress-cancel" onClick={() => cancelImport()}>Anuleaza</button>
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
            >{f.label} <b>{f.count}</b></button>
          ))}
          {persons.length > 0 && (
            <select
              className={personFilter ? 'chip person-filter active' : 'chip person-filter'}
              value={personFilter ?? ''}
              onChange={e => setPersonFilter(e.target.value || null)}
              aria-label="Filtreaza dupa persoana cunoscuta"
            >
              <option value="">Orice persoana</option>
              {persons.map(p => <option key={p.id} value={p.name}>{p.name}</option>)}
            </select>
          )}
          {multiSelectIds.size === 0 && (
            <button
              className={selectMode ? 'chip active select-mode-toggle' : 'chip select-mode-toggle'}
              onClick={() => setSelectMode(!selectMode)}
              aria-pressed={selectMode}
            >
              <CheckIcon className="inline-icon" aria-hidden="true" /> {selectMode ? 'Mod selectie (activ)' : 'Selecteaza mai multe'}
            </button>
          )}
        </nav>
      )}

      {photos.length > 0 && (
        <nav className="filters filters-advanced" aria-label="Filtre avansate">
          <label className="search-field">
            <SearchIcon className="inline-icon" aria-hidden="true" />
            <input
              type="search"
              placeholder="Cauta dupa nume fisier…"
              value={searchText}
              onChange={e => setSearchText(e.target.value)}
              aria-label="Cauta poze dupa numele fisierului"
            />
          </label>
          <select
            className={minRating > 0 ? 'chip rating-filter active' : 'chip rating-filter'}
            value={minRating}
            onChange={e => setMinRating(Number(e.target.value))}
            aria-label="Rating minim"
          >
            <option value={0}>Orice rating</option>
            {[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{'★'.repeat(n)}+ </option>)}
          </select>
          <span className="sort-control" title={filter === 'series' ? 'Filtrul "Serii" foloseste propria ordine (grupate) — sortarea de mai jos e ignorata' : undefined}>
            <select
              className="chip sort-key"
              value={gridSort.key}
              disabled={filter === 'series'}
              onChange={e => setGridSort({ key: e.target.value as SortKey, dir: gridSort.dir })}
              aria-label="Sorteaza grila dupa"
            >
              {(Object.entries(SORT_KEY_LABELS) as [SortKey, string][]).map(([key, label]) => (
                <option key={key} value={key}>{label}</option>
              ))}
            </select>
            <button
              className="chip sort-dir"
              disabled={filter === 'series'}
              onClick={() => setGridSort({ key: gridSort.key, dir: gridSort.dir === 'asc' ? 'desc' : 'asc' })}
              aria-label={gridSort.dir === 'asc' ? 'Ordine crescatoare — comuta pe descrescatoare' : 'Ordine descrescatoare — comuta pe crescatoare'}
              title={gridSort.dir === 'asc' ? 'Crescator' : 'Descrescator'}
            >
              {gridSort.dir === 'asc' ? '↑' : '↓'}
            </button>
          </span>
          <label className="date-field">
            de la
            <input
              type="date"
              value={epochToDateInput(dateFrom)}
              onChange={e => setDateRange(dateInputToEpoch(e.target.value, false), dateTo)}
              aria-label="Data capturii — de la"
            />
          </label>
          <label className="date-field">
            pana la
            <input
              type="date"
              value={epochToDateInput(dateTo)}
              onChange={e => setDateRange(dateFrom, dateInputToEpoch(e.target.value, true))}
              aria-label="Data capturii — pana la"
            />
          </label>
          {(searchText || dateFrom !== null || dateTo !== null || minRating > 0) && (
            <button className="ghost small" onClick={clearAdvancedFilters}>Reseteaza filtrele</button>
          )}
        </nav>
      )}

      {photos.length === 0 && !progress ? (
        <div className="empty">
          <ApertureIcon className="empty-mark" aria-hidden="true" />
          <h2>Adauga sedinta foto</h2>
          <p>Alege pozele (JPEG/PNG/WebP/RAW — CR2, NEF, ARW, DNG si altele). Analiza ruleaza
          local, pe fire separate — poti incarca si 1000+ fisiere fara ca aplicatia sa se blocheze.</p>
          <button className="btn-accent big" onClick={() => fileRef.current?.click()}>Alege fotografiile</button>
          <p className="hint"><UserCheckIcon className="inline-icon" /> Optional: inroleaza persoanele importante din
          meniu, ca AI-ul sa le prioritizeze la scorare.</p>

          <div className="how-it-works">
            <div className="how-step">
              <span className="how-step-icon"><PlusIcon /></span>
              <div className="how-step-text">
                <b>Adauga poze</b>
                <p>JPEG, PNG, WebP sau RAW — orice sedinta foto, oricat de mare.</p>
              </div>
            </div>
            <div className="how-step">
              <span className="how-step-icon"><SparkleIcon /></span>
              <div className="how-step-text">
                <b>AI analizeaza</b>
                <p>Claritate, expunere, fete, compozitie — totul local, pe dispozitiv.</p>
              </div>
            </div>
            <div className="how-step">
              <span className="how-step-icon"><CheckIcon /></span>
              <div className="how-step-text">
                <b>Tu decizi</b>
                <p>Confirma sau corecteaza — motorul invata din alegerile tale.</p>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <>
          {filtered.length > VIRTUALIZE_THRESHOLD ? (
            <VirtualPhotoGrid photos={filtered} onOpen={onCardOpen} multiSelectIds={multiSelectIds} />
          ) : (
            <div
              className="grid"
              style={{
                '--card-min': `${CARD_MIN_WIDTH[gridDensity].wide}px`,
                '--card-min-narrow': `${CARD_MIN_WIDTH[gridDensity].narrow}px`
              } as CSSProperties}
            >
              {filtered.map((p, i) => (
                <PhotoCard key={p.id} photo={p} index={i} onOpen={onCardOpen} multiSelected={multiSelectIds.has(p.id)} />
              ))}
            </div>
          )}
          {filtered.length === 0 && !progress && <EmptyFilterState />}
          {multiSelectIds.size > 0 ? (
            <div className="bulk-bar glass" role="toolbar" aria-label="Actiuni pentru selectia curenta">
              <span className="bulk-bar-count mono">{multiSelectIds.size} selectate</span>
              <div className="bulk-bar-actions">
                <button className="select small-btn" onClick={() => void bulkSetStatusForSelection('selected')}>Selecteaza</button>
                <button className="ghost small-btn" onClick={() => void bulkSetStatusForSelection('review')}>De verificat</button>
                <button className="reject small-btn" onClick={() => void bulkSetStatusForSelection('rejected')}>Respinge</button>
                <StarRating rating={0} onRate={n => void bulkSetRatingForSelection(n)} size="sm" />
                <button className="ghost icon-btn" onClick={() => setSelectMode(false)} aria-label="Deselecteaza tot si iesi din mod selectie">
                  <XIcon />
                </button>
              </div>
            </div>
          ) : selectMode ? (
            <div className="bulk-bar glass" role="toolbar" aria-label="Mod selectie activ">
              <span className="bulk-bar-count mono">Mod selectie — atinge pozele dorite</span>
              <button className="ghost small-btn" onClick={() => setSelectMode(false)}>Iesi din mod selectie</button>
            </div>
          ) : (
            <Tooltip label="Adauga poze" side="left">
              <button className="fab" onClick={() => fileRef.current?.click()} aria-label="Adauga poze"><PlusIcon /></button>
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
    </div>
  );
}
