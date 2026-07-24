import { useRef } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useStore } from '../state/store';
import {
  UserCheckIcon, SparkleIcon, ListIcon, InfoIcon, XIcon, TagIcon, LayersIcon, KeyboardIcon,
  SunIcon, MoonIcon, BatteryIcon, GridIcon, DownloadIcon, UploadIcon, BarChartIcon, GlobeIcon
} from './icons';
import { EASE } from './motion';
import { GENRE_PRESETS } from '../state/genre';
import { nextGridDensity } from '../state/gridDensity';
import { t } from '../i18n';

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
  const locale = useStore(s => s.locale);
  const setLocale = useStore(s => s.setLocale);
  const economicMode = useStore(s => s.economicMode);
  const setEconomicMode = useStore(s => s.setEconomicMode);
  const genre = useStore(s => s.genre);
  const setGenre = useStore(s => s.setGenre);
  const gridDensity = useStore(s => s.gridDensity);
  const setGridDensity = useStore(s => s.setGridDensity);
  const exportManifest = useStore(s => s.exportManifest);
  const exportXMP = useStore(s => s.exportXMP);
  const exportClientGallery = useStore(s => s.exportClientGallery);
  const exportBackup = useStore(s => s.exportBackup);
  const importBackupFile = useStore(s => s.importBackupFile);
  const setStatsOpen = useStore(s => s.setStatsOpen);
  const setProjectsOpen = useStore(s => s.setProjectsOpen);
  const persons = useStore(s => s.persons);
  const reduceMotion = useReducedMotion();
  const restoreInputRef = useRef<HTMLInputElement>(null);

  const tr = (key: string, params?: Record<string, string | number>) => t(locale, key, params);
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
          <span>{tr('menu.title')}</span>
          <button className="ghost icon-btn" onClick={() => setOpen(false)} aria-label={tr('menu.close')}>
            <XIcon />
          </button>
        </header>

        <div className="drawer-section-label">{tr('menu.section.workspace')}</div>
        <button className="drawer-item" onClick={() => go(() => setPersonsOpen(true))}>
          <span className="drawer-item-icon"><UserCheckIcon /></span>
          <span>{tr('menu.knownPersons')}</span>
          {persons.length > 0 && <b className="drawer-count mono">{persons.length}</b>}
        </button>

        <button className="drawer-item" onClick={() => go(() => setInsightsOpen(true))}>
          <span className="drawer-item-icon"><SparkleIcon /></span>
          <span>{tr('menu.aiPreferences')}</span>
        </button>

        <button className="drawer-item" onClick={() => go(() => setBatchOpsOpen(true))}>
          <span className="drawer-item-icon"><LayersIcon /></span>
          <span>{tr('menu.batchOps')}</span>
        </button>

        <button className="drawer-item" onClick={() => go(() => setStatsOpen(true))}>
          <span className="drawer-item-icon"><BarChartIcon /></span>
          <span>{tr('menu.stats')}</span>
        </button>

        <button className="drawer-item" onClick={() => go(() => setProjectsOpen(true))}>
          <span className="drawer-item-icon"><ListIcon /></span>
          <span>{tr('menu.projects')}</span>
        </button>

        <label className="drawer-item drawer-item-select" title={tr('menu.genre.title')}>
          <span className="drawer-item-icon"><TagIcon /></span>
          <span>{tr('menu.genre')}</span>
          <select
            className="drawer-select mono"
            value={genre}
            onChange={e => setGenre(e.target.value)}
          >
            <option value="">{tr('menu.genre.none')}</option>
            {GENRE_PRESETS.map(g => <option key={g} value={g}>{g}</option>)}
          </select>
        </label>

        <div className="drawer-section-label">{tr('menu.section.export')}</div>
        <button className="drawer-item" onClick={() => go(() => void exportManifest())}>
          <span className="drawer-item-icon"><ListIcon /></span>
          <span>{tr('menu.exportManifest')}</span>
        </button>

        <button className="drawer-item" onClick={() => go(() => void exportXMP())}>
          <span className="drawer-item-icon"><TagIcon /></span>
          <span>{tr('menu.exportXmp')}</span>
        </button>

        <button
          className="drawer-item"
          onClick={() => go(() => void exportClientGallery())}
          title={tr('menu.exportClientGallery.title')}
        >
          <span className="drawer-item-icon"><UserCheckIcon /></span>
          <span>{tr('menu.exportClientGallery')}</span>
        </button>

        <div className="drawer-section-label">{tr('menu.section.backup')}</div>
        <button
          className="drawer-item"
          onClick={() => go(() => void exportBackup())}
          title={tr('menu.exportBackup.title')}
        >
          <span className="drawer-item-icon"><DownloadIcon /></span>
          <span>{tr('menu.exportBackup')}</span>
        </button>
        <button
          className="drawer-item"
          onClick={() => { setOpen(false); restoreInputRef.current?.click(); }}
          title={tr('menu.importBackup.title')}
        >
          <span className="drawer-item-icon"><UploadIcon /></span>
          <span>{tr('menu.importBackup')}</span>
        </button>
        <input
          ref={restoreInputRef}
          type="file"
          accept="application/json,.json"
          style={{ display: 'none' }}
          onChange={e => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) void importBackupFile(file);
          }}
        />

        <div className="drawer-section-label">{tr('menu.section.settings')}</div>
        <button className="drawer-item" onClick={() => go(() => setTheme(theme === 'light' ? 'dark' : 'light'))}>
          <span className="drawer-item-icon">{theme === 'light' ? <SunIcon /> : <MoonIcon />}</span>
          <span>{theme === 'light' ? tr('menu.theme.light') : tr('menu.theme.dark')}</span>
        </button>

        <button
          className="drawer-item"
          onClick={() => go(() => setLocale(locale === 'ro' ? 'en' : 'ro'))}
          title={tr('menu.language.title')}
        >
          <span className="drawer-item-icon"><GlobeIcon /></span>
          <span>{tr('menu.language')}</span>
        </button>

        <button
          className="drawer-item"
          onClick={() => go(() => setEconomicMode(!economicMode))}
          aria-pressed={economicMode}
          title={tr('menu.economicMode.title')}
        >
          <span className="drawer-item-icon"><BatteryIcon /></span>
          <span>{economicMode ? tr('menu.economicMode.active') : tr('menu.economicMode')}</span>
        </button>

        <button
          className="drawer-item"
          onClick={() => setGridDensity(nextGridDensity(gridDensity))}
          title={tr('menu.gridDensity.title')}
        >
          <span className="drawer-item-icon"><GridIcon /></span>
          <span>{tr('menu.gridDensity', { density: tr(`menu.gridDensity.${gridDensity}`) })}</span>
        </button>

        <div className="drawer-section-label">{tr('menu.section.help')}</div>
        <button className="drawer-item" onClick={() => go(() => setShortcutsOpen(true))}>
          <span className="drawer-item-icon"><KeyboardIcon /></span>
          <span>{tr('menu.shortcuts')}</span>
        </button>

        <div className="drawer-sep" />

        <div className="drawer-about">
          <InfoIcon />
          <p>{tr('menu.about')}</p>
        </div>
      </motion.nav>
    </motion.div>
      )}
    </AnimatePresence>
  );
}
