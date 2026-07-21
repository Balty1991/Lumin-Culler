import { useEffect, useRef } from 'react';
import { useStore, type FilterKey } from './state/store';
import { PhotoCard } from './ui/PhotoCard';
import { DetailView } from './ui/DetailView';
import { GroupCompare } from './ui/GroupCompare';
import { PersonsPanel } from './ui/PersonsPanel';

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: 'Toate' },
  { key: 'selected', label: 'Selectate' },
  { key: 'review', label: 'De verificat' },
  { key: 'series', label: 'Serii' },
  { key: 'blinks', label: 'Ochi inchisi' },
  { key: 'rejected', label: 'Respinse' }
];

export default function App() {
  const boot = useStore(s => s.boot);
  const photos = useStore(s => s.photos);
  const progress = useStore(s => s.progress);
  const filter = useStore(s => s.filter);
  const setFilter = useStore(s => s.setFilter);
  const runImport = useStore(s => s.runImport);
  const openDetail = useStore(s => s.openDetail);
  const openCompare = useStore(s => s.openCompare);
  const setPersonsOpen = useStore(s => s.setPersonsOpen);
  const exportSelection = useStore(s => s.exportSelection);
  const clearAll = useStore(s => s.clearAll);
  const filtered = useStore(s => s.filtered());
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => { void boot(); }, [boot]);

  const counts = {
    selected: photos.filter(p => p.status === 'selected').length,
    rejected: photos.filter(p => p.status === 'rejected').length,
    review: photos.filter(p => p.status === 'review').length,
    series: new Set(photos.filter(p => p.groupId).map(p => p.groupId)).size
  };

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

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <h1>LUMIN<span>CULLER</span></h1>
          <p className="mono">sortare foto · AI local · pozele raman pe dispozitiv</p>
        </div>
        <div className="top-actions">
          <button className="ghost" onClick={() => setPersonsOpen(true)}>★ Persoane</button>
          <button className="ghost" onClick={() => void exportSelection()} disabled={!counts.selected}>
            Exporta ({counts.selected})
          </button>
        </div>
      </header>

      <section className="stats mono">
        <span>{photos.length} poze</span>
        <span className="c-sel">{counts.selected} selectate</span>
        <span className="c-rev">{counts.review} de verificat</span>
        <span className="c-rej">{counts.rejected} respinse</span>
        {counts.series > 0 && <span>{counts.series} serii</span>}
        {photos.length > 0 && <button className="ghost small" onClick={() => void clearAll()}>Goleste sesiunea</button>}
      </section>

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

      <nav className="filters">
        {FILTERS.map(f => (
          <button
            key={f.key}
            className={filter === f.key ? 'chip active' : 'chip'}
            onClick={() => setFilter(f.key)}
          >{f.label}</button>
        ))}
      </nav>

      {photos.length === 0 && !progress ? (
        <div className="empty">
          <h2>Adauga sedinta foto</h2>
          <p>Alege pozele (JPEG/PNG/WebP). Analiza ruleaza local, pe fire separate —
          poti incarca si 1000+ fisiere fara ca aplicatia sa se blocheze.</p>
          <button className="select big" onClick={() => fileRef.current?.click()}>Alege fotografiile</button>
          <p className="hint">Optional: inroleaza persoanele importante (★ Persoane) ca AI-ul
          sa le prioritizeze la scorare.</p>
        </div>
      ) : (
        <>
          <div className="grid">
            {filtered.map((p, i) => (
              <PhotoCard key={p.id} photo={p} index={i} onOpen={onCardOpen} />
            ))}
          </div>
          {filtered.length === 0 && <p className="empty-filter">Nicio poza nu corespunde filtrului curent.</p>}
          <button className="fab" onClick={() => fileRef.current?.click()} title="Adauga poze">+</button>
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
    </div>
  );
}
