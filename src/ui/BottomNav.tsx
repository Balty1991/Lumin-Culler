import { type CSSProperties } from 'react';
import { useStore } from '../state/store';
import { t } from '../i18n';
import { setLuminSettingsOpen, useLuminSettingsOpen } from './shellState';
import { OrbitCleanIcon, OrbitLibraryIcon, OrbitSettingsIcon } from './icons';
import { withViewTransition } from './viewTransition';

/**
 * Trei destinații, fiecare cu un singur sens.
 *
 * Curăță e ecranul de coșuri. Biblioteca e grila și uneltele de fotograf.
 * Setări e limba, mementoul și Premium. Persoanele și exportul nu mai sunt
 * taburi: stau în uneltele Pro, deschise din Setări.
 */
export function BottomNav() {
  const photos = useStore(s => s.photos);
  const locale = useStore(s => s.locale);
  const tr = (key: string) => t(locale, key);
  const setCollectionsOpen = useStore(s => s.setCollectionsOpen);
  const setPersonsOpen = useStore(s => s.setPersonsOpen);
  const setMenuOpen = useStore(s => s.setMenuOpen);
  const setExportDestinationsOpen = useStore(s => s.setExportDestinationsOpen);
  const homeGridOpen = useStore(s => s.homeGridOpen);
  const setHomeGridOpen = useStore(s => s.setHomeGridOpen);
  const tiktokSortOpen = useStore(s => s.tiktokSortOpen);
  const proMode = useStore(s => s.proMode);
  const setProMode = useStore(s => s.setProMode);
  const personsOpen = useStore(s => s.personsOpen);
  const exportDestinationsOpen = useStore(s => s.exportDestinationsOpen);
  const menuOpen = useStore(s => s.menuOpen);
  const collectionsOpen = useStore(s => s.collectionsOpen);
  const settingsOpen = useLuminSettingsOpen();

  const closePanels = () => {
    setCollectionsOpen(false);
    setPersonsOpen(false);
    setMenuOpen(false);
    setExportDestinationsOpen(false);
  };

  const goClean = () => withViewTransition(() => {
    closePanels();
    setLuminSettingsOpen(false);
    setProMode(false);
    setHomeGridOpen(false);
  });
  const goLibrary = () => withViewTransition(() => {
    closePanels();
    setLuminSettingsOpen(false);
    setProMode(true);
    setHomeGridOpen(photos.length > 0);
  });
  const goSettings = () => withViewTransition(() => {
    closePanels();
    setLuminSettingsOpen(true);
  });

  const inLibrary = proMode || homeGridOpen || personsOpen || exportDestinationsOpen || menuOpen || collectionsOpen;
  const activeIndex = tiktokSortOpen ? -1 : settingsOpen ? 2 : inLibrary ? 1 : 0;
  const cleanActive = activeIndex === 0;
  const libraryActive = activeIndex === 1;
  const settingsActive = activeIndex === 2;

  return (
    <nav className="bottom-nav glass orbit-dock" aria-label={tr('nav.ariaLabel')}>
      <span className="bottom-nav-pill-track" aria-hidden="true">
        <span
          className="bottom-nav-pill"
          data-hidden={activeIndex < 0 ? 'true' : undefined}
          style={{ '--nav-active': Math.max(0, activeIndex) } as CSSProperties}
        />
      </span>
      <button type="button" className={cleanActive ? 'bottom-nav-tab active' : 'bottom-nav-tab'} onClick={goClean} aria-current={cleanActive || undefined}>
        <OrbitCleanIcon />
        <span>{tr('nav.clean')}</span>
      </button>
      <button type="button" className={libraryActive ? 'bottom-nav-tab active' : 'bottom-nav-tab'} onClick={goLibrary} aria-current={libraryActive || undefined}>
        <OrbitLibraryIcon />
        <span>{tr('nav.library')}</span>
      </button>
      <button type="button" className={settingsActive ? 'bottom-nav-tab active' : 'bottom-nav-tab'} onClick={goSettings} aria-current={settingsActive || undefined}>
        <OrbitSettingsIcon />
        <span>{tr('nav.settings')}</span>
      </button>
    </nav>
  );
}
