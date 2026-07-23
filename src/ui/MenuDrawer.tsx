import { useStore } from '../state/store';
import { StarIcon, SparkleIcon, ListIcon, InfoIcon, XIcon, TagIcon, LayersIcon, KeyboardIcon, SunIcon, MoonIcon } from './icons';

/** Meniu lateral: persoane, preferinte AI invatate, export lista, despre. */
export function MenuDrawer() {
  const open = useStore(s => s.menuOpen);
  const setOpen = useStore(s => s.setMenuOpen);
  const setPersonsOpen = useStore(s => s.setPersonsOpen);
  const setInsightsOpen = useStore(s => s.setInsightsOpen);
  const setBatchOpsOpen = useStore(s => s.setBatchOpsOpen);
  const setShortcutsOpen = useStore(s => s.setShortcutsOpen);
  const theme = useStore(s => s.theme);
  const setTheme = useStore(s => s.setTheme);
  const exportManifest = useStore(s => s.exportManifest);
  const exportXMP = useStore(s => s.exportXMP);
  const persons = useStore(s => s.persons);

  if (!open) return null;

  const go = (action: () => void) => { setOpen(false); action(); };

  return (
    <div className="drawer-scrim" onClick={() => setOpen(false)}>
      <nav className="drawer" onClick={e => e.stopPropagation()}>
        <header className="drawer-head">
          <span>Meniu</span>
          <button className="ghost icon-btn" onClick={() => setOpen(false)} aria-label="Inchide meniul">
            <XIcon />
          </button>
        </header>

        <button className="drawer-item" onClick={() => go(() => setPersonsOpen(true))}>
          <StarIcon />
          <span>Persoane cunoscute</span>
          {persons.length > 0 && <b className="drawer-count mono">{persons.length}</b>}
        </button>

        <button className="drawer-item" onClick={() => go(() => setInsightsOpen(true))}>
          <SparkleIcon />
          <span>Preferinte AI</span>
        </button>

        <button className="drawer-item" onClick={() => go(() => setBatchOpsOpen(true))}>
          <LayersIcon />
          <span>Operatii in masa</span>
        </button>

        <button className="drawer-item" onClick={() => go(() => setShortcutsOpen(true))}>
          <KeyboardIcon />
          <span>Scurtaturi tastatura</span>
        </button>

        <button className="drawer-item" onClick={() => go(() => setTheme(theme === 'light' ? 'dark' : 'light'))}>
          {theme === 'light' ? <SunIcon /> : <MoonIcon />}
          <span>Tema {theme === 'light' ? 'deschisa' : 'intunecata'}</span>
        </button>

        <button className="drawer-item" onClick={() => go(() => void exportManifest())}>
          <ListIcon />
          <span>Exporta lista (JSON)</span>
        </button>

        <button className="drawer-item" onClick={() => go(() => void exportXMP())}>
          <TagIcon />
          <span>Exporta etichete Lightroom (XMP)</span>
        </button>

        <div className="drawer-sep" />

        <div className="drawer-about">
          <InfoIcon />
          <p>Analiza AI, recunoasterea persoanelor si motorul de invatare ruleaza integral
          local, in browser — nicio poza nu paraseste dispozitivul.</p>
        </div>
      </nav>
    </div>
  );
}
