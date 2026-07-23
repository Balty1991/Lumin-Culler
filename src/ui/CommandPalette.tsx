import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useStore, type FilterKey } from '../state/store';
import { SearchIcon } from './icons';

interface Command {
  id: string;
  label: string;
  hint?: string;
  run: () => void;
  disabled?: boolean;
}

const FILTER_LABELS: Record<FilterKey, string> = {
  all: 'Toate', selected: 'Selectate', review: 'De verificat',
  rejected: 'Respinse', series: 'Serii', blinks: 'Ochi închiși'
};

/**
 * Cmd/Ctrl+K — paleta de comenzi: cauta si executa orice actiune fara sa
 * navighezi prin meniuri. Toate comenzile sunt legate la actiuni REALE din
 * store (nu placeholder-e) — daca o actiune nu are sens acum (ex. export
 * fara nimic selectat), comanda apare dezactivata, nu ascunsa, ca
 * utilizatorul sa inteleaga DE CE, nu doar ca "lipseste".
 */
export function CommandPalette() {
  const open = useStore(s => s.paletteOpen);
  const setOpen = useStore(s => s.setPaletteOpen);
  const photos = useStore(s => s.photos);
  const history = useStore(s => s.history);
  const filter = useStore(s => s.filter);
  const setFilter = useStore(s => s.setFilter);
  const setWorkspaceMode = useStore(s => s.setWorkspaceMode);
  const setPersonsOpen = useStore(s => s.setPersonsOpen);
  const setInsightsOpen = useStore(s => s.setInsightsOpen);
  const setBatchOpsOpen = useStore(s => s.setBatchOpsOpen);
  const exportSelection = useStore(s => s.exportSelection);
  const exportManifest = useStore(s => s.exportManifest);
  const exportXMP = useStore(s => s.exportXMP);
  const undo = useStore(s => s.undo);
  const clearAll = useStore(s => s.clearAll);

  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // deschidere globala cu Ctrl/Cmd+K — inregistrata o singura data (dependente
  // stabile), disponibila indiferent de ecran (grid sau Workspace)
  useEffect(() => {
    const onKey = (e: KeyboardEvent | globalThis.KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener('keydown', onKey as EventListener);
    return () => window.removeEventListener('keydown', onKey as EventListener);
  }, [setOpen]);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setActiveIndex(0);
    const t = setTimeout(() => inputRef.current?.focus(), 10);
    return () => clearTimeout(t);
  }, [open]);

  const counts = useMemo(() => ({
    selected: photos.filter(p => p.status === 'selected').length,
    review: photos.filter(p => p.status === 'review').length,
    rejected: photos.filter(p => p.status === 'rejected').length,
    series: photos.filter(p => p.groupId).length,
    blinks: photos.filter(p => p.faceCount > 0 && !p.allEyesOpen).length,
    all: photos.length
  }), [photos]);

  const confirmClearAll = () => {
    if (window.confirm(`Sigur golești sesiunea? Se șterg ireversibil toate cele ${counts.all} poze din acest browser. Nu poate fi anulat.`)) {
      void clearAll();
    }
  };

  const commands: Command[] = useMemo(() => [
    { id: 'workspace', label: 'Deschide spațiul de lucru', hint: 'lupă + filmstrip', run: () => setWorkspaceMode(true), disabled: !photos.length },
    { id: 'undo', label: 'Anulează ultima decizie', hint: 'Ctrl+Z', run: () => void undo(), disabled: !history.length },
    { id: 'batch', label: 'Operații în masă', hint: 'respinge sub prag / rezolvă serii', run: () => setBatchOpsOpen(true), disabled: !photos.length },
    { id: 'persons', label: 'Persoane cunoscute', run: () => setPersonsOpen(true) },
    { id: 'insights', label: 'Preferințe AI', run: () => setInsightsOpen(true) },
    { id: 'export-selection', label: `Exportă poze selectate (${counts.selected})`, run: () => void exportSelection(), disabled: !counts.selected },
    { id: 'export-xmp', label: 'Exportă etichete Lightroom (XMP)', run: () => void exportXMP(), disabled: !photos.length },
    { id: 'export-manifest', label: 'Exportă listă (JSON)', run: () => void exportManifest(), disabled: !counts.selected },
    ...(['all', 'selected', 'review', 'series', 'blinks', 'rejected'] as FilterKey[]).map(key => ({
      id: 'filter-' + key,
      label: `Arată: ${FILTER_LABELS[key]}`,
      hint: String(counts[key]),
      run: () => setFilter(key),
      disabled: key === filter
    })),
    { id: 'clear-all', label: 'Golește sesiunea', hint: 'ireversibil', run: confirmClearAll, disabled: !photos.length }
  ], [photos.length, history.length, counts, filter]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter(c => c.label.toLowerCase().includes(q));
  }, [commands, query]);

  const execute = (cmd: Command | undefined) => {
    if (!cmd || cmd.disabled) return;
    cmd.run();
    setOpen(false);
  };

  // stopPropagation pe fiecare ramura — altfel evenimentul urca la listener-ii
  // globali din Workspace/DetailView (Sageti/P/X/Escape fara modificator),
  // care ar interpreta gresit tastarea din input ca shortcut-uri ale lor
  // (ex. Escape inchidea si paleta SI Workspace-ul dintr-o singura apasare).
  const onInputKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); e.stopPropagation(); setActiveIndex(i => Math.min(i + 1, filtered.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); setActiveIndex(i => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); execute(filtered[activeIndex]); }
    else if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); }
  };

  if (!open) return null;

  return (
    <div className="palette-scrim" onClick={() => setOpen(false)}>
      <div className="palette" onClick={e => e.stopPropagation()}>
        <div className="palette-input-row">
          <SearchIcon className="inline-icon" />
          <input
            ref={inputRef}
            value={query}
            onChange={e => { setQuery(e.target.value); setActiveIndex(0); }}
            onKeyDown={onInputKeyDown}
            placeholder="Caută o acțiune…"
          />
        </div>
        <ul className="palette-list">
          {filtered.map((c, i) => (
            <li
              key={c.id}
              className={`${i === activeIndex ? 'active' : ''}${c.disabled ? ' disabled' : ''}`}
              onMouseEnter={() => setActiveIndex(i)}
              onClick={() => execute(c)}
            >
              <span>{c.label}</span>
              {c.hint && <span className="palette-hint mono">{c.hint}</span>}
            </li>
          ))}
          {filtered.length === 0 && <li className="palette-empty">Nicio acțiune găsită.</li>}
        </ul>
      </div>
    </div>
  );
}
