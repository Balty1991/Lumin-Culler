import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useStore, type FilterKey } from '../state/store';
import {
  SearchIcon, FocusIcon, GridIcon, UndoIcon, LayersIcon, StarIcon, SparkleIcon,
  KeyboardIcon, SunIcon, MoonIcon, DownloadIcon, TagIcon, ListIcon, TrashIcon, FilterDotIcon
} from './icons';

const EASE = [0.16, 1, 0.3, 1] as const;

type Section = 'Navigare' | 'Editare' | 'Filtre' | 'Persoane & AI' | 'Export' | 'Aplicație';

interface Command {
  id: string;
  label: string;
  hint?: string;
  section: Section;
  icon: ReactNode;
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
  const workspaceMode = useStore(s => s.workspaceMode);
  const setWorkspaceMode = useStore(s => s.setWorkspaceMode);
  const setPersonsOpen = useStore(s => s.setPersonsOpen);
  const setInsightsOpen = useStore(s => s.setInsightsOpen);
  const setBatchOpsOpen = useStore(s => s.setBatchOpsOpen);
  const setShortcutsOpen = useStore(s => s.setShortcutsOpen);
  const theme = useStore(s => s.theme);
  const setTheme = useStore(s => s.setTheme);
  const exportSelection = useStore(s => s.exportSelection);
  const exportManifest = useStore(s => s.exportManifest);
  const exportXMP = useStore(s => s.exportXMP);
  const undo = useStore(s => s.undo);
  const clearAll = useStore(s => s.clearAll);

  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const reduceMotion = useReducedMotion();

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

  // Escape la nivel de window, NU doar pe input (vezi onInputKeyDown mai jos):
  // focusul e mutat pe input printr-un setTimeout(10ms) la deschidere, deci
  // exista o fereastra scurta in care Escape ar ajunge direct la window (fara
  // sa treaca prin input) daca utilizatorul apasa foarte rapid — fara acest
  // listener, paleta ar ramane deschisa in acel caz. Workspace/DetailView isi
  // verifica starea paletteOpen inainte sa actioneze la Escape, asa ca acest
  // listener suplimentar nu risca sa inchida altceva din greseala.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, setOpen]);

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
    { id: 'workspace', label: 'Deschide spațiul de lucru', hint: 'lupă + filmstrip', section: 'Navigare', icon: <FocusIcon />, run: () => setWorkspaceMode(true), disabled: !photos.length || workspaceMode },
    { id: 'grid', label: 'Vezi grila de poze', section: 'Navigare', icon: <GridIcon />, run: () => setWorkspaceMode(false), disabled: !photos.length || !workspaceMode },
    { id: 'undo', label: 'Anulează ultima decizie', hint: 'Ctrl+Z', section: 'Editare', icon: <UndoIcon />, run: () => void undo(), disabled: !history.length },
    { id: 'batch', label: 'Operații în masă', hint: 'respinge sub prag / rezolvă serii', section: 'Editare', icon: <LayersIcon />, run: () => setBatchOpsOpen(true), disabled: !photos.length },
    { id: 'clear-all', label: 'Golește sesiunea', hint: 'ireversibil', section: 'Editare', icon: <TrashIcon />, run: confirmClearAll, disabled: !photos.length },
    ...(['all', 'selected', 'review', 'series', 'blinks', 'rejected'] as FilterKey[]).map(key => ({
      id: 'filter-' + key,
      label: `Arată: ${FILTER_LABELS[key]}`,
      hint: String(counts[key]),
      section: 'Filtre' as Section,
      icon: <FilterDotIcon />,
      run: () => setFilter(key),
      disabled: key === filter
    })),
    { id: 'persons', label: 'Persoane cunoscute', section: 'Persoane & AI', icon: <StarIcon />, run: () => setPersonsOpen(true) },
    { id: 'insights', label: 'Preferințe AI', section: 'Persoane & AI', icon: <SparkleIcon />, run: () => setInsightsOpen(true) },
    { id: 'export-selection', label: `Exportă poze selectate (${counts.selected})`, section: 'Export', icon: <DownloadIcon />, run: () => void exportSelection(), disabled: !counts.selected },
    { id: 'export-xmp', label: 'Exportă etichete Lightroom (XMP)', section: 'Export', icon: <TagIcon />, run: () => void exportXMP(), disabled: !photos.length },
    { id: 'export-manifest', label: 'Exportă listă (JSON)', section: 'Export', icon: <ListIcon />, run: () => void exportManifest(), disabled: !counts.selected },
    { id: 'shortcuts', label: 'Scurtături tastatură', hint: '?', section: 'Aplicație', icon: <KeyboardIcon />, run: () => setShortcutsOpen(true) },
    { id: 'theme', label: theme === 'light' ? 'Comută la tema întunecată' : 'Comută la tema deschisă', section: 'Aplicație', icon: theme === 'light' ? <MoonIcon /> : <SunIcon />, run: () => setTheme(theme === 'light' ? 'dark' : 'light') }
  ] as Command[], [photos.length, history.length, counts, filter, theme, workspaceMode]);

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

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="palette-scrim" onClick={() => setOpen(false)}
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          transition={{ duration: reduceMotion ? 0 : 0.15, ease: EASE }}
        >
          <motion.div
            className="palette" onClick={e => e.stopPropagation()}
            role="dialog" aria-modal="true" aria-label="Paleta de comenzi"
            initial={{ opacity: 0, scale: 0.97, y: -8 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.98, y: -4 }}
            transition={{ duration: reduceMotion ? 0 : 0.18, ease: EASE }}
          >
            <div className="palette-input-row">
              <SearchIcon className="inline-icon" aria-hidden="true" />
              <input
                ref={inputRef}
                value={query}
                onChange={e => { setQuery(e.target.value); setActiveIndex(0); }}
                onKeyDown={onInputKeyDown}
                placeholder="Caută o acțiune…"
                role="combobox"
                aria-expanded="true"
                aria-controls="palette-listbox"
                aria-activedescendant={filtered[activeIndex] ? `palette-option-${filtered[activeIndex].id}` : undefined}
                aria-autocomplete="list"
                autoComplete="off"
              />
            </div>
            <ul className="palette-list" id="palette-listbox" role="listbox">
              {filtered.map((c, i) => (
                <li key={c.id} role="presentation">
                  {(i === 0 || filtered[i - 1].section !== c.section) && (
                    <div className="palette-section-label">{c.section}</div>
                  )}
                  <div
                    id={`palette-option-${c.id}`}
                    role="option"
                    aria-selected={i === activeIndex}
                    aria-disabled={c.disabled}
                    className={`palette-item${i === activeIndex ? ' active' : ''}${c.disabled ? ' disabled' : ''}`}
                    onMouseEnter={() => setActiveIndex(i)}
                    onClick={() => execute(c)}
                  >
                    <span className="palette-item-icon" aria-hidden="true">{c.icon}</span>
                    <span className="palette-item-label">{c.label}</span>
                    {c.hint && <span className="palette-hint mono">{c.hint}</span>}
                  </div>
                </li>
              ))}
              {filtered.length === 0 && <li className="palette-empty">Nicio acțiune găsită.</li>}
            </ul>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
