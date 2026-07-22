import { useStore } from '../state/store';
import { StarIcon, SparkleIcon, ListIcon, InfoIcon, XIcon } from './icons';

/** Meniu lateral: persoane, preferinte AI invatate, export lista, despre. */
export function MenuDrawer() {
  const open = useStore(s => s.menuOpen);
  const setOpen = useStore(s => s.setMenuOpen);
  const setPersonsOpen = useStore(s => s.setPersonsOpen);
  const setInsightsOpen = useStore(s => s.setInsightsOpen);
  const exportManifest = useStore(s => s.exportManifest);
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

        <button className="drawer-item" onClick={() => go(() => void exportManifest())}>
          <ListIcon />
          <span>Exporta lista (JSON)</span>
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
