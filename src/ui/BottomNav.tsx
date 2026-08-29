import { useRef } from 'react';
import { motion } from 'framer-motion';
import { useStore } from '../state/store';
import { GridIcon, PersonIcon, UploadIcon, GearIcon } from './icons';
import { t } from '../i18n';

/**
 * Bara de navigare jos — Grilă / Persoane / Export / Setări.
 *
 * Redesign "Lumin Culler PRO" (cerință directă a utilizatorului, cu mockup-uri
 * aprobate): cele 4 taburi urmează acum exact denumirile din capturile
 * confirmate, în locul variantei anterioare (Acasă/Bibliotecă/Revizuiesc/
 * Meniu — vezi istoricul git pentru raționamentul acelei variante, valabil
 * încă pentru echilibrul "ce se folosește des vs. rar", dar înlocuit aici
 * de cerința explicită de fidelitate față de mockup).
 *
 * Nimic nu s-a pierdut, doar s-a redistribuit:
 *  - "Acasă" (ce urmează) rămâne ecranul implicit — dispare doar TAB-ul
 *    dedicat; un tap pe orice tab activ îl închide și revine acolo.
 *  - "Revizuiesc" (sortarea rapidă) rămâne accesibil din pastila "De
 *    verificat" de deasupra grilei (Grilă), unde mockup-ul o arată oricum.
 *  - Persoane și Export au acum tab propriu, ca în mockup, în loc să stea
 *    sub Meniu.
 */
export function BottomNav() {
  const photos = useStore(s => s.photos);
  const locale = useStore(s => s.locale);
  const tr = (key: string) => t(locale, key);
  const collectionsOpen = useStore(s => s.collectionsOpen);
  const setCollectionsOpen = useStore(s => s.setCollectionsOpen);
  const personsOpen = useStore(s => s.personsOpen);
  const setPersonsOpen = useStore(s => s.setPersonsOpen);
  const menuOpen = useStore(s => s.menuOpen);
  const setMenuOpen = useStore(s => s.setMenuOpen);
  const exportDestinationsOpen = useStore(s => s.exportDestinationsOpen);
  const setExportDestinationsOpen = useStore(s => s.setExportDestinationsOpen);
  const homeGridOpen = useStore(s => s.homeGridOpen);
  const setHomeGridOpen = useStore(s => s.setHomeGridOpen);
  const tiktokSortOpen = useStore(s => s.tiktokSortOpen);
  const setFilter = useStore(s => s.setFilter);
  /** Doar prima intrare din sesiune impune filtrul — vezi goGrid. Hook, deci INAINTE de orice return. */
  const libraryOpenedRef = useRef(false);

  if (photos.length === 0) return null;

  const toReview = photos.filter(p => p.status === 'review' || p.status === 'pending').length;

  const closePanels = () => { setCollectionsOpen(false); setPersonsOpen(false); setMenuOpen(false); setExportDestinationsOpen(false); };
  // `!tiktokSortOpen`: revizuirea se deschide PESTE grila — fara conditia asta,
  // Grila ramanea marcata activa si sub sortarea rapida, si bara nu mai spunea
  // unde esti, ci unde ai fost.
  const isGridActive = homeGridOpen && !tiktokSortOpen && !collectionsOpen && !personsOpen && !menuOpen && !exportDestinationsOpen;

  /**
   * Grila se deschide pe "De verificat", nu pe "Toate" — cerinta utilizatorului
   * ("cand deschizi biblioteca vreau sa intre direct pe de verificat"), doar la
   * PRIMA intrare din sesiune si doar cand chiar mai e ceva de verificat (vezi
   * ratiunea completa in istoricul git al acestui fisier).
   *
   * Bug real raportat de utilizator, gasit chiar dupa ce tab-ul "Acasa" a
   * disparut din bara (redesign PRO): fara el, NIMIC nu mai apela vreodata
   * setHomeGridOpen(false) — odata intrat in Grila, ramaneai acolo definitiv,
   * fara nicio cale inapoi la Acasa (ecranul "Revede selectia ta"). Un tap pe
   * tab-ul DEJA activ acum inchide grila, la fel cum un tap pe tab-ul activ
   * din alte aplicatii mobile te duce inapoi la radacina.
   */
  const goGrid = () => {
    if (isGridActive) { setHomeGridOpen(false); return; }
    closePanels();
    if (!libraryOpenedRef.current) {
      libraryOpenedRef.current = true;
      if (toReview > 0) setFilter('review');
    }
    setHomeGridOpen(true);
  };
  const goPersons = () => { closePanels(); setPersonsOpen(true); };
  const goExport = () => { closePanels(); setExportDestinationsOpen(true); };
  const goSettings = () => { closePanels(); setMenuOpen(true); };

  /**
   * Pastila care marcheaza tabul activ GLISEAZA intre taburi, in loc sa apara
   * si sa dispara. `layoutId` face framer-motion sa trateze cele patru
   * aparitii posibile ca pe UN SINGUR element care se muta — de-aia fundalul
   * propriu al tabului activ a fost scos din CSS: altfel s-ar fi vazut doua
   * pastile in acelasi timp cat tine tranzitia.
   *
   * Miscarea e doar transform, deci nu reasaza bara. La
   * `prefers-reduced-motion` framer citeste singur setarea si sare direct.
   */
  const pastila = <motion.span layoutId="bottom-nav-pill" className="bottom-nav-pill" aria-hidden="true"
    transition={{ type: 'spring', stiffness: 520, damping: 42, mass: 0.7 }} />;

  return (
    <nav className="bottom-nav glass" aria-label={tr('nav.ariaLabel')}>
      <button className={isGridActive ? 'bottom-nav-tab active' : 'bottom-nav-tab'} onClick={goGrid} aria-current={isGridActive}>
        {isGridActive && pastila}
        <GridIcon />
        <span>{tr('nav.grid')}</span>
        {toReview > 0 && !isGridActive && <b className="bottom-nav-badge mono">{toReview > 99 ? '99+' : toReview}</b>}
      </button>
      <button className={personsOpen ? 'bottom-nav-tab active' : 'bottom-nav-tab'} onClick={goPersons} aria-current={personsOpen}>
        {personsOpen && pastila}
        <PersonIcon />
        <span>{tr('nav.persons')}</span>
      </button>
      <button className={exportDestinationsOpen ? 'bottom-nav-tab active' : 'bottom-nav-tab'} onClick={goExport} aria-current={exportDestinationsOpen}>
        {exportDestinationsOpen && pastila}
        <UploadIcon />
        <span>{tr('nav.export')}</span>
      </button>
      <button className={menuOpen ? 'bottom-nav-tab active' : 'bottom-nav-tab'} onClick={goSettings} aria-current={menuOpen}>
        {menuOpen && pastila}
        <GearIcon />
        <span>{tr('nav.settings')}</span>
      </button>
    </nav>
  );
}
