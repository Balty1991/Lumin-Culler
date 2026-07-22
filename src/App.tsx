import { useEffect, useMemo, useRef } from 'react';
import { useStore, type FilterKey } from './state/store';
import { PhotoCard } from './ui/PhotoCard';
import { DetailView } from './ui/DetailView';
import { GroupCompare } from './ui/GroupCompare';
import { PersonsPanel } from './ui/PersonsPanel';
import { MenuDrawer } from './ui/MenuDrawer';
import { InsightsPanel } from './ui/InsightsPanel';
import { AnimatedNumber } from './ui/AnimatedNumber';
import { MenuIcon, PlusIcon, StarIcon, AlertIcon } from './ui/icons';

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
  const aiDegraded = useStore(s => s.aiDegraded);
  const aiBackend = useStore(s => s.aiBackend);
  const clearAll = useStore(s => s.clearAll);
  const filtered = useStore(s => s.filtered());
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => { void boot(); }, [boot]);

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

  const total = Math.max(1, counts.all);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <h1>LUMIN<span>CULLER</span></h1>
          <p className="mono"><i className="live-dot" aria-hidden="true" /> AI local · pozele raman pe dispozitiv</p>
        </div>
        <div className="top-actions">
          <button className="ghost" onClick={() => void exportSelection()} disabled={!counts.selected}>
            Exporta poze ({counts.selected})
          </button>
          <button className="ghost icon-btn" onClick={() => setMenuOpen(true)} aria-label="Meniu">
            <MenuIcon />
          </button>
        </div>
      </header>

      {notice && <p className="notice mono">{notice}</p>}

      {aiDegraded && (
        <p className="notice warn mono">
          <AlertIcon className="inline-icon" /> Detectia AI de fete nu ruleaza accelerat pe acest
          dispozitiv ({aiBackend || 'necunoscut'}) — scorurile folosesc doar claritate si expunere,
          fara fete/zambet/persoane cunoscute.
        </p>
      )}

      {photos.length > 0 && (
        <section className="cullbar" aria-label="Progresul sortarii">
          <div className="cullbar-track">
            <span className="seg-sel" style={{ width: `${(counts.selected / total) * 100}%` }} />
            <span className="seg-rev" style={{ width: `${(counts.review / total) * 100}%` }} />
            <span className="seg-rej" style={{ width: `${(counts.rejected / total) * 100}%` }} />
          </div>
          <div className="cullbar-legend mono">
            <span><i className="dot sel" /><b><AnimatedNumber value={counts.selected} /></b> selectate</span>
            <span><i className="dot rev" /><b><AnimatedNumber value={counts.review} /></b> de verificat</span>
            <span><i className="dot rej" /><b><AnimatedNumber value={counts.rejected} /></b> respinse</span>
            <span className="spacer" />
            <button className="ghost small" onClick={() => void clearAll()}>Goleste sesiunea</button>
          </div>
        </section>
      )}

      {progress && (
        <div className="progress">
          <div className="progress-bar" style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }} />
          <span className="mono">
            {progress.phase === 'analiza'
              ? `Analiza AI ${progress.done}/${progress.total} — ${progress.fileName}`
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
          <h2>Adauga sedinta foto</h2>
          <p>Alege pozele (JPEG/PNG/WebP). Analiza ruleaza local, pe fire separate —
          poti incarca si 1000+ fisiere fara ca aplicatia sa se blocheze.</p>
          <button className="select big" onClick={() => fileRef.current?.click()}>Alege fotografiile</button>
          <p className="hint"><StarIcon className="inline-icon" /> Optional: inroleaza persoanele importante din
          meniu, ca AI-ul sa le prioritizeze la scorare.</p>
        </div>
      ) : (
        <>
          <div className="grid">
            {filtered.map((p, i) => (
              <PhotoCard key={p.id} photo={p} index={i} onOpen={onCardOpen} />
            ))}
          </div>
          {filtered.length === 0 && <p className="empty-filter">Nicio poza nu corespunde filtrului curent.</p>}
          <button className="fab" onClick={() => fileRef.current?.click()} title="Adauga poze"><PlusIcon /></button>
        </>
      )}

      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/avif"
        multiple
        hidden
        onChange={e => onFiles(e.target.files)}
      />

      <DetailView />
      <GroupCompare />
      <PersonsPanel />
      <InsightsPanel />
      <MenuDrawer />
    </div>
  );
}
