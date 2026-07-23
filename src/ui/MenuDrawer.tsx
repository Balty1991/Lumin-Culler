import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useStore } from '../state/store';
import { UserCheckIcon, SparkleIcon, ListIcon, InfoIcon, XIcon, TagIcon, LayersIcon, KeyboardIcon, SunIcon, MoonIcon, BatteryIcon } from './icons';
import { EASE } from './motion';

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
  const economicMode = useStore(s => s.economicMode);
  const setEconomicMode = useStore(s => s.setEconomicMode);
  const exportManifest = useStore(s => s.exportManifest);
  const exportXMP = useStore(s => s.exportXMP);
  const persons = useStore(s => s.persons);
  const reduceMotion = useReducedMotion();

  const go = (action: () => void) => { setOpen(false); action(); };

  return (
    <AnimatePresence>
      {open && (
    <motion.div
      className="drawer-scrim" onClick={() => setOpen(false)}
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      transition={{ duration: reduceMotion ? 0 : 0.2, ease: EASE }}
    >
      <motion.nav
        className="drawer" onClick={e => e.stopPropagation()}
        initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
        transition={{ duration: reduceMotion ? 0 : 0.26, ease: EASE }}
      >
        <header className="drawer-head">
          <span>Meniu</span>
          <button className="ghost icon-btn" onClick={() => setOpen(false)} aria-label="Inchide meniul">
            <XIcon />
          </button>
        </header>

        <button className="drawer-item" onClick={() => go(() => setPersonsOpen(true))}>
          <span className="drawer-item-icon"><UserCheckIcon /></span>
          <span>Persoane cunoscute</span>
          {persons.length > 0 && <b className="drawer-count mono">{persons.length}</b>}
        </button>

        <button className="drawer-item" onClick={() => go(() => setInsightsOpen(true))}>
          <span className="drawer-item-icon"><SparkleIcon /></span>
          <span>Preferinte AI</span>
        </button>

        <button className="drawer-item" onClick={() => go(() => setBatchOpsOpen(true))}>
          <span className="drawer-item-icon"><LayersIcon /></span>
          <span>Operatii in masa</span>
        </button>

        <button className="drawer-item" onClick={() => go(() => setShortcutsOpen(true))}>
          <span className="drawer-item-icon"><KeyboardIcon /></span>
          <span>Scurtaturi tastatura</span>
        </button>

        <button className="drawer-item" onClick={() => go(() => setTheme(theme === 'light' ? 'dark' : 'light'))}>
          <span className="drawer-item-icon">{theme === 'light' ? <SunIcon /> : <MoonIcon />}</span>
          <span>Tema {theme === 'light' ? 'deschisa' : 'intunecata'}</span>
        </button>

        <button
          className="drawer-item"
          onClick={() => go(() => setEconomicMode(!economicMode))}
          aria-pressed={economicMode}
          title="Pool de un singur worker + fara iris/emotie — mai putina presiune pe CPU/RAM la import, pe hardware slab."
        >
          <span className="drawer-item-icon"><BatteryIcon /></span>
          <span>Mod economic {economicMode ? '(activ)' : ''}</span>
        </button>

        <button className="drawer-item" onClick={() => go(() => void exportManifest())}>
          <span className="drawer-item-icon"><ListIcon /></span>
          <span>Exporta lista (JSON)</span>
        </button>

        <button className="drawer-item" onClick={() => go(() => void exportXMP())}>
          <span className="drawer-item-icon"><TagIcon /></span>
          <span>Exporta etichete Lightroom (XMP)</span>
        </button>

        <div className="drawer-sep" />

        <div className="drawer-about">
          <InfoIcon />
          <p>Analiza AI, recunoasterea persoanelor si motorul de invatare ruleaza integral
          local, in browser — nicio poza nu paraseste dispozitivul.</p>
        </div>
      </motion.nav>
    </motion.div>
      )}
    </AnimatePresence>
  );
}
