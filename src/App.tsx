import { useEffect, useMemo, useRef } from 'react';
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
import { CommandPalette } from './ui/CommandPalette';
import { ShortcutsPanel } from './ui/ShortcutsPanel';
import { AnimatedNumber } from './ui/AnimatedNumber';
import { Tooltip } from './ui/Tooltip';
import { MenuIcon, PlusIcon, StarIcon, AlertIcon, XIcon, FocusIcon, UndoIcon, SearchIcon, ApertureIcon, SparkleIcon, CheckIcon } from './ui/icons';

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
 * Sub acest prag, grid-ul simplu (DOM normal) e mai simplu si are animatia
 * de intrare in cascada; peste, numarul de noduri DOM (+ URL-uri de obiect
 * pentru miniaturi) devine problema reala, asa ca trecem pe grid virtualizat
 * (doar randurile vizibile exista in DOM), indiferent cate mii de poze sunt.
 */
const VIRTUALIZE_THRESHOLD = 120;

export default function App() {
  const boot = useStore(s => s.boot);
  const photos = useStore(s => s.photos);
  const progress = useStore(s => s.progress);
  const filter = useStore(s => s.filter);
  const setFilter = useStore(s => s.setFilter);
  const runImport = useStore(s => s.runImport);
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
  const undo = useStore(s => s.undo);
  const setPaletteOpen = useStore(s => s.setPaletteOpen);
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

  const onCardOpen = (id: string) => {
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
        <Workspace />
        <CommandPalette />
        <ShortcutsPanel />
        <MenuDrawer />
        <PersonsPanel />
        <InsightsPanel />
        <BatchOpsPanel />
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
          {history.length > 0 && (
            <Tooltip label="Anuleaza ultima decizie" shortcut="Ctrl+Z">
              <button className="ghost icon-btn" onClick={() => void undo()} aria-label={`Anuleaza ultima decizie (${history.length} disponibile, Ctrl+Z)`}>
                <UndoIcon />
                <span className="undo-count mono">{history.length}</span>
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

      {notice && (
        <div className={`toast tone-${noticeTone(notice)}`} role="status">
          <span className="toast-icon">
            {noticeTone(notice) === 'error' ? <AlertIcon /> : noticeTone(notice) === 'warn' ? <AlertIcon /> : <CheckIcon />}
          </span>
          <span className="mono toast-text">{notice}</span>
          <button className="toast-close" onClick={() => clearNotice()} aria-label="Inchide">
            <XIcon />
          </button>
        </div>
      )}

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
        <div className="progress">
          <div className="progress-bar" style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }} />
          <span className="mono">
            {progress.phase === 'incarcare' ? 'Se incarca modelele AI (prima data poate dura, verifica conexiunea)…'
              : progress.phase === 'analiza' ? `Analiza AI ${progress.done}/${progress.total} — ${progress.fileName}`
              : progress.phase === 'grupare' ? 'Grupare serii si duplicate…' : 'Finalizat'}
          </span>
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
        </nav>
      )}

      {photos.length === 0 && !progress ? (
        <div className="empty">
          <ApertureIcon className="empty-mark" aria-hidden="true" />
          <h2>Adauga sedinta foto</h2>
          <p>Alege pozele (JPEG/PNG/WebP/RAW — CR2, NEF, ARW, DNG si altele). Analiza ruleaza
          local, pe fire separate — poti incarca si 1000+ fisiere fara ca aplicatia sa se blocheze.</p>
          <button className="btn-accent big" onClick={() => fileRef.current?.click()}>Alege fotografiile</button>
          <p className="hint"><StarIcon className="inline-icon" /> Optional: inroleaza persoanele importante din
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
            <VirtualPhotoGrid photos={filtered} onOpen={onCardOpen} />
          ) : (
            <div className="grid">
              {filtered.map((p, i) => (
                <PhotoCard key={p.id} photo={p} index={i} onOpen={onCardOpen} />
              ))}
            </div>
          )}
          {filtered.length === 0 && !progress && <p className="empty-filter">Nicio poza nu corespunde filtrului curent.</p>}
          <Tooltip label="Adauga poze" side="left">
            <button className="fab" onClick={() => fileRef.current?.click()} aria-label="Adauga poze"><PlusIcon /></button>
          </Tooltip>
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
      <MenuDrawer />
      <CommandPalette />
      <ShortcutsPanel />
    </div>
  );
}
